/**
 * electron/main/runtime/SessionRuntime.test.ts
 *
 * Verifies the live-snapshot holder used by the hosted-session callback.
 *
 * Architecture: §4.11 — Save / Load · §4.7 — ActionPipeline host bootstrap.
 */

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

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

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
    });
});
