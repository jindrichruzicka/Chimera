/**
 * electron/main/__tests__/autosave-wiring.integration.test.ts
 *
 * Integration tests for autosave wiring in `buildHostSessionPipeline`.
 *
 * Verifies that `buildHostSessionPipeline` fires `AutoSavePort.autoSave(gameId)`
 * as a fire-and-forget call after a successful `engine:end_turn` — and that
 * it does NOT fire for `engine:undo`, `engine:redo`, or any other action type.
 *
 * Architecture: §4.11, §4.7 — SaveManager autosave, ActionPipeline host bootstrap.
 * Issue: #375
 *
 * Tests written FIRST (red); implementation in
 * `electron/main/runtime/HostSessionPipeline.ts`.
 *
 * Invariants verified:
 *   #25 — autosave is an out-of-band host call, not a re-entrant engine:save action
 *   #43 — autosave is wired at the host orchestration layer; no I/O inside reduce()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutoSavePort } from '../runtime/HostSessionPipeline.js';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';
import { ActionUnauthorizedError } from '@chimera/simulation/engine/ActionPipeline.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import type {
    ActionDefinition,
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';

// ── Player IDs ─────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

// ── Snapshot helpers ───────────────────────────────────────────────────────────

function makeBaseSnapshot(tick = 0, playerIds: readonly PlayerId[] = [P1]): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: Object.fromEntries(playerIds.map((id) => [id, { id }])),
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

/**
 * Snapshot with `turnClock` so `engine:end_turn` actually advances state
 * (returns a new reference) rather than short-circuiting with `return state`.
 */
function makeSnapshotWithTurnClock(
    tick: number,
    activePlayerId: PlayerId,
    ...otherPlayerIds: PlayerId[]
): BaseGameSnapshot {
    const allPlayers = [activePlayerId, ...otherPlayerIds];
    return {
        tick,
        seed: 42,
        players: Object.fromEntries(allPlayers.map((id) => [id, { id }])),
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
        turnClock: { activePlayerId, deadlineMs: 60_000 },
    };
}

// ── Action envelope factories ──────────────────────────────────────────────────

const endTurnEnvelope = (tick: number, playerId: PlayerId): ActionEnvelope => ({
    type: 'engine:end_turn',
    playerId,
    tick,
    payload: {},
});

const advanceEnvelope = (tick: number): ActionEnvelope => ({
    type: 'game:advance',
    playerId: P1,
    tick,
    payload: {},
});

const undoEnvelope = (tick: number): ActionEnvelope => ({
    type: 'engine:undo',
    playerId: P1,
    tick,
    payload: {},
});

const redoEnvelope = (tick: number): ActionEnvelope => ({
    type: 'engine:redo',
    playerId: P1,
    tick,
    payload: {},
});

const winCheckEnvelope = (tick: number): ActionEnvelope => ({
    type: 'game:win-check',
    playerId: P1,
    tick,
    payload: {},
});

// ── Simple action that produces a new snapshot reference (for undo setup) ─────

const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

