/**
 * e2e/helpers/scene-transition.test.ts
 *
 * Unit tests for the scene-transition driver. Two specs now enter a scene
 * through this one helper, so what is pinned here is the part neither of them
 * asserts — the driver's own behaviour, which a passing spec exercises without
 * ever measuring and a failing one reaches only after the fact.
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

import {
    SCENE_BARRIER_POLL_MS,
    describeSceneBarrierStall,
    expectSceneCommitted,
    readHostSnapshot,
    requestScene,
    type HostSnapshotView,
} from './scene-transition';

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

// ---------------------------------------------------------------------------
// describeSceneBarrierStall
// ---------------------------------------------------------------------------

/**
 * One fixture per arm, because each arm names a DIFFERENT defect, and a
 * description that collapsed any two of them would send the next reader of a
 * timeout at the wrong half. The strings are pinned whole rather than by a
 * substring: what is under test is the diagnosis, and half of one still
 * contains the words of the arm it replaced.
 */
describe('describeSceneBarrierStall', () => {
    const TO_SCENE = 'tactics:asset-demo';

    it('says the snapshot was unreadable when there is none', () => {
        expect(describeSceneBarrierStall(null, TO_SCENE)).toContain('unreadable');
    });

    it('blames the prepare when no transition is in flight and the host never left the old scene', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: null,
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'no transition is in flight and the host is still on engine:game — ' +
                'engine:scene_prepare never landed',
        );
    });

    // The one arm that is NOT a barrier fault: the host is already there, so
    // whatever is late is downstream of the commit. Distinguished by the scene
    // id alone — a committed transition is erased, so both arms see `null`.
    it('blames the renderer when the host has already committed the entered scene', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: TO_SCENE,
            sceneTransition: null,
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'the host committed tactics:asset-demo — a renderer has not rendered it yet',
        );
    });

    it('blames both renderers when the transition is preparing and nobody has acked', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: { phase: 'preparing', playersReady: [] },
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'the transition is preparing and no player has acked — every renderer is ' +
                'still in its fade-out or scene preload',
        );
    });

    it('names the players that HAVE acked when the transition is preparing', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: { phase: 'preparing', playersReady: ['player-1'] },
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'the transition is preparing and is waiting on an ack — acked so far: player-1',
        );
    });

    it('blames the host commit driver when every player acked', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: { phase: 'ready', playersReady: ['player-1', 'player-2'] },
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'every player acked — the host has not applied engine:scene_commit',
        );
    });

    it('blames the commit broadcast while the transition is committing', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: { phase: 'committing', playersReady: ['player-1', 'player-2'] },
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'the commit is in flight — the entered scene has not reached the renderers',
        );
    });

    // `playersReady` is optional on the view too, and this function runs inside
    // the catch of a failing assertion — a `TypeError` here would REPLACE the
    // diagnosis with its own stack. One fixture per site that reads the list:
    // the length test in the `preparing` arm, and the join in the default one.
    it('treats a transition with no playersReady as nobody having acked', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: { phase: 'preparing' },
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'the transition is preparing and no player has acked — every renderer is ' +
                'still in its fade-out or scene preload',
        );
    });

    it('prints an empty ack list rather than throwing when an unrecognised phase has none', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: {},
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'the transition is in an unrecognised phase undefined — acked so far: ',
        );
    });

    // The view's `phase` is optional, so an unrecognised or missing one has to
    // print rather than fall into another arm's sentence.
    it('prints an unrecognised phase rather than guessing a half', () => {
        const snapshot: HostSnapshotView = {
            tick: 12,
            viewerId: 'player-1',
            sceneId: 'engine:game',
            sceneTransition: { playersReady: ['player-1'] },
        };

        expect(describeSceneBarrierStall(snapshot, TO_SCENE)).toBe(
            'the transition is in an unrecognised phase undefined — acked so far: player-1',
        );
    });
});

// ---------------------------------------------------------------------------
// expectSceneCommitted
// ---------------------------------------------------------------------------

