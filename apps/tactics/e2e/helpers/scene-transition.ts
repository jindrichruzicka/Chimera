/**
 * e2e/helpers/scene-transition.ts
 *
 * The shared seam onto the two-phase scene transition (§4.18–§4.19): driving a
 * hop through the same `window.__chimera.game.sendAction` path the game itself
 * uses, and waiting for one to arrive.
 *
 * Extracted from `scene-transition.spec.ts` when a second spec started entering
 * a DIFFERENT scene through the same seam. What lives here is what neither spec
 * is testing, so it sits in one place rather than in two copies free to drift
 * apart.
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
 * Which half of the hop is late, read off the host's own view of the barrier.
 *
 * A barrier poll that times out reports `Expected <scene> / Received <scene>`
 * and nothing else, which is true of every way a hop can fail to arrive: the
 * prepare never landing, a renderer never acking, the host never committing and
 * the commit never reaching a renderer are one message. Each arm below names a
 * different one of those, so a timeout points at a suspect instead of at the
 * barrier as a whole.
 *
 * Pure, and takes the snapshot rather than reading one: the arms are the part
 * worth pinning, and the read that feeds them can fail on its own terms —
 * `null` is that case, not an absent transition.
 */
export function describeSceneBarrierStall(
    snapshot: HostSnapshotView | null,
    toSceneId: string,
): string {
    if (snapshot === null) {
        return 'the host snapshot was unreadable, so which half is late is unknown';
    }

    const transition = snapshot.sceneTransition;
    if (transition === undefined || transition === null) {
        // A committed transition is ERASED, so both arms here see the same
        // absent transition; the scene id is the only thing that separates
        // "already there" from "never started".
        return snapshot.sceneId === toSceneId
            ? `the host committed ${toSceneId} — a renderer has not rendered it yet`
            : `no transition is in flight and the host is still on ${String(snapshot.sceneId)} — ` +
                  'engine:scene_prepare never landed';
    }

    const acked = transition.playersReady ?? [];
    switch (transition.phase) {
        case 'preparing':
            return acked.length === 0
                ? 'the transition is preparing and no player has acked — every renderer is ' +
                      'still in its fade-out or scene preload'
                : `the transition is preparing and is waiting on an ack — acked so far: ${acked.join(', ')}`;
        case 'ready':
            return 'every player acked — the host has not applied engine:scene_commit';
        case 'committing':
            return 'the commit is in flight — the entered scene has not reached the renderers';
        default:
            return (
                `the transition is in an unrecognised phase ${String(transition.phase)} — ` +
                `acked so far: ${acked.join(', ')}`
            );
    }
}

/** What one window can be asked about a hop it is waiting on. */
export interface CommittedSceneProbe {
    /** The scene router's committed scene id — the value the barrier polls. */
    committedScene(): Promise<string | null>;
    /**
     * That window's own view of a transition that has not landed, printed
     * beside its scene when the hop never arrives. Optional: the host snapshot
     * already names the seat that has not acked, and this is what says what
     * that seat is stuck on. Must not throw — it runs inside a failure.
     */
    stalledState?(): Promise<string>;
}

/**
 * Wait for every window to commit `toSceneId`, and say WHY if they do not.
 *
 * The wait itself is the same per-window `expect.poll` each spec used to write
 * out; what this adds is the failure path. `Promise.all` rejects on the first
 * window to time out, so at that moment the sibling's state is unknown and the
 * host's is unread — both are gathered here and appended to the matcher's own
 * report, which is kept so the message still says what was expected of which
 * window.
 */
export async function expectSceneCommitted(
    hostApp: ElectronApplication,
    windows: Readonly<Record<string, CommittedSceneProbe>>,
    toSceneId: string,
): Promise<void> {
    const probes = Object.entries(windows);
    try {
        await Promise.all(
            probes.map(async ([, probe]) =>
                expect
                    .poll(() => probe.committedScene(), { timeout: SCENE_BARRIER_POLL_MS })
                    .toBe(toSceneId),
            ),
        );
    } catch (error: unknown) {
        const stall = describeSceneBarrierStall(await readHostSnapshotOrNull(hostApp), toSceneId);
        throw new Error(
            `${error instanceof Error ? error.message : String(error)}\n\n` +
                `The scene barrier did not commit ${toSceneId} within ${SCENE_BARRIER_POLL_MS} ms.\n` +
                `Which half is late: ${stall}\n` +
                `${await readWindowStates(probes)}`,
            // The message is rewritten, so the matcher's own error survives only
            // here — everything reading a failure programmatically needs it.
            { cause: error },
        );
    }
}

/** {@link readHostSnapshot}, demoted to a value: a diagnosis must not throw its own error. */
async function readHostSnapshotOrNull(
    hostApp: ElectronApplication,
): Promise<HostSnapshotView | null> {
    try {
        return await readHostSnapshot(hostApp);
    } catch {
        return null;
    }
}

/**
 * One line per window: the scene it is on, plus whatever it says about the hop
 * it never made. `Promise.all` above rejects on the FIRST window to time out, so
 * every window is re-read here — including the siblings, whose state at that
 * moment is otherwise unknown. A window that cannot be read is named, never
 * thrown from.
 */
async function readWindowStates(
    probes: readonly (readonly [string, CommittedSceneProbe])[],
): Promise<string> {
    const lines = await Promise.all(
        probes.map(async ([label, probe]) => {
            let scene: string;
            try {
                scene = String(await probe.committedScene());
            } catch {
                scene = '<unreadable>';
            }
            // The interface asks implementors not to throw, but the diagnosis
            // must not BET on that: a probe author's mistake here would
            // replace the whole composed report with its own stack.
            let stalled = '';
            if (probe.stalledState !== undefined) {
                try {
                    stalled = ` ${await probe.stalledState()}`;
                } catch {
                    stalled = ' <stalled-state unreadable>';
                }
            }
            return `  ${label}: scene=${scene}${stalled}`;
        }),
    );
    return `Per window:\n${lines.join('\n')}`;
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
