/**
 * e2e/helpers/scene-transition.test.ts
 *
 * Unit tests for the scene-transition driver. Two specs now enter a scene
 * through this one helper, so what is pinned here is the part neither of them
 * asserts: the ORDER (the from-scene barrier is cleared before anything is
 * dispatched), the dispatched payload, and the budget the barrier poll is
 * handed.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 *
 * Tests written FIRST (red confirmed before implementation).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronApplication, Page } from '@playwright/test';

// `expect.poll` is this module's whole seam onto Playwright, so it is faked
// rather than stubbed away: the fake records the budget it was handed, re-runs
// the probe until the verdict matches (as the real matcher does), and throws
// when the probe never converges.
const pollFake = vi.hoisted(() => ({
    calls: [] as { readonly timeout: number | undefined; readonly expected: unknown }[],
    probeRuns: 8,
    reset(): void {
        pollFake.calls = [];
        pollFake.probeRuns = 8;
    },
}));

vi.mock('@playwright/test', () => ({
    expect: {
        poll: (probe: () => Promise<unknown>, options?: { readonly timeout?: number }) => ({
            async toBe(expected: unknown): Promise<void> {
                for (let run = 0; run < pollFake.probeRuns; run += 1) {
                    if ((await probe()) === expected) {
                        pollFake.calls.push({ timeout: options?.timeout, expected });
                        return;
                    }
                }
                throw new Error('poll budget exhausted (fake)');
            },
        }),
    },
}));

import { SCENE_BARRIER_POLL_MS, readHostSnapshot, requestScene } from './scene-transition';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

interface HostState {
    readonly snapshots: readonly unknown[];
}

/**
 * An ElectronApplication whose `evaluate` runs the callback against a
 * `globalThis.__e2eHooks` seeded from a queue — one entry consumed per read, the
 * last entry repeating, so a test can make the host arrive on the from-scene
 * only after N polls.
 */
function makeHostApp(state: HostState): {
    readonly app: ElectronApplication;
    reads(): number;
} {
    let reads = 0;
    const app = {
        evaluate: vi.fn(async (fn: () => unknown) => {
            const queued = state.snapshots[Math.min(reads, state.snapshots.length - 1)];
            reads += 1;
            (globalThis as { __e2eHooks?: unknown }).__e2eHooks =
                queued === undefined ? undefined : { lastHostSnapshot: queued };
            return fn();
        }),
        // @chimera-review: partial mock of ElectronApplication (Playwright external class) — only evaluate() is exercised
    } as unknown as ElectronApplication;
    return { app, reads: () => reads };
}

interface DispatchRecord {
    readonly action: unknown;
    /** How many host snapshot reads had happened when this dispatch landed. */
    readonly hostReadsBefore: number;
}

interface WindowGameApi {
    readonly sendAction?: unknown;
    readonly getCurrentSnapshot?: unknown;
}

function makeHostWindow(gameApi: WindowGameApi): Page {
    return {
        evaluate: vi.fn(async (fn: (arg: string) => Promise<void>, arg: string) => {
            (globalThis as { __chimera?: unknown }).__chimera = { game: gameApi };
            await fn(arg);
        }),
        // @chimera-review: partial mock of Page (Playwright external class) — only evaluate() is exercised
    } as unknown as Page;
}

/** A game api that records every dispatched action with the poll count at that moment. */
function makeRecordingGameApi(
    dispatched: DispatchRecord[],
    hostReads: () => number,
    snapshot: unknown = { tick: 42, viewerId: 'player-1' },
): WindowGameApi {
    return {
        sendAction: (action: unknown): void => {
            dispatched.push({ action, hostReadsBefore: hostReads() });
        },
        getCurrentSnapshot: async (): Promise<unknown> => snapshot,
    };
}

beforeEach(() => {
    pollFake.reset();
    (globalThis as { __e2eHooks?: unknown }).__e2eHooks = undefined;
    (globalThis as { __chimera?: unknown }).__chimera = undefined;
});

// ---------------------------------------------------------------------------
// Barrier budget
// ---------------------------------------------------------------------------

describe('SCENE_BARRIER_POLL_MS', () => {
    // The half of the budget relation that lives on this side of the module
    // boundary. `renderer/components/scene/scenePreload.test.ts` names the same
    // 15 s and asserts `SCENE_PRELOAD_BUDGET_MS` (5 s) stays strictly under it,
    // so a raised budget reds there. Pinning the literal here is what stops the
    // poll being shrunk under the fail-open from this side, where that test
    // cannot see it.
    it('is the 15 s the renderer budget is set against', () => {
        expect(SCENE_BARRIER_POLL_MS).toBe(15_000);
    });
});

// ---------------------------------------------------------------------------
// readHostSnapshot
// ---------------------------------------------------------------------------

describe('readHostSnapshot', () => {
    it('returns the snapshot the host E2E hook is holding', async () => {
        const { app } = makeHostApp({
            snapshots: [{ tick: 7, viewerId: 'player-1', sceneId: 'engine:game' }],
        });

        await expect(readHostSnapshot(app)).resolves.toEqual({
            tick: 7,
            viewerId: 'player-1',
            sceneId: 'engine:game',
        });
    });

    it('throws when the host hook is absent', async () => {
        const { app } = makeHostApp({ snapshots: [undefined] });

        await expect(readHostSnapshot(app)).rejects.toThrow('Host E2E snapshot was not available');
    });

    // One fixture per conjunct of the guard: a view is a view only if BOTH
    // fields are the right shape, and a fixture invalid on two axes at once
    // measures neither of them.
    it('throws when the hook holds a value with no tick', async () => {
        const { app } = makeHostApp({ snapshots: [{ viewerId: 'player-1' }] });

        await expect(readHostSnapshot(app)).rejects.toThrow('Host E2E snapshot was not available');
    });

    it('throws when the hook holds a value with no viewerId', async () => {
        const { app } = makeHostApp({ snapshots: [{ tick: 7 }] });

        await expect(readHostSnapshot(app)).rejects.toThrow('Host E2E snapshot was not available');
    });
});

