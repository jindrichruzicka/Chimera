/**
 * electron/main/runtime/SessionRuntime.test.ts
 *
 * Verifies the live-snapshot holder used by the hosted-session callback.
 *
 * Architecture: §4.11 — Save / Load · §4.7 — ActionPipeline host bootstrap.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_SCENE_TRANSITION_BUDGET_MS,
    HOST_ENGINE_VERSION,
    SessionCommitmentRuntime,
    SessionRuntime,
    type ApplyActionFn,
    type E2eSessionRuntime,
} from './SessionRuntime.js';
import { toSlotId } from '../../preload/api-types.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import {
    entityId,
    playerId as toPlayerId,
    sceneId,
} from '@chimera-engine/simulation/engine/types.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera-engine/tactics/simulation/constants.js';
import { tacticsGridCoordinate } from '@chimera-engine/tactics/simulation/actions.js';
import type { TacticsCommitmentEnvelopeValue } from '@chimera-engine/tactics/simulation/commitment/contract.js';
import { RevealStaging } from '@chimera-engine/simulation/projection/index.js';
import { CURRENT_SCHEMA_VERSION } from '@chimera-engine/simulation/persistence/SaveMigrator.js';
import type { SaveFile } from '@chimera-engine/simulation/persistence/SaveFile.js';
import {
    CommitmentVerificationError,
    toCommitmentId,
    type CommitmentEnvelope,
    type CommitmentReveal,
} from '@chimera-engine/simulation/projection/index.js';

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');
const COMMITMENT_ID = toCommitmentId('commitment-1');
const COMMITMENT_NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const COMMITTED_VALUE = Object.freeze({ card: 'ace-of-stars', drawIndex: 2 });

function sha256Commitment(value: unknown, nonce: string): string {
    return createHash('sha256')
        .update(`${JSON.stringify(value)}${nonce}`)
        .digest('hex');
}

function makeEnvelope(value: unknown = COMMITTED_VALUE): CommitmentEnvelope {
    return {
        id: COMMITMENT_ID,
        commitment: sha256Commitment(value, COMMITMENT_NONCE),
    };
}

function makeReveal(value: unknown = COMMITTED_VALUE): CommitmentReveal {
    return {
        id: COMMITMENT_ID,
        value,
        nonce: COMMITMENT_NONCE,
    };
}

function makePendingCommitments(): SaveFile['pendingCommitments'] {
    return {
        [COMMITMENT_ID]: makeEnvelope(),
    };
}

function makeSnapshot(tick: number, ids: readonly PlayerId[] = [P1]): BaseGameSnapshot {
    return {
        tick,
        seed: 7,
        players: Object.fromEntries(ids.map((id) => [id, { id }])),
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: tick,
        timers: {},
        gameResult: null,
    };
}

const dummyEnvelope: ActionEnvelope = {
    type: 'engine:end_turn',
    playerId: P1,
    tick: 0,
    payload: {},
};

/** Minimal valid session manifest for restore fixtures. */
const TEST_SESSION: SaveFile['session'] = {
    matchId: 'match-test-fixture',
    maxPlayers: 2,
    seats: [
        { playerId: P1, control: 'host', slotIndex: 0 },
        { playerId: P2, control: 'remote', slotIndex: 1 },
    ],
};

/** A save file carrying `checkpoint`, for the restore-path cases. */
function makeRestoredSaveFile(checkpoint: BaseGameSnapshot): SaveFile {
    return {
        header: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            engineVersion: HOST_ENGINE_VERSION,
            gameId: 'tactics',
            gameVersion: '0.1.0',
            slotId: 'tactics/slot-1',
            savedAt: 1,
            turnNumber: checkpoint.turnNumber,
            playerNames: ['Alice', 'Bob'],
        },
        checkpoint,
        deltaActions: [],
        pendingCommitments: {},
        stagedReveals: {},
        session: TEST_SESSION,
    };
}

