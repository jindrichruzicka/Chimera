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
} from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId, sceneId } from '@chimera/simulation/engine/types.js';
import { CURRENT_SCHEMA_VERSION } from '@chimera/simulation/persistence/SaveMigrator.js';
import type { SaveFile } from '@chimera/simulation/persistence/SaveFile.js';
import {
    CommitmentVerificationError,
    toCommitmentId,
    type CommitmentEnvelope,
    type CommitmentReveal,
} from '@chimera/simulation/projection/index.js';

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
            });

            const file = runtime.captureSaveFile({
                gameId: 'tactics',
                slotId: toSlotId('with-commitments'),
            });

            expect(file.pendingCommitments).toEqual(pendingCommitments);
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
    });
});