// ---------------------------------------------------------------------------
// requestScene
// ---------------------------------------------------------------------------

describe('requestScene', () => {
    it('waits for the host to be sitting on the from-scene before dispatching', async () => {
        const { app, reads } = makeHostApp({
            snapshots: [
                { tick: 1, viewerId: 'player-1', sceneId: 'engine:menu' },
                { tick: 2, viewerId: 'player-1', sceneId: 'engine:menu' },
                { tick: 3, viewerId: 'player-1', sceneId: 'engine:game' },
            ],
        });
        const dispatched: DispatchRecord[] = [];
        const hostWindow = makeHostWindow(makeRecordingGameApi(dispatched, reads));

        await requestScene(app, hostWindow, 'tactics:asset-demo', 'engine:game');

        // Three reads to converge, and the dispatch landed after all of them —
        // the barrier is a precondition of the dispatch, not a companion to it.
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]?.hostReadsBefore).toBe(3);
    });

    it('waits for the from-scene it was GIVEN, not for the in-match one', async () => {
        // The parameter is the whole reason this helper is shared: one spec
        // enters from `engine:game`, and a caller leaving a different scene must
        // not be released by the in-match scene going past. A body that ignored
        // the argument and waited for `engine:game` would converge on the FIRST
        // read here instead of the second.
        const { app, reads } = makeHostApp({
            snapshots: [
                { tick: 1, viewerId: 'player-1', sceneId: 'engine:game' },
                { tick: 2, viewerId: 'player-1', sceneId: 'engine:post-game' },
            ],
        });
        const dispatched: DispatchRecord[] = [];
        const hostWindow = makeHostWindow(makeRecordingGameApi(dispatched, reads));

        await requestScene(app, hostWindow, 'tactics:asset-demo', 'engine:post-game');

        expect(dispatched[0]?.hostReadsBefore).toBe(2);
    });

    it('polls the from-scene on the barrier budget', async () => {
        const { app, reads } = makeHostApp({
            snapshots: [{ tick: 1, viewerId: 'player-1', sceneId: 'engine:game' }],
        });
        const dispatched: DispatchRecord[] = [];
        const hostWindow = makeHostWindow(makeRecordingGameApi(dispatched, reads));

        await requestScene(app, hostWindow, 'tactics:asset-demo', 'engine:game');

        expect(pollFake.calls).toEqual([
            { timeout: SCENE_BARRIER_POLL_MS, expected: 'engine:game' },
        ]);
    });

    it('dispatches engine:scene_prepare toward the requested scene, stamped with the renderer snapshot', async () => {
        const { app, reads } = makeHostApp({
            snapshots: [{ tick: 1, viewerId: 'host-seat', sceneId: 'engine:game' }],
        });
        const dispatched: DispatchRecord[] = [];
        const hostWindow = makeHostWindow(
            makeRecordingGameApi(dispatched, reads, { tick: 99, viewerId: 'renderer-seat' }),
        );

        await requestScene(app, hostWindow, 'tactics:asset-demo', 'engine:game');

        expect(dispatched[0]?.action).toEqual({
            type: 'engine:scene_prepare',
            playerId: 'renderer-seat',
            tick: 99,
            payload: { toSceneId: 'tactics:asset-demo', params: {} },
        });
    });

    it('throws when the renderer exposes no sendAction', async () => {
        const { app } = makeHostApp({
            snapshots: [{ tick: 1, viewerId: 'player-1', sceneId: 'engine:game' }],
        });
        const hostWindow = makeHostWindow({ getCurrentSnapshot: () => null });

        await expect(
            requestScene(app, hostWindow, 'tactics:asset-demo', 'engine:game'),
        ).rejects.toThrow('window.__chimera.game.sendAction is unavailable');
    });

    it('throws when the renderer exposes no getCurrentSnapshot', async () => {
        const { app } = makeHostApp({
            snapshots: [{ tick: 1, viewerId: 'player-1', sceneId: 'engine:game' }],
        });
        const hostWindow = makeHostWindow({ sendAction: () => undefined });

        await expect(
            requestScene(app, hostWindow, 'tactics:asset-demo', 'engine:game'),
        ).rejects.toThrow('window.__chimera.game.getCurrentSnapshot is unavailable');
    });

    it('throws when the renderer has no current snapshot to stamp the action with', async () => {
        const { app, reads } = makeHostApp({
            snapshots: [{ tick: 1, viewerId: 'player-1', sceneId: 'engine:game' }],
        });
        const dispatched: DispatchRecord[] = [];
        const hostWindow = makeHostWindow(makeRecordingGameApi(dispatched, reads, null));

        await expect(
            requestScene(app, hostWindow, 'tactics:asset-demo', 'engine:game'),
        ).rejects.toThrow('Renderer current snapshot was not available');
    });
});