describe('expectSceneCommitted', () => {
    it('polls every window on the barrier budget', async () => {
        const { app } = makeHostApp({
            snapshots: [{ tick: 1, viewerId: 'player-1', sceneId: 'tactics:asset-demo' }],
        });

        await expectSceneCommitted(
            app,
            {
                host: { committedScene: async () => 'tactics:asset-demo' },
                client: { committedScene: async () => 'tactics:asset-demo' },
            },
            'tactics:asset-demo',
        );

        expect(pollFake.calls).toEqual([
            { timeout: SCENE_BARRIER_POLL_MS, expected: 'tactics:asset-demo' },
            { timeout: SCENE_BARRIER_POLL_MS, expected: 'tactics:asset-demo' },
        ]);
    });

    it('keeps the poll failure and appends the stall and every window read', async () => {
        const { app } = makeHostApp({
            snapshots: [
                {
                    tick: 12,
                    viewerId: 'player-1',
                    sceneId: 'engine:game',
                    sceneTransition: { phase: 'preparing', playersReady: ['player-1'] },
                },
            ],
        });

        const failure = await expectSceneCommitted(
            app,
            {
                host: { committedScene: async () => 'engine:game' },
                client: { committedScene: async () => 'engine:game' },
            },
            'tactics:asset-demo',
        ).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

        // The matcher's own report survives: without it the message says which
        // half is late but not what was expected of which window.
        expect(failure).toContain('poll budget exhausted (fake)');
        expect(failure).toContain(
            'the transition is preparing and is waiting on an ack — acked so far: player-1',
        );
        // End-anchored: these probes declare NO stalled-state, so their lines
        // must END at the scene id. A substring check could not see a bogus
        // suffix — `undefined` from an unguarded optional call reads as a
        // stalled state the window never reported.
        expect(failure).toMatch(/^ {2}host: scene=engine:game$/m);
        expect(failure).toMatch(/^ {2}client: scene=engine:game$/m);
    });

    // The host snapshot names the seat that has not acked; only that seat's own
    // renderer says what it is stuck on, so a probe that offers one must have it
    // printed against the right window.
    it('prints each window stalled state beside its scene', async () => {
        const { app } = makeHostApp({
            snapshots: [
                {
                    tick: 12,
                    viewerId: 'player-1',
                    sceneId: 'engine:game',
                    sceneTransition: { phase: 'preparing', playersReady: ['player-1'] },
                },
            ],
        });

        const failure = await expectSceneCommitted(
            app,
            {
                host: {
                    committedScene: async () => 'engine:game',
                    stalledState: async () => 'fade=hold preload=1',
                },
                client: {
                    committedScene: async () => 'engine:game',
                    stalledState: async () => 'fade=fade-out preload=null',
                },
            },
            'tactics:asset-demo',
        ).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

        expect(failure).toContain('host: scene=engine:game fade=hold preload=1');
        expect(failure).toContain('client: scene=engine:game fade=fade-out preload=null');
    });

    // The matcher's own error object, not just its text: the rewritten message
    // is what a reader sees, and `cause` is what anything inspecting the
    // failure programmatically still has to reach.
    it('carries the original matcher error as the cause', async () => {
        const { app } = makeHostApp({
            snapshots: [{ tick: 12, viewerId: 'player-1', sceneId: 'engine:game' }],
        });

        const cause = await expectSceneCommitted(
            app,
            { host: { committedScene: async () => 'engine:game' } },
            'tactics:asset-demo',
        ).catch((error: unknown) => (error instanceof Error ? error.cause : null));

        expect(cause).toBeInstanceOf(Error);
        expect((cause as Error).message).toBe('poll budget exhausted (fake)');
    });

    // Promise.all rejects on the FIRST failure, so the sibling window's value is
    // unknown at that moment — re-read here, and a window that cannot be read
    // must not replace the diagnosis with its own throw.
    it('reports a window that throws on re-read rather than losing the diagnosis', async () => {
        const { app } = makeHostApp({
            snapshots: [
                {
                    tick: 12,
                    viewerId: 'player-1',
                    sceneId: 'engine:game',
                    sceneTransition: { phase: 'preparing', playersReady: [] },
                },
            ],
        });

        const failure = await expectSceneCommitted(
            app,
            {
                host: { committedScene: async () => 'engine:game' },
                client: {
                    committedScene: async () => {
                        throw new Error('Target page closed');
                    },
                },
            },
            'tactics:asset-demo',
        ).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

        expect(failure).toContain('client: scene=<unreadable>');
        expect(failure).toContain('no player has acked');
    });

    // The interface asks implementors not to throw, but the helper must not
    // BET the diagnosis on that: it runs inside a failing spec, and a probe
    // author's mistake would otherwise replace the whole composed report with
    // its own stack — the exact loss this function exists to prevent.
    it('reports a stalled-state probe that throws rather than losing the diagnosis', async () => {
        const { app } = makeHostApp({
            snapshots: [
                {
                    tick: 12,
                    viewerId: 'player-1',
                    sceneId: 'engine:game',
                    sceneTransition: { phase: 'preparing', playersReady: [] },
                },
            ],
        });

        const failure = await expectSceneCommitted(
            app,
            {
                host: {
                    committedScene: async () => 'engine:game',
                    stalledState: async () => {
                        throw new Error('Execution context was destroyed');
                    },
                },
            },
            'tactics:asset-demo',
        ).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

        expect(failure).toContain('host: scene=engine:game <stalled-state unreadable>');
        expect(failure).toContain('no player has acked');
    });

    it('still names the budget when the host snapshot cannot be read at all', async () => {
        const { app } = makeHostApp({ snapshots: [undefined] });

        const failure = await expectSceneCommitted(
            app,
            { host: { committedScene: async () => 'engine:game' } },
            'tactics:asset-demo',
        ).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

        expect(failure).toContain('unreadable');
        expect(failure).toContain(String(SCENE_BARRIER_POLL_MS));
    });
});
