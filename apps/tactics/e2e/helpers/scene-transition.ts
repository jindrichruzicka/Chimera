/**
 * e2e/helpers/scene-transition.ts
 *
 * One driver for the two-phase scene transition (§4.18–§4.19): wait until the
 * host scene manager is sitting on the scene being LEFT, then dispatch
 * `engine:scene_prepare` toward the next one through the same
 * `window.__chimera.game.sendAction` path the game itself uses.
 *
 * Extracted from `scene-transition.spec.ts` when a second spec started entering
 * a DIFFERENT scene through the same seam. The payload shape and the barrier
 * that precedes it are what neither spec is testing, so they belong in one
 * place rather than in two copies free to drift apart.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 *
 * Module boundary: must NOT import from electron/main/, renderer/, simulation/
 * or networking/. `@playwright/test` is the only import — the constants below
 * are therefore literals, and `scene-transition.test.ts` pins them against the
 * renderer source they mirror.
 */

import { expect, type ElectronApplication, type Page } from '@playwright/test';

/**
 * How long a spec may wait for the host scene manager to reach a scene.
 *
 * 15 s: the renderer's scene-preload budget (`SCENE_PRELOAD_BUDGET_MS`, 5 s, in
 * `renderer/components/scene/scenePreload.ts`) plus a 10 s margin for the commit
 * itself — two renderer acks and a host-side broadcast, on a CI runner an order
 * of magnitude slower than a developer machine.
 *
 * The margin has to CLEAR that budget, not merely exceed it: the budget is a
 * fail-open, so a preload which never settles releases the reveal when it
 * elapses and the transition still commits. A poll shorter than the budget
 * would red as its own timeout and report a hung barrier where the fail-open
 * was doing its job.
 *
 * Guarded from the renderer side rather than by an import — this module is
 * loaded by the Playwright runner and the boundary forbids it reaching into
 * `renderer/` (Invariant #96, `chimera/no-game-renderer-internals`).
 * `scenePreload.test.ts` names this same 15 s and asserts the budget stays
 * strictly under it, so a raised budget reds there; `scene-transition.test.ts`
 * pins the number here, so a shrunk poll reds there.
 */
export const SCENE_BARRIER_POLL_MS = 15_000;

/**
 * The fields of the host's last projected snapshot this suite reads. A view,
 * not the real `PlayerSnapshot`: importing that type would pull `simulation/`
 * into the e2e module graph for three fields.
 */
export interface HostSnapshotView {
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

/**
 * The host process's own view of what it last broadcast. Throws rather than
 * returning null: every caller needs a snapshot to proceed, so a missing hook
 * is a broken launch, not a state to poll through.
 */
export async function readHostSnapshot(hostApp: ElectronApplication): Promise<HostSnapshotView> {
    const snapshot = await hostApp.evaluate(() => globalThis.__e2eHooks?.lastHostSnapshot ?? null);
    if (!isHostSnapshotView(snapshot)) {
        throw new Error('Host E2E snapshot was not available');
    }
    return snapshot;
}

/**
 * Drive one scene transition from the host renderer.
 *
 * `fromSceneId` is a PRECONDITION, not a description: the dispatch is stamped
 * with the renderer's current tick, so sending it before the host has committed
 * the scene being left races the very transition it is asking for.
 */
export async function requestScene(
    hostApp: ElectronApplication,
    hostWindow: Page,
    toSceneId: string,
    fromSceneId: string,
): Promise<void> {
    await expect
        .poll(async () => (await readHostSnapshot(hostApp)).sceneId ?? null, {
            timeout: SCENE_BARRIER_POLL_MS,
        })
        .toBe(fromSceneId);

    await hostWindow.evaluate(async (sceneId) => {
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
                toSceneId: sceneId,
                params: {},
            },
        });
    }, toSceneId);
}