const winCheckDef: ActionDefinition<Record<string, never>> = {
    type: 'game:win-check',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

function makeRegistry(): ActionRegistry {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registry.register(advanceDef);
    return registry;
}

function makeResolvingRegistry(): ActionRegistry {
    const registry = makeRegistry();
    registry.register(winCheckDef);
    registry.registerGame('tactics', {
        resolveGameResult: (snapshot) => (snapshot.tick >= 1 ? { winnerIds: [P1] } : null),
    });
    return registry;
}

// ── AC1: autoSave called after engine:end_turn ─────────────────────────────────

describe('buildHostSessionPipeline — AC1: autoSave triggered by engine:end_turn', () => {
    let autoSaveFn: ReturnType<typeof vi.fn>;
    let savePort: AutoSavePort;

    beforeEach(() => {
        autoSaveFn = vi.fn().mockResolvedValue(undefined);
        savePort = { autoSave: autoSaveFn };
    });

    it('calls savePort.autoSave with gameId after a successful engine:end_turn', () => {
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        const s0 = makeSnapshotWithTurnClock(0, P1, P2);
        const next = processAction(s0, endTurnEnvelope(0, P1));

        expect(autoSaveFn).toHaveBeenCalledOnce();
        expect(autoSaveFn).toHaveBeenCalledWith('tactics', next);
    });

    it('passes the post-reduce snapshot to autoSave so persistence captures the ended turn', () => {
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        const s0 = makeSnapshotWithTurnClock(6, P1, P2);
        const next = processAction(s0, endTurnEnvelope(6, P1));

        expect(next.tick).toBe(7);
        expect(next.turnNumber).toBe(1);
        expect(autoSaveFn.mock.calls[0]?.[1]).toBe(next);
    });

    it('calls savePort.autoSave even when engine:end_turn does not change state (no turnClock)', () => {
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        // Snapshot without turnClock: engine:end_turn reduce() returns `state` unchanged.
        const s0 = makeBaseSnapshot(0, [P1, P2]);
        const next = processAction(s0, endTurnEnvelope(0, P1));

        expect(autoSaveFn).toHaveBeenCalledOnce();
        expect(autoSaveFn).toHaveBeenCalledWith('tactics', next);
    });

    it('does not call autoSave when no savePort is provided', () => {
        const { processAction } = buildHostSessionPipeline(
            makeRegistry(),
            vi.fn(),
            // No savePort
        );

        const s0 = makeSnapshotWithTurnClock(0, P1, P2);
        expect(() => processAction(s0, endTurnEnvelope(0, P1))).not.toThrow();
        // No spy to assert — just confirm no error
    });

    it('calls savePort.autoSave exactly once even when broadcast fires for multiple players', () => {
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        // Three-player game — Stage 7 broadcasts three times but autosave fires once.
        const P3 = toPlayerId('player-3');
        const s0 = makeSnapshotWithTurnClock(0, P1, P2, P3);
        processAction(s0, endTurnEnvelope(0, P1));

        expect(autoSaveFn).toHaveBeenCalledOnce();
    });
});

// ── AC2: autoSave NOT called for engine:undo ───────────────────────────────────

describe('buildHostSessionPipeline — AC2: autoSave suppressed for engine:undo / engine:redo', () => {
    let autoSaveFn: ReturnType<typeof vi.fn>;
    let savePort: AutoSavePort;

    beforeEach(() => {
        autoSaveFn = vi.fn().mockResolvedValue(undefined);
        savePort = { autoSave: autoSaveFn };
    });

    it('does NOT call autoSave after engine:undo', () => {
        const { processAction, undoManager } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        const s0 = makeBaseSnapshot(0, [P1]);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = processAction(s0, advanceEnvelope(0));

        autoSaveFn.mockClear(); // reset any calls from advance action

        processAction(s1, undoEnvelope(s1.tick));

        expect(autoSaveFn).not.toHaveBeenCalled();
    });

    it('does NOT call autoSave after engine:redo', () => {
        const { processAction, undoManager } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        const s0 = makeBaseSnapshot(0, [P1]);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = processAction(s0, advanceEnvelope(0));
        const afterUndo = processAction(s1, undoEnvelope(s1.tick));

        autoSaveFn.mockClear(); // reset all prior calls

        processAction(afterUndo, redoEnvelope(afterUndo.tick));

        expect(autoSaveFn).not.toHaveBeenCalled();
    });

    it('does NOT call autoSave after a non-end_turn game action', () => {
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        const s0 = makeBaseSnapshot(0, [P1]);
        processAction(s0, advanceEnvelope(0));

        expect(autoSaveFn).not.toHaveBeenCalled();
    });
});

// ── AC3: errors caught and logged ──────────────────────────────────────────────

describe('buildHostSessionPipeline — AC3: autosave errors are caught and do not crash', () => {
    it('does not propagate a rejection from savePort.autoSave', () => {
        const failingAutoSave = vi.fn().mockRejectedValue(new Error('disk full'));
        const savePort: AutoSavePort = { autoSave: failingAutoSave };

        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        const s0 = makeSnapshotWithTurnClock(0, P1, P2);

        // processAction must return normally; the rejection must not propagate.
        expect(() => processAction(s0, endTurnEnvelope(0, P1))).not.toThrow();
    });

    it('still returns the next state correctly even when autoSave throws', () => {
        const failingAutoSave = vi.fn().mockRejectedValue(new Error('disk full'));
        const savePort: AutoSavePort = { autoSave: failingAutoSave };

        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort,
        });

        const s0 = makeSnapshotWithTurnClock(0, P1, P2);
        const result = processAction(s0, endTurnEnvelope(0, P1));

        // The turn advanced, so turnNumber incremented.
        expect(result.turnNumber).toBe(1);
    });
});

// ── AC4: match result triggers SimulationHost.onGameEnd wiring ───────────────

describe('buildHostSessionPipeline — AC4: match result game-end notification', () => {
    it('calls the game-end port once when gameResult first becomes non-null', () => {
        const onGameEnd = vi.fn();
        const { processAction } = buildHostSessionPipeline(makeResolvingRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort: { autoSave: vi.fn().mockResolvedValue(undefined) },
            gameEndPort: { onGameEnd },
        });

        const s0 = makeBaseSnapshot(0, [P1, P2]);
        const next = processAction(s0, winCheckEnvelope(0));

        expect(next.gameResult).toEqual({ winnerIds: [P1] });
        expect(onGameEnd).toHaveBeenCalledOnce();
        expect(onGameEnd).toHaveBeenCalledWith(next, { winnerIds: [P1] });
    });

    it('rejects follow-up game actions and does not call the game-end port again for an already resolved snapshot', () => {
        const onGameEnd = vi.fn();
        const { processAction } = buildHostSessionPipeline(makeResolvingRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort: { autoSave: vi.fn().mockResolvedValue(undefined) },
            gameEndPort: { onGameEnd },
        });

        const resolved = {
            ...makeBaseSnapshot(1, [P1, P2]),
            gameResult: { winnerIds: [P1] },
        };

        expect(() => processAction(resolved, winCheckEnvelope(1))).toThrow(ActionUnauthorizedError);

        expect(onGameEnd).not.toHaveBeenCalled();
    });
});

// ── Backward compat: existing tests still work with processAction ──────────────

describe('buildHostSessionPipeline — processAction backward compatibility', () => {
    it('processAction returns the same result as pipeline.process for non-end_turn actions', () => {
        const { pipeline, processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn());

        const s0 = makeBaseSnapshot(0, [P1]);
        const viaProcess = pipeline.process(s0, advanceEnvelope(0));
        const viaWrapper = processAction(makeBaseSnapshot(0, [P1]), advanceEnvelope(0));

        // Both advance tick by 1
        expect(viaProcess.tick).toBe(1);
        expect(viaWrapper.tick).toBe(1);
    });
});
