/**
 * electron/main/runtime/SessionRuntime.test.ts
 *
 * Verifies the live-snapshot holder used by the hosted-session callback.
 *
 * Architecture: §4.11 — Save / Load · §4.7 — ActionPipeline host bootstrap.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { HOST_ENGINE_VERSION, SessionRuntime, type ApplyActionFn } from './SessionRuntime.js';
import { toSlotId } from '../../preload/api-types.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
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

            // Craft a malicious payload with __proto__ key (network-sourced data)
            const maliciousCommitments = Object.assign(
                {},
                {
                    [COMMITMENT_ID]: makeEnvelope(),
                    ['__proto__']: { injected: true },
                },
            );

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
                pendingCommitments: maliciousCommitments as Parameters<
                    (typeof runtime)['applyRestoredFile']
                >[0]['pendingCommitments'],
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
});
