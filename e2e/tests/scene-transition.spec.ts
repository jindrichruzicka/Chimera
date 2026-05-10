/**
 * F38 — scene-transition.spec.ts
 *
 * Drives engine:scene_prepare through the real renderer IPC path and verifies
 * the host-side scene manager reaches engine:post-match on both windows.
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

    await expect
        .poll(async () => (await readHostSnapshot(hostApp)).sceneTransition?.phase ?? null, {
            timeout: 10_000,
        })
        .toBe('preparing');
}

async function acknowledgeSceneReady(window: Page): Promise<void> {
    await window.evaluate(async () => {
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
            type: 'engine:scene_ready',
            playerId: snapshot.viewerId,
            tick: snapshot.tick,
            payload: { playerId: snapshot.viewerId },
        });
    });
}

test('host scene_prepare transitions host and client into post-match', async ({
    hostApp,
    hostWindow,
    clientWindow,
}) => {
    const hostMatch = new MatchPage(hostWindow);
    const clientMatch = new MatchPage(clientWindow);

    await requestPostMatchScene(hostApp, hostWindow);
    await Promise.all([acknowledgeSceneReady(hostWindow), acknowledgeSceneReady(clientWindow)]);

    await Promise.all([
        expect.poll(() => hostMatch.activeSceneId(), { timeout: 5_000 }).toBe('engine:post-match'),
        expect
            .poll(() => clientMatch.activeSceneId(), { timeout: 5_000 })
            .toBe('engine:post-match'),
    ]);
    await expect(hostMatch.transitionOverlay).toHaveCount(0);
    await expect(clientMatch.transitionOverlay).toHaveCount(0);
});