describe('SessionRuntime', () => {
    it('returns the initial snapshot from getSnapshot() before any action is applied', () => {
        const initial = makeSnapshot(0);
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: vi.fn(),
        });
        expect(runtime.getSnapshot()).toBe(initial);
    });

    it('applyAction delegates to the injected applyActionFn and stores the result', () => {
        const initial = makeSnapshot(0);
        const next = makeSnapshot(1);
        const apply: ApplyActionFn = vi.fn().mockReturnValue(next);
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: apply,
        });

        runtime.applyAction(dummyEnvelope);

        expect(apply).toHaveBeenCalledWith(initial, dummyEnvelope);
        expect(runtime.getSnapshot()).toBe(next);
    });

    it('dispatchTick sends an engine:tick envelope stamped from the current snapshot', () => {
        const initial = makeSnapshot(4);
        const next = makeSnapshot(5);
        const apply: ApplyActionFn = vi.fn().mockReturnValue(next);
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: apply,
        });

        // Cast to the narrow E2E interface — the method is intentionally private
        // on SessionRuntime and exposed only through E2eSessionRuntime so
        // production callers cannot inadvertently trigger a bare engine:tick.
        // @chimera-review: cast is the ONLY permitted path to dispatchTick (WARN-1 fix).
        (runtime as unknown as E2eSessionRuntime).dispatchTick(P1);

        expect(apply).toHaveBeenCalledWith(initial, {
            type: 'engine:tick',
            playerId: P1,
            tick: initial.tick,
            payload: { seed: initial.seed },
        });
        expect(runtime.getSnapshot()).toBe(next);
    });

    it('dispatchTick is not accessible on the production SessionRuntime public API (compile-time enforcement)', () => {
        const initial = makeSnapshot(0);
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: vi.fn(),
        });

        // Type-level guarantee: SessionRuntime has no public `dispatchTick`.
        // If this @ts-expect-error is ever reported as "unused", the method has
        // been accidentally made public again — make this test RED and fix.
        // @ts-expect-error — dispatchTick must not be accessible on SessionRuntime
        void runtime.dispatchTick;
    });

    it('auto-dispatches engine:scene_commit when a scene_ready action completes the readiness barrier', () => {
        const initial = makeSnapshot(0, [P1, P2]);
        const ready = {
            ...initial,
            tick: 1,
            hostPlayerId: P1,
            sceneId: sceneId('engine:game'),
            sceneTransition: {
                toSceneId: sceneId('engine:post-game'),
                phase: 'ready' as const,
                startedAtTick: 0,
                params: {},
                playersReady: [P1, P2],
            },
        } satisfies BaseGameSnapshot;
        const committed = {
            ...ready,
            tick: 2,
            sceneId: sceneId('engine:post-game'),
            sceneTransition: null,
        } satisfies BaseGameSnapshot;
        const apply: ApplyActionFn = vi
            .fn()
            .mockReturnValueOnce(ready)
            .mockReturnValueOnce(committed);
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: apply,
        });

        runtime.applyAction({
            type: 'engine:scene_ready',
            playerId: P2,
            tick: 0,
            payload: { playerId: P2 },
        });

        expect(apply).toHaveBeenCalledTimes(2);
        expect(apply).toHaveBeenNthCalledWith(2, ready, {
            type: 'engine:scene_commit',
            playerId: P1,
            tick: 1,
            payload: {},
        });
        expect(runtime.getSnapshot()).toBe(committed);
    });

    it('auto-dispatches engine:scene_commit when a transition times out with proceed policy', () => {
        const initial = makeSnapshot(0, [P1, P2]);
        const timedOutPreparing = {
            ...initial,
            tick: 10,
            hostPlayerId: P1,
            sceneId: sceneId('engine:game'),
            sceneTransition: {
                toSceneId: sceneId('engine:post-game'),
                phase: 'preparing' as const,
                startedAtTick: 5,
                params: {},
                playersReady: [P1],
                timeoutTicks: 3,
                onClientTimeout: 'proceed' as const,
            },
        } satisfies BaseGameSnapshot;
        const committed = {
            ...timedOutPreparing,
            tick: 11,
            sceneId: sceneId('engine:post-game'),
            sceneTransition: null,
        } satisfies BaseGameSnapshot;
        const apply: ApplyActionFn = vi
            .fn()
            .mockReturnValueOnce(timedOutPreparing)
            .mockReturnValueOnce(committed);
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: apply,
        });

        runtime.applyAction({
            type: 'engine:tick',
            playerId: P1,
            tick: 0,
            payload: { seed: 1 },
        });

        expect(apply).toHaveBeenCalledTimes(2);
        expect(apply).toHaveBeenNthCalledWith(2, timedOutPreparing, {
            type: 'engine:scene_commit',
            playerId: P1,
            tick: timedOutPreparing.tick,
            payload: {},
        });
        expect(runtime.getSnapshot()).toBe(committed);
    });

    it('auto-dispatches engine:scene_drop when a transition times out with drop policy', () => {
        const initial = makeSnapshot(0, [P1, P2]);
        const timedOutPreparing = {
            ...initial,
            tick: 10,
            hostPlayerId: P1,
            sceneId: sceneId('engine:game'),
            sceneTransition: {
                toSceneId: sceneId('engine:post-game'),
                phase: 'preparing' as const,
                startedAtTick: 5,
                params: {},
                playersReady: [P1],
                timeoutTicks: 3,
                onClientTimeout: 'drop' as const,
            },
        } satisfies BaseGameSnapshot;
        const dropped = {
            ...timedOutPreparing,
            tick: 11,
            sceneTransition: null,
        } satisfies BaseGameSnapshot;
        const apply: ApplyActionFn = vi
            .fn()
            .mockReturnValueOnce(timedOutPreparing)
            .mockReturnValueOnce(dropped);
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: apply,
        });

        runtime.applyAction({
            type: 'engine:tick',
            playerId: P1,
            tick: 0,
            payload: { seed: 1 },
        });

        expect(apply).toHaveBeenCalledTimes(2);
        expect(apply).toHaveBeenNthCalledWith(2, timedOutPreparing, {
            type: 'engine:scene_drop',
            playerId: P1,
            tick: timedOutPreparing.tick,
            payload: {},
        });
        expect(runtime.getSnapshot()).toBe(dropped);
    });

    it('dispatches engine:scene_expire when its wall-clock budget elapses on a pending transition', () => {
        // The seat that never acks. `engine:scene_ready` is produced only
        // inside a mounted `SceneRouter`, so an AI seat or a disconnected one
        // sends none, and `timeoutTicks` cannot cover for it — a tick advances
        // only when an action is applied, and a turn-based match applies none
        // while the transition is pending. The host measures the wait instead,
        // here, where a clock is allowed to exist.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pending = {
                ...initial,
                tick: 2,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'preparing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                    timeoutTicks: 1_800,
                },
            } satisfies BaseGameSnapshot;
            const expired = {
                ...pending,
                tick: 3,
                sceneTransition: { ...pending.sceneTransition, expired: true },
            } satisfies BaseGameSnapshot;
            const committed = {
                ...expired,
                tick: 4,
                sceneId: sceneId('engine:post-game'),
                sceneTransition: null,
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi
                .fn()
                .mockReturnValueOnce(pending)
                .mockReturnValueOnce(expired)
                .mockReturnValueOnce(committed);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });

            // Nothing yet: the budget is a rescue, not a schedule.
            expect(apply).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(4_999);
            expect(apply).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(1);

            expect(apply).toHaveBeenNthCalledWith(2, pending, {
                type: 'engine:scene_expire',
                playerId: P1,
                tick: pending.tick,
                payload: {},
            });
            // And the expiry alone releases nothing — it unblocks the commit
            // the existing resolution path then dispatches, per the
            // descriptor's own policy.
            expect(apply).toHaveBeenNthCalledWith(3, expired, {
                type: 'engine:scene_commit',
                playerId: P1,
                tick: expired.tick,
                payload: {},
            });
            expect(runtime.getSnapshot()).toBe(committed);
        } finally {
            vi.useRealTimers();
        }
    });

    it('arms no expiry budget while no transition is pending, and disarms one that resolved', () => {
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const noTransition = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi.fn().mockReturnValue(noTransition);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:end_turn',
                playerId: P1,
                tick: 0,
                payload: {},
            });

            // The TIMER, not just the dispatch it would produce: an armed timer
            // whose callback happens to return early is invisible in the call
            // count, and an idle host holding one per applied action is the
            // leak this asserts against.
            expect(vi.getTimerCount()).toBe(0);

            vi.advanceTimersByTime(60_000);
            expect(apply).toHaveBeenCalledTimes(1);
            expect(runtime.getSnapshot()).toBe(noTransition);
        } finally {
            vi.useRealTimers();
        }
    });

    it('disarms the budget once the transition it was measuring has resolved', () => {
        // Same reason the idle case asserts the timer: after the expiry lands,
        // the transition is waiting on the commit beside it and not on an ack,
        // so a re-armed budget would only expire what is already expired — and
        // would do it invisibly, since the callback returns early.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pending = {
                ...initial,
                tick: 2,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'preparing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                },
            } satisfies BaseGameSnapshot;
            const expired = {
                ...pending,
                tick: 3,
                sceneTransition: { ...pending.sceneTransition, expired: true },
            } satisfies BaseGameSnapshot;
            const committed = {
                ...expired,
                tick: 4,
                sceneId: sceneId('engine:post-game'),
                sceneTransition: null,
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi
                .fn()
                .mockReturnValueOnce(pending)
                .mockReturnValueOnce(expired)
                .mockReturnValueOnce(committed);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });
            expect(vi.getTimerCount()).toBe(1);

            vi.advanceTimersByTime(5_000);

            // The expiry fired, the commit followed, and nothing is left armed.
            expect(apply).toHaveBeenCalledTimes(3);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('falls back to the exported default budget when none is injected', () => {
        // Production wires no budget, so the default is the only value that
        // ever runs in a shipped game — and every other case here injects one,
        // which would leave it measured by nothing.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pending = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'preparing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                },
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi.fn().mockReturnValue(pending);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });

            // The VALUE, against a literal rather than against itself: it has
            // to outlast every client-side budget that can compose beneath it —
            // the scene preload's 5 s, the route gate's 8 s and the shell
            // warm-up's 5 s — so a slow-but-live client is never mistaken for a
            // seat that cannot ack. Lowering it is a decision, and this is
            // where it has to be made rather than noticed.
            expect(DEFAULT_SCENE_TRANSITION_BUDGET_MS).toBe(30_000);

            vi.advanceTimersByTime(DEFAULT_SCENE_TRANSITION_BUDGET_MS - 1);
            expect(apply).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(1);
            expect(apply).toHaveBeenNthCalledWith(2, pending, {
                type: 'engine:scene_expire',
                playerId: P1,
                tick: pending.tick,
                payload: {},
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears the armed budget when the transition resolves normally, before it can fire', () => {
        // A transition every seat acks resolves long before the budget. The
        // timer it armed has to go with it: left running, it would fire during
        // the NEXT transition — and since a timer is only armed when none is
        // outstanding, that next transition would inherit a budget already
        // most of the way spent, and be expired early.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pending = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'preparing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                },
            } satisfies BaseGameSnapshot;
            const settled = {
                ...pending,
                tick: 2,
                sceneId: sceneId('engine:post-game'),
                sceneTransition: null,
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi
                .fn()
                .mockReturnValueOnce(pending)
                .mockReturnValueOnce(settled);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });
            expect(vi.getTimerCount()).toBe(1);

            runtime.applyAction({
                type: 'engine:end_turn',
                playerId: P1,
                tick: 1,
                payload: {},
            });

            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(60_000);
            expect(apply).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('dispose() releases a budget armed mid-transition, and a restore arms one', () => {
        // Two lifecycle edges the applied-action path does not cover. A session
        // torn down mid-transition would otherwise expire it 30 s later into a
        // pipeline nobody is listening to; and a save captured mid-transition
        // restores a snapshot already waiting on an ack, whose budget would
        // start only at the next action a stalled session may never see.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pendingTransition = {
                toSceneId: sceneId('engine:post-game'),
                phase: 'preparing' as const,
                startedAtTick: 0,
                params: {},
                playersReady: [P1],
            };
            const pending = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: pendingTransition,
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi.fn().mockReturnValue(pending);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });
            expect(vi.getTimerCount()).toBe(1);

            runtime.dispose();
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(60_000);
            expect(apply).toHaveBeenCalledTimes(1);

            // And the restore edge: a checkpoint that is already mid-transition
            // arms the budget without waiting for an action.
            runtime.applyRestoredFile({
                header: {
                    schemaVersion: CURRENT_SCHEMA_VERSION,
                    engineVersion: HOST_ENGINE_VERSION,
                    gameId: 'tactics',
                    gameVersion: '0.1.0',
                    slotId: 'tactics/slot-1',
                    savedAt: 1,
                    turnNumber: pending.turnNumber,
                    playerNames: ['Alice', 'Bob'],
                },
                checkpoint: pending,
                deltaActions: [],
                pendingCommitments: {},
                stagedReveals: {},
                session: TEST_SESSION,
            });
            expect(vi.getTimerCount()).toBe(1);
            runtime.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives a restored transition its OWN budget, not what was left of the previous one', () => {
        // The applied-action path keeps a running timer because it is measuring
        // the same transition. A restore can deliver a DIFFERENT one, and
        // inheriting the remainder would expire it almost immediately —
        // committing or dropping a scene no client has had the chance to ack,
        // which is the failure the budget's size exists to prevent.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const transitionOf = (to: string, startedAtTick: number) => ({
                toSceneId: sceneId(to),
                phase: 'preparing' as const,
                startedAtTick,
                params: {},
                playersReady: [P1],
            });
            const first = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: transitionOf('engine:post-game', 0),
            } satisfies BaseGameSnapshot;
            const restored = {
                ...first,
                tick: 9,
                sceneTransition: transitionOf('engine:credits', 9),
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi.fn().mockReturnValue(first);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });
            vi.advanceTimersByTime(4_000);

            runtime.applyRestoredFile({
                header: {
                    schemaVersion: CURRENT_SCHEMA_VERSION,
                    engineVersion: HOST_ENGINE_VERSION,
                    gameId: 'tactics',
                    gameVersion: '0.1.0',
                    slotId: 'tactics/slot-1',
                    savedAt: 1,
                    turnNumber: restored.turnNumber,
                    playerNames: ['Alice', 'Bob'],
                },
                checkpoint: restored,
                deltaActions: [],
                pendingCommitments: {},
                stagedReveals: {},
                session: TEST_SESSION,
            });

            // The 1 000 ms left of the first budget must NOT expire the
            // restored transition.
            vi.advanceTimersByTime(1_000);
            expect(apply).toHaveBeenCalledTimes(1);

            // Its own full budget does, counted from the restore.
            vi.advanceTimersByTime(4_000);
            expect(apply).toHaveBeenNthCalledWith(2, restored, {
                type: 'engine:scene_expire',
                playerId: P1,
                tick: restored.tick,
                payload: {},
            });
            runtime.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('resolves a restored transition that is already resolvable, without waiting for an action', () => {
        // A save can be captured after the last ack landed, or after the budget
        // already expired the transition. Restored, that snapshot is one the
        // resolution path can act on immediately — and a stalled session has no
        // next action to carry it.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const restoredReady = {
                ...initial,
                tick: 7,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'ready' as const,
                    startedAtTick: 5,
                    params: {},
                    playersReady: [P1, P2],
                },
            } satisfies BaseGameSnapshot;
            const committed = {
                ...restoredReady,
                tick: 8,
                sceneId: sceneId('engine:post-game'),
                sceneTransition: null,
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi.fn().mockReturnValue(committed);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyRestoredFile(makeRestoredSaveFile(restoredReady));

            expect(apply).toHaveBeenCalledWith(restoredReady, {
                type: 'engine:scene_commit',
                playerId: P1,
                tick: restoredReady.tick,
                payload: {},
            });
            expect(runtime.getSnapshot()).toBe(committed);
            // And nothing is armed afterwards, because nothing is pending.
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves a consistent runtime when the restore’s own resolve is refused', () => {
        // The restored checkpoint can name a scene the live registry lacks, and
        // the commit it makes resolvable is then refused. A throw here would
        // escape a call its callers were written against as non-throwing, and
        // would leave the snapshot swapped with the budget below unreached —
        // so the PREVIOUS transition's timer would go on to expire the restored
        // one.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pendingBefore = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'preparing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                },
            } satisfies BaseGameSnapshot;
            const restoredReady = {
                ...pendingBefore,
                tick: 7,
                sceneTransition: {
                    toSceneId: sceneId('game:not-in-this-registry'),
                    phase: 'ready' as const,
                    startedAtTick: 5,
                    params: {},
                    playersReady: [P1, P2],
                },
            } satisfies BaseGameSnapshot;
            const refusal = new Error('ActionUnauthorizedError: unknown_scene');
            const apply: ApplyActionFn = vi
                .fn()
                .mockReturnValueOnce(pendingBefore)
                .mockImplementation(() => {
                    throw refusal;
                });
            const onExpiryError = vi.fn();
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
                onExpiryError,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });
            vi.advanceTimersByTime(4_000);

            expect(() =>
                runtime.applyRestoredFile(makeRestoredSaveFile(restoredReady)),
            ).not.toThrow();

            expect(onExpiryError).toHaveBeenCalledWith(refusal);
            expect(runtime.getSnapshot()).toBe(restoredReady);
            // The old transition's remaining 1 000 ms must not reach the
            // restored one: the budget below was re-armed despite the refusal.
            const callsBefore = vi.mocked(apply).mock.calls.length;
            vi.advanceTimersByTime(1_000);
            expect(vi.mocked(apply).mock.calls.length).toBe(callsBefore);
            runtime.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports rather than throws when the pipeline refuses the expiry it dispatches', () => {
        // The expiry runs from a timer, which has no caller to catch a
        // refusal. Here the expire dispatch itself is refused; the commit it
        // would have unblocked travels the same `try`, and is refused whenever
        // the entered scene is unknown to the live registry — which a restored
        // checkpoint can name.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pending = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'preparing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                },
            } satisfies BaseGameSnapshot;
            const refusal = new Error('ActionUnauthorizedError: unknown_scene');
            const apply: ApplyActionFn = vi
                .fn()
                .mockReturnValueOnce(pending)
                .mockImplementationOnce(() => {
                    throw refusal;
                });
            const onExpiryError = vi.fn();
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
                onExpiryError,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });

            expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
            expect(onExpiryError).toHaveBeenCalledWith(refusal);
            // The transition is untouched, so the next applied action runs the
            // same resolution rather than the runtime retrying on its own.
            expect(runtime.getSnapshot()).toBe(pending);
        } finally {
            vi.useRealTimers();
        }
    });

    it('arms ONE budget across every action applied while the transition stays pending', () => {
        // Without the outstanding-timer check, each applied action arms another
        // and orphans the previous handle — only the last is reachable by the
        // disarm, and an orphan's callback nulls the field a later transition's
        // live handle is stored in. The budget also has to measure the
        // transition rather than the last action before it.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const pending = {
                ...initial,
                tick: 1,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'preparing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                },
            } satisfies BaseGameSnapshot;
            const stillPending = { ...pending, tick: 2 } satisfies BaseGameSnapshot;
            const expired = {
                ...stillPending,
                tick: 3,
                sceneTransition: { ...stillPending.sceneTransition, expired: true },
            } satisfies BaseGameSnapshot;
            const dropped = {
                ...expired,
                tick: 4,
                sceneTransition: null,
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi
                .fn()
                .mockReturnValueOnce(pending)
                .mockReturnValueOnce(stillPending)
                .mockReturnValueOnce(expired)
                .mockReturnValueOnce(dropped);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });
            vi.advanceTimersByTime(3_000);
            runtime.applyAction({ type: 'engine:end_turn', playerId: P1, tick: 1, payload: {} });

            expect(vi.getTimerCount()).toBe(1);

            // And it is the FIRST one still running: the remaining 2 000 ms of
            // the original budget, not a fresh 5 000 the second action reset.
            vi.advanceTimersByTime(2_000);
            expect(apply).toHaveBeenNthCalledWith(3, stillPending, {
                type: 'engine:scene_expire',
                playerId: P1,
                tick: stillPending.tick,
                payload: {},
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not re-arm the budget on a transition already expired', () => {
        // The expiry is not always followed by a commit in the same call: a
        // transition in `committing` is one the resolution path leaves alone.
        // An expired transition is waiting on that commit, not on an ack, so
        // re-arming here would expire what is already expired — and invisibly,
        // since the callback returns early on the same flag.
        vi.useFakeTimers();
        try {
            const initial = makeSnapshot(0, [P1, P2]);
            const expiredMidCommit = {
                ...initial,
                tick: 3,
                hostPlayerId: P1,
                sceneId: sceneId('engine:game'),
                sceneTransition: {
                    toSceneId: sceneId('engine:post-game'),
                    phase: 'committing' as const,
                    startedAtTick: 0,
                    params: {},
                    playersReady: [P1],
                    expired: true,
                },
            } satisfies BaseGameSnapshot;
            const apply: ApplyActionFn = vi.fn().mockReturnValue(expiredMidCommit);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                sceneTransitionBudgetMs: 5_000,
            });

            runtime.applyAction({
                type: 'engine:scene_ready',
                playerId: P1,
                tick: 0,
                payload: { playerId: P1 },
            });

            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(60_000);
            expect(apply).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('exposes the gameId from constructor options via a public getter', () => {
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: makeSnapshot(0),
            applyAction: vi.fn(),
        });
        expect(runtime.gameId).toBe('tactics');
    });

    it('applyRestoredFile replaces the snapshot with the file checkpoint', () => {
        const initial = makeSnapshot(0);
        const restored = makeSnapshot(99, [P1, P2]);
        const file: SaveFile = {
            header: {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                engineVersion: HOST_ENGINE_VERSION,
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'tactics/slot-1',
                savedAt: 1,
                turnNumber: restored.turnNumber,
                playerNames: ['Alice', 'Bob'],
            },
            checkpoint: restored,
            deltaActions: [],
            pendingCommitments: {},
            stagedReveals: {},
            session: TEST_SESSION,
        };
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: vi.fn(),
        });

        runtime.applyRestoredFile(file);

        expect(runtime.getSnapshot()).toBe(restored);
    });

    it('applyRestoredFile restores pending commitments so a later reveal verifies', () => {
        const initial = makeSnapshot(0);
        const restored = makeSnapshot(99, [P1, P2]);
        const file: SaveFile = {
            header: {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                engineVersion: HOST_ENGINE_VERSION,
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'tactics/slot-1',
                savedAt: 1,
                turnNumber: restored.turnNumber,
                playerNames: ['Alice', 'Bob'],
            },
            checkpoint: restored,
            deltaActions: [],
            pendingCommitments: makePendingCommitments(),
            stagedReveals: {},
            session: TEST_SESSION,
        };
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: initial,
            applyAction: vi.fn(),
        });

        runtime.applyRestoredFile(file);

        expect(runtime.verifyReveal(makeReveal())).toEqual(COMMITTED_VALUE);
    });

    it('verifyReveal rejects a reveal when no restored commitment exists', () => {
        const runtime = new SessionRuntime({
            gameId: 'tactics',
            gameVersion: '0.1.0',
            initialSnapshot: makeSnapshot(0),
            applyAction: vi.fn(),
        });

        expect(() => runtime.verifyReveal(makeReveal())).toThrow(CommitmentVerificationError);
    });

    describe('captureSaveFile', () => {
        const initial = makeSnapshot(3, [P1, P2]);
        const NOW = 1_700_000_000_000;

        function makeRuntime(): SessionRuntime {
            return new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: vi.fn(),
                now: () => NOW,
            });
        }

        it('produces a SaveFile whose header reflects the current snapshot and request', () => {
            const file = makeRuntime().captureSaveFile({
                gameId: 'tactics',
                slotId: toSlotId('quicksave'),
            });

            expect(file.header).toEqual({
                schemaVersion: CURRENT_SCHEMA_VERSION,
                engineVersion: HOST_ENGINE_VERSION,
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'quicksave',
                savedAt: NOW,
                turnNumber: 3,
                playerNames: [P1, P2],
            });
            expect(file.checkpoint).toBe(initial);
            expect(file.deltaActions).toEqual([]);
            expect(file.pendingCommitments).toEqual({});
        });

        it("defaults the header slotId to 'autosave' when the request omits it", () => {
            const file = makeRuntime().captureSaveFile({ gameId: 'tactics' });
            expect(file.header.slotId).toBe('autosave');
        });

        it('reflects the latest snapshot after applyAction has run', () => {
            const apply: ApplyActionFn = (s) => ({
                ...s,
                tick: s.tick + 1,
                turnNumber: s.turnNumber + 1,
            });
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: initial,
                applyAction: apply,
                now: () => NOW,
            });

            runtime.applyAction(dummyEnvelope);
            const file = runtime.captureSaveFile({
                gameId: 'tactics',
                slotId: toSlotId('after-action'),
            });

            expect(file.header.turnNumber).toBe(initial.turnNumber + 1);
            expect(file.checkpoint).toBe(runtime.getSnapshot());
        });

        it('serialises the current pending commitments into the save file', () => {
            const restored = makeSnapshot(12, [P1, P2]);
            const pendingCommitments = makePendingCommitments();
            const runtime = makeRuntime();
            runtime.applyRestoredFile({
                header: {
                    schemaVersion: CURRENT_SCHEMA_VERSION,
                    engineVersion: HOST_ENGINE_VERSION,
                    gameId: 'tactics',
                    gameVersion: '0.1.0',
                    slotId: 'tactics/slot-1',
                    savedAt: 1,
                    turnNumber: restored.turnNumber,
                    playerNames: ['Alice', 'Bob'],
                },
                checkpoint: restored,
                deltaActions: [],
                pendingCommitments,
                stagedReveals: {},
                session: {
                    matchId: 'match-restored',
                    maxPlayers: 2,
                    seats: [
                        { playerId: P1, control: 'host', slotIndex: 0 },
                        { playerId: P2, control: 'remote', slotIndex: 1 },
                    ],
                },
            });

            const file = runtime.captureSaveFile({
                gameId: 'tactics',
                slotId: toSlotId('with-commitments'),
            });

            expect(file.pendingCommitments).toEqual(pendingCommitments);
        });

        describe('session manifest stamping', () => {
            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

            it('stamps session from the injected getSessionManifest provider', () => {
                const manifest = {
                    matchId: 'match-live-1',
                    maxPlayers: 4,
                    seats: [
                        { playerId: P1, control: 'host' as const, slotIndex: 0 },
                        { playerId: P2, control: 'remote' as const, slotIndex: 1 },
                        {
                            playerId: toPlayerId('ai-2'),
                            control: 'ai' as const,
                            slotIndex: 2,
                            omniscient: true,
                        },
                    ],
                };
                const runtime = new SessionRuntime({
                    gameId: 'tactics',
                    gameVersion: '0.1.0',
                    initialSnapshot: initial,
                    applyAction: vi.fn(),
                    now: () => NOW,
                    getSessionManifest: () => manifest,
                });

                const file = runtime.captureSaveFile({ gameId: 'tactics' });

                expect(file.session).toBe(manifest);
            });

            it('falls back to a checkpoint-derived manifest when the option is absent', () => {
                const file = makeRuntime().captureSaveFile({ gameId: 'tactics' });

                expect(file.session.matchId).toMatch(UUID_RE);
                expect(file.session.maxPlayers).toBe(2);
                expect(file.session.seats).toEqual([
                    { playerId: P1, control: 'remote', slotIndex: 0 },
                    { playerId: P2, control: 'remote', slotIndex: 1 },
                ]);
            });

            it('falls back to a checkpoint-derived manifest when the provider returns null', () => {
                const runtime = new SessionRuntime({
                    gameId: 'tactics',
                    gameVersion: '0.1.0',
                    initialSnapshot: initial,
                    applyAction: vi.fn(),
                    now: () => NOW,
                    getSessionManifest: () => null,
                });

                const file = runtime.captureSaveFile({ gameId: 'tactics' });

                expect(file.session.matchId).toMatch(UUID_RE);
                expect(file.session.seats).toHaveLength(2);
            });

            it('adopts the snapshot matchId in the fallback manifest when present', () => {
                const withMatchId = { ...initial, matchId: 'match-from-snapshot' };
                const runtime = new SessionRuntime({
                    gameId: 'tactics',
                    gameVersion: '0.1.0',
                    initialSnapshot: withMatchId,
                    applyAction: vi.fn(),
                    now: () => NOW,
                });

                const file = runtime.captureSaveFile({ gameId: 'tactics' });

                expect(file.session.matchId).toBe('match-from-snapshot');
            });
        });
    });

    describe('SessionCommitmentRuntime', () => {
        it('prevents prototype pollution from __proto__ keys in network data', () => {
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0),
                applyAction: vi.fn(),
            });

            // Craft a malicious payload with __proto__ key (network-sourced data).
            // Object.defineProperty adds __proto__ as an own enumerable property without
            // triggering the [[Set]] accessor that would mutate the prototype, matching
            // how JSON.parse handles __proto__ keys from untrusted input.
            const maliciousCommitments: SaveFile['pendingCommitments'] = {
                [COMMITMENT_ID]: makeEnvelope(),
            };
            Object.defineProperty(maliciousCommitments, '__proto__', {
                value: { injected: true },
                enumerable: true,
                configurable: true,
                writable: true,
            });

            // Restore the malicious commitments
            runtime.applyRestoredFile({
                header: {
                    schemaVersion: CURRENT_SCHEMA_VERSION,
                    engineVersion: HOST_ENGINE_VERSION,
                    gameId: 'tactics',
                    gameVersion: '0.1.0',
                    slotId: 'tactics/slot-1',
                    savedAt: 1,
                    turnNumber: 0,
                    playerNames: [],
                },
                checkpoint: makeSnapshot(0),
                deltaActions: [],
                pendingCommitments: maliciousCommitments,
                stagedReveals: {},
                session: TEST_SESSION,
            });

            // Verify that Object.prototype was not polluted
            // (the __proto__ key is stored as a regular property due to Object.create(null))
            const newObject: Record<string, unknown> = {};
            expect(newObject['injected']).toBeUndefined();

            // Verify that the valid commitment is still accessible
            const captured = runtime.captureSaveFile({
                gameId: 'tactics',
            });
            expect(captured.pendingCommitments[COMMITMENT_ID]).toEqual(makeEnvelope());
            // The __proto__ string is stored as a property but harmless (no prototype pollution)
        });

        it('allows injecting a test double commitmentRuntime via options', () => {
            const injectedCommitmentRuntime = {
                restorePendingCommitments: vi.fn(),
                capturePendingCommitments: vi.fn().mockReturnValue(makePendingCommitments()),
                verifyReveal: vi.fn().mockReturnValue(COMMITTED_VALUE),
                commit: vi.fn(),
                commitRevealable: vi.fn(),
            };

            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0),
                applyAction: vi.fn(),
                commitmentRuntime: injectedCommitmentRuntime,
            });

            // Verify the injected runtime is used
            runtime.captureSaveFile({
                gameId: 'tactics',
            });

            expect(injectedCommitmentRuntime.capturePendingCommitments).toHaveBeenCalled();
        });
    });

    describe('commit()', () => {
        it('returns a CommitmentEnvelope with an id and commitment hash', () => {
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0),
                applyAction: vi.fn(),
            });

            const envelope = runtime.commit({ card: 'ace-of-stars' });

            expect(typeof envelope.id).toBe('string');
            expect(envelope.id.length).toBeGreaterThan(0);
            expect(typeof envelope.commitment).toBe('string');
            expect(envelope.commitment.length).toBe(64); // SHA-256 hex = 64 chars
        });

        it('the committed envelope is included in captureSaveFile pendingCommitments', () => {
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0),
                applyAction: vi.fn(),
                now: () => 1_000,
            });

            const envelope = runtime.commit({ card: 'ace-of-stars' });
            const file = runtime.captureSaveFile({ gameId: 'tactics' });

            expect(file.pendingCommitments[envelope.id]).toEqual(envelope);
        });

        it('verifyReveal succeeds after commit() with a matching reveal', () => {
            // Use a custom CommitmentScheme with known nonce so we can construct the reveal
            const NONCE = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
            const VALUE = { dice: 6 };
            const commitmentScheme = {
                commit(_v: unknown) {
                    return {
                        id: toCommitmentId('known-id'),
                        commitment: 'expected-hash',
                    };
                },
                commitRevealable(value: unknown) {
                    return {
                        envelope: { id: toCommitmentId('known-id'), commitment: 'expected-hash' },
                        reveal: { id: toCommitmentId('known-id'), value, nonce: NONCE },
                    };
                },
                verify(_reveal: CommitmentReveal, _envelope: CommitmentEnvelope) {
                    return true;
                },
            };

            const commitmentRuntime = new SessionCommitmentRuntime(commitmentScheme);
            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0),
                applyAction: vi.fn(),
                commitmentRuntime,
            });

            const envelope = runtime.commit(VALUE);
            const reveal: CommitmentReveal = { id: envelope.id, value: VALUE, nonce: NONCE };

            expect(() => runtime.verifyReveal(reveal)).not.toThrow();
        });

        it('delegates commit() to the injected commitmentRuntime', () => {
            const expectedEnvelope: CommitmentEnvelope = {
                id: toCommitmentId('injected-id'),
                commitment: 'injected-hash',
            };
            const injectedRuntime = {
                restorePendingCommitments: vi.fn(),
                capturePendingCommitments: vi.fn().mockReturnValue({}),
                verifyReveal: vi.fn(),
                commit: vi.fn().mockReturnValue(expectedEnvelope),
                commitRevealable: vi.fn(),
            };

            const runtime = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0),
                applyAction: vi.fn(),
                commitmentRuntime: injectedRuntime,
            });

            const result = runtime.commit({ value: 42 });

            expect(injectedRuntime.commit).toHaveBeenCalledWith({ value: 42 });
            expect(result).toBe(expectedEnvelope);
        });

        it('SessionCommitmentRuntime.commit() stores the envelope in pendingCommitments', () => {
            const VALUE = { foo: 'bar' };
            const commitmentRuntime = new SessionCommitmentRuntime();

            const envelope = commitmentRuntime.commit(VALUE);
            const captured = commitmentRuntime.capturePendingCommitments();

            expect(captured[envelope.id]).toEqual(envelope);
        });

        it('SessionCommitmentRuntime.commitRevealable() stores the envelope and returns a verifiable reveal', () => {
            const VALUE = { dice: 4 };
            const commitmentRuntime = new SessionCommitmentRuntime();

            const { envelope, reveal } = commitmentRuntime.commitRevealable(VALUE);

            expect(commitmentRuntime.capturePendingCommitments()[envelope.id]).toEqual(envelope);
            // The retained reveal verifies and clears the pending envelope.
            expect(commitmentRuntime.verifyReveal(reveal)).toEqual(VALUE);
        });
    });

    describe('commitTurn() — tactics commitment mode (T8)', () => {
        function tacticsValue(
            player: PlayerId,
            kind: 'attack' | 'move',
        ): TacticsCommitmentEnvelopeValue {
            const actions =
                kind === 'attack'
                    ? [
                          {
                              type: TACTICS_ATTACK_ACTION as typeof TACTICS_ATTACK_ACTION,
                              payload: { attackerId: entityId('u1'), defenderId: entityId('u2') },
                          } as const,
                      ]
                    : [
                          {
                              type: TACTICS_MOVE_UNIT_ACTION as typeof TACTICS_MOVE_UNIT_ACTION,
                              payload: {
                                  unitId: entityId('u1'),
                                  x: tacticsGridCoordinate(1),
                                  y: tacticsGridCoordinate(0),
                              },
                          } as const,
                      ];
            return { playerId: player, turnNumber: 1, actions };
        }

        function makeRuntime(): SessionRuntime {
            return new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0, [P1, P2]),
                applyAction: vi.fn(),
                now: () => 1_000,
            });
        }

        it('produces an envelope that lands in the pending-commitments broadcast', () => {
            const runtime = makeRuntime();

            const envelope = runtime.commitTurn(P1, tacticsValue(P1, 'attack'));

            expect(
                runtime.captureSaveFile({ gameId: 'tactics' }).pendingCommitments[envelope.id],
            ).toEqual(envelope);
        });

        it('marks the committing player as committed', () => {
            const runtime = makeRuntime();

            runtime.commitTurn(P1, tacticsValue(P1, 'attack'));

            expect(runtime.hasCommitted(P1)).toBe(true);
            expect(runtime.hasCommitted(P2)).toBe(false);
            expect(runtime.committedPlayerIds()).toEqual([P1]);
        });

        it('tracks multiple committers independently', () => {
            const runtime = makeRuntime();

            runtime.commitTurn(P1, tacticsValue(P1, 'move'));
            runtime.commitTurn(P2, tacticsValue(P2, 'attack'));

            expect(runtime.committedPlayerIds()).toEqual([P1, P2]);
        });

        it('persists staged reveals into the save file alongside the envelope (Invariant #26)', () => {
            const runtime = makeRuntime();

            const envelope = runtime.commitTurn(P1, tacticsValue(P1, 'attack'));
            const file = runtime.captureSaveFile({ gameId: 'tactics' });

            expect(file.pendingCommitments[envelope.id]).toEqual(envelope);
            expect(file.stagedReveals[envelope.id]).toMatchObject({
                envelopeId: envelope.id,
                playerId: P1,
            });
        });

        it('restores staged reveals so a mid-commit save can still reveal (Invariant #26)', () => {
            const source = makeRuntime();
            const envelope = source.commitTurn(P1, tacticsValue(P1, 'attack'));
            const file = source.captureSaveFile({ gameId: 'tactics' });

            // Fresh runtime with its own staging; restore the saved file into it.
            const restoredStaging = new RevealStaging();
            const restored = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0, [P1, P2]),
                applyAction: vi.fn(),
                revealStaging: restoredStaging,
            });

            restored.applyRestoredFile(file);

            expect(restored.hasCommitted(P1)).toBe(true);
            // The restored staging rebuilds a reveal that the restored envelope verifies.
            const reveal = restoredStaging.buildReveal(P1);
            expect(reveal.id).toBe(envelope.id);
            expect(restored.verifyReveal(reveal)).toEqual(tacticsValue(P1, 'attack'));
        });

        it('does not reveal when envelopes are restored without their staging (Invariant #26)', () => {
            const source = makeRuntime();
            source.commitTurn(P1, tacticsValue(P1, 'attack'));
            const file = source.captureSaveFile({ gameId: 'tactics' });

            const restored = new SessionRuntime({
                gameId: 'tactics',
                gameVersion: '0.1.0',
                initialSnapshot: makeSnapshot(0, [P1, P2]),
                applyAction: vi.fn(),
            });

            // Envelopes present, staging stripped — the two must move as a unit.
            restored.applyRestoredFile({ ...file, stagedReveals: {} });

            expect(restored.hasCommitted(P1)).toBe(false);
            expect(restored.committedPlayerIds()).toEqual([]);
        });

        describe('reveal-sync accessors (T9)', () => {
            it('captureStagedReveals() exposes each staged value keyed by envelope id', () => {
                const runtime = makeRuntime();
                const envelope = runtime.commitTurn(P1, tacticsValue(P1, 'attack'));

                const staged = runtime.captureStagedReveals();

                expect(staged[envelope.id]).toMatchObject({
                    envelopeId: envelope.id,
                    playerId: P1,
                    value: tacticsValue(P1, 'attack'),
                });
            });

            it('buildReveal() returns the reveal the matching envelope verifies', () => {
                const runtime = makeRuntime();
                const envelope = runtime.commitTurn(P1, tacticsValue(P1, 'move'));

                const reveal = runtime.buildReveal(P1);

                expect(reveal.id).toBe(envelope.id);
                expect(runtime.verifyReveal(reveal)).toEqual(tacticsValue(P1, 'move'));
            });

            it('clearStagedReveals() discards the turn so nothing remains to reveal', () => {
                const runtime = makeRuntime();
                runtime.commitTurn(P1, tacticsValue(P1, 'attack'));
                runtime.commitTurn(P2, tacticsValue(P2, 'move'));

                runtime.clearStagedReveals();

                expect(runtime.committedPlayerIds()).toEqual([]);
                expect(runtime.captureStagedReveals()).toEqual({});
            });
        });
    });
});
