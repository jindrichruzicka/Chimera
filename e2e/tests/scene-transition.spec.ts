/**
 * F38 — scene-transition.spec.ts
 *
 * Drives engine:scene_prepare through the real renderer IPC path and verifies
 * the host-side scene manager reaches engine:post-match on both windows.
 *
 * Note: scene_ready acknowledgements are sent automatically by useFadeTransition
 * in SceneRouter after the fade-out animation completes (~300 ms per renderer).
 * The test does NOT need to send them explicitly; it verifies only the stable
 * final state after the auto-mechanism has fired.
 */
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/direct-match.fixture';
import { MatchPage } from '../pages/MatchPage';

interface HostSnapshotView {
    readonly tick: number;
    readonly viewerId: string;
    readonly sceneId?: string;
    readonly sceneTransition?: {
        readonly phase?: string;
        readonly playersReady?: readonly string[];
    } | null;
}

function isHostSnapshotView(value: unknown): value is HostSnapshotView {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Readonly<Record<string, unknown>>;
    return typeof record['tick'] === 'number' && typeof record['viewerId'] === 'string';
}

async function readHostSnapshot(hostApp: ElectronApplication): Promise<HostSnapshotView> {
    const snapshot = await hostApp.evaluate(() => globalThis.__e2eHooks?.lastHostSnapshot ?? null);
    if (!isHostSnapshotView(snapshot)) {
        throw new Error('Host E2E snapshot was not available');
    }
    return snapshot;
}

async function requestPostMatchScene(
    hostApp: ElectronApplication,
    hostWindow: Page,
): Promise<void> {
    await expect
        .poll(async () => (await readHostSnapshot(hostApp)).sceneId ?? null, { timeout: 15_000 })
        .toBe('engine:match');

    await hostWindow.evaluate(async (toSceneId) => {
        const gameApi = (
            globalThis as {
                readonly __chimera?: {
                    readonly game?: {
                        readonly sendAction?: (action: unknown) => void;
                        readonly getCurrentSnapshot?: () => Promise<{
                            readonly tick: number;
                            readonly viewerId: string;
                        } | null>;
                    };
                };
            }
        ).__chimera?.game;

        if (gameApi === undefined || typeof gameApi.sendAction !== 'function') {
            throw new Error('window.__chimera.game.sendAction is unavailable');
        }

        if (typeof gameApi.getCurrentSnapshot !== 'function') {
            throw new Error('window.__chimera.game.getCurrentSnapshot is unavailable');
        }

        const snapshot = await gameApi.getCurrentSnapshot();
        if (snapshot === null) {
            throw new Error('Renderer current snapshot was not available');
        }

        gameApi.sendAction({
            type: 'engine:scene_prepare',
            playerId: snapshot.viewerId,
            tick: snapshot.tick,
            payload: {
                toSceneId,
                params: {},
            },
        });
    }, 'engine:post-match');
}

test('host scene_prepare transitions host and client into post-match', async ({
    hostApp,
    hostWindow,
    clientWindow,
}) => {
    const hostMatch = new MatchPage(hostWindow);
    const clientMatch = new MatchPage(clientWindow);

    await requestPostMatchScene(hostApp, hostWindow);
    // useFadeTransition in each SceneRouter automatically sends engine:scene_ready
    // after the fade-out animation (~300 ms).  SessionRuntime then auto-dispatches
    // engine:scene_commit once both players are ready.  No explicit acknowledgement
    // is required from the test.
    await Promise.all([
        expect.poll(() => hostMatch.activeSceneId(), { timeout: 15_000 }).toBe('engine:post-match'),
        expect
            .poll(() => clientMatch.activeSceneId(), { timeout: 15_000 })
            .toBe('engine:post-match'),
        expect.poll(() => hostMatch.activeScreenKey(), { timeout: 15_000 }).toBe('summary'),
        expect.poll(() => clientMatch.activeScreenKey(), { timeout: 15_000 }).toBe('summary'),
    ]);
    await expect(hostMatch.postMatchSummary).toBeVisible();
    await expect(clientMatch.postMatchSummary).toBeVisible();
    await expect(hostMatch.transitionOverlay).toHaveCount(0);
    await expect(clientMatch.transitionOverlay).toHaveCount(0);
});
