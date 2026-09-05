/**
 * electron/main/runtime/HostSessionPipeline.test.ts
 *
 * Unit tests for the per-session match-history wiring of
 * `buildHostSessionPipeline`: the injected `UndoPolicy` and the injected
 * action-history retention bound, plus `undoPolicyForMatchHistory`, the pure
 * mapping from a resolved `GameMatchHistorySupport` to an `UndoPolicy`.
 *
 * Architecture: §4.5, §7 — undo-redo-policy.
 *
 * Tests written FIRST (red).
 *
 * Invariants upheld:
 *   #7  — engine:undo enters via the Stage 3 intercept; a game that declares no
 *          undo is refused BY THE POLICY, never by removing the manager.
 *   #45 — the retention bound is per-game; the turn-based default is unchanged.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { UndoNotAllowedError } from '@chimera-engine/simulation/engine/UndoManager.js';
import { DEFAULT_UNDO_POLICY } from '@chimera-engine/simulation/engine/UndoPolicy.js';
import {
    DEFAULT_REALTIME_RETAIN_ACTIONS,
    MAX_ACTION_HISTORY_ENTRIES,
} from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import type {
    ActionDefinition,
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import { buildHostSessionPipeline, undoPolicyForMatchHistory } from './HostSessionPipeline.js';
import type { Logger } from '../logging/logger.js';

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

function makeSnapshot(tick = 0): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
        turnClock: { activePlayerId: P1, deadlineMs: 30_000 },
    };
}

const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
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

const advanceEnvelope = (tick: number, player: PlayerId = P1): ActionEnvelope => ({
    type: 'game:advance',
    playerId: player,
    tick,
    payload: {},
});

const undoEnvelope = (tick: number, player: PlayerId = P1): ActionEnvelope => ({
    type: 'engine:undo',
    playerId: player,
    tick,
    payload: {},
});

/** Captures every warn so the action-history overflow report is readable. */
function makeLevelRecorder(): {
    readonly logger: Logger;
    readonly warns: { message: string; context?: Record<string, unknown> }[];
    readonly infos: { message: string; context?: Record<string, unknown> }[];
} {
    const warns: { message: string; context?: Record<string, unknown> }[] = [];
    const infos: { message: string; context?: Record<string, unknown> }[] = [];
    const logger = {
        debug: vi.fn(),
        info: vi.fn((message: string, context?: Record<string, unknown>) => {
            infos.push(context === undefined ? { message } : { message, context });
        }),
        warn: vi.fn((message: string, context?: Record<string, unknown>) => {
            warns.push(context === undefined ? { message } : { message, context });
        }),
        error: vi.fn(),
        child: vi.fn(() => logger),
    } as unknown as Logger;
    return { logger, warns, infos };
}

const noopSavePort = { autoSave: async (): Promise<void> => {} };

// ── undoPolicyForMatchHistory ────────────────────────────────────────────────

describe('undoPolicyForMatchHistory', () => {
    it('returns the engine default policy, unchanged, for a game that keeps undo', () => {
        expect(
            undoPolicyForMatchHistory({ undo: true, replay: true, retainActions: 10 }),
        ).toStrictEqual(DEFAULT_UNDO_POLICY);
    });

    it('refuses undo, leaving every other default field untouched, when a game declares none', () => {
        expect(
            undoPolicyForMatchHistory({ undo: false, replay: true, retainActions: 10 }),
        ).toStrictEqual({
            allowUndo: false,
            maxUndoSteps: DEFAULT_UNDO_POLICY.maxUndoSteps,
            crossTurnUndo: DEFAULT_UNDO_POLICY.crossTurnUndo,
        });
    });

    it('reads only `undo` — `replay` and `retainActions` do not reach the policy', () => {
        expect(
            undoPolicyForMatchHistory({ undo: true, replay: false, retainActions: 1 }),
        ).toStrictEqual(
            undoPolicyForMatchHistory({
                undo: true,
                replay: true,
                retainActions: MAX_ACTION_HISTORY_ENTRIES,
            }),
        );
    });
});

// ── The injected undo policy ─────────────────────────────────────────────────

describe('buildHostSessionPipeline — injected undo policy', () => {
    it('refuses undo for a session built with a no-undo policy, even with a memento and history', () => {
        const { pipeline, undoManager } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            undoPolicy: undoPolicyForMatchHistory({
                undo: false,
                replay: true,
                retainActions: MAX_ACTION_HISTORY_ENTRIES,
            }),
        });

        const s0 = makeSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        pipeline.process(s0, advanceEnvelope(0));

        expect(undoManager.canUndo(P1)).toBe(false);
        expect(() => undoManager.undo(P1)).toThrow(UndoNotAllowedError);
    });

    it('refuses an engine:undo dispatched into a no-undo session THROUGH THE POLICY', () => {
        const { pipeline, undoManager } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            undoPolicy: undoPolicyForMatchHistory({
                undo: false,
                replay: true,
                retainActions: MAX_ACTION_HISTORY_ENTRIES,
            }),
        });

        const s0 = makeSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = pipeline.process(s0, advanceEnvelope(0));

        // The refusal must come from the policy, with the policy's own reason —
        // dropping `undoManager` from the context instead would make the pipeline
        // ACCEPT engine:undo as an ordinary engine action and append it to
        // history, which looks like an opt-out and is not one.
        let caught: unknown;
        try {
            pipeline.process(s1, undoEnvelope(s1.tick));
        } catch (err: unknown) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(UndoNotAllowedError);
        expect((caught as UndoNotAllowedError).reason).toBe('policy_disallows');
    });

    it('keeps undo working for a session built with no policy override', () => {
        const { pipeline, undoManager } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
        });

        const s0 = makeSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = pipeline.process(s0, advanceEnvelope(0));

        expect(undoManager.canUndo(P1)).toBe(true);
        expect(pipeline.process(s1, undoEnvelope(s1.tick)).tick).toBe(s0.tick);
    });

    it('keeps undo working for a session built with the undo-allowing policy', () => {
        const { pipeline, undoManager } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            undoPolicy: undoPolicyForMatchHistory({
                undo: true,
                replay: true,
                retainActions: MAX_ACTION_HISTORY_ENTRIES,
            }),
        });

        const s0 = makeSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        const s1 = pipeline.process(s0, advanceEnvelope(0));

        expect(undoManager.canUndo(P1)).toBe(true);
        expect(pipeline.process(s1, undoEnvelope(s1.tick)).tick).toBe(s0.tick);
    });
});

// ── The injected retention bound ─────────────────────────────────────────────

describe('buildHostSessionPipeline — injected action-history bound', () => {
    it('constructs the history with the supplied retainActions bound', () => {
        const { logger, warns } = makeLevelRecorder();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            logger,
            retainActions: 3,
        });

        // Every top-level action appends one history entry (Stage 6); one more
        // than the bound forces exactly one overflow eviction, which reports the
        // capacity it evicted against.
        let s = makeSnapshot(0);
        for (let i = 0; i < 4; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        expect(warns.filter((w) => w.message === 'action-history:overflow')).toStrictEqual([
            { message: 'action-history:overflow', context: { capacity: 3 } },
        ]);
    });

    it('does not overflow below the supplied bound', () => {
        const { logger, warns } = makeLevelRecorder();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            logger,
            retainActions: 3,
        });

        let s = makeSnapshot(0);
        for (let i = 0; i < 3; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        expect(warns.filter((w) => w.message === 'action-history:overflow')).toStrictEqual([]);
    });

    // The bound alone, with no policy beside it — the demoted arm is below.
    it('reports the realtime default bound when a caller supplies it alone', () => {
        const { logger, warns } = makeLevelRecorder();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            logger,
            retainActions: DEFAULT_REALTIME_RETAIN_ACTIONS,
        });

        let s = makeSnapshot(0);
        for (let i = 0; i < DEFAULT_REALTIME_RETAIN_ACTIONS + 1; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        expect(warns.filter((w) => w.message === 'action-history:overflow')).toStrictEqual([
            {
                message: 'action-history:overflow',
                context: { capacity: DEFAULT_REALTIME_RETAIN_ACTIONS },
            },
        ]);
    });

    /**
     * What the report claims follows the resolved policy, not the bound
     * (Invariant #45). `ActionPipeline` appends every depth-0 dispatch,
     * `engine:tick` included, and a game dispatching no `engine:end_turn` never
     * reaches `pruneTo` — so such a history saturates once and never recovers,
     * and a `warn` there names steady-state behaviour as a fault.
     */
    it('demotes the overflow report to info when the resolved policy refuses undo', () => {
        const { logger, warns, infos } = makeLevelRecorder();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            logger,
            retainActions: 3,
            undoPolicy: undoPolicyForMatchHistory({ undo: false, replay: true, retainActions: 3 }),
        });

        let s = makeSnapshot(0);
        for (let i = 0; i < 4; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        expect(warns.filter((w) => w.message === 'action-history:overflow')).toStrictEqual([]);
        // Kept, not dropped: same message and same context, at the level
        // `resolveFileLogLevel` defaults the durable file sink to (§4.27).
        expect(infos.filter((d) => d.message === 'action-history:overflow')).toStrictEqual([
            { message: 'action-history:overflow', context: { capacity: 3 } },
        ]);
    });

    it('keeps the warn when the resolved policy allows undo, which is what the bound protects', () => {
        const { logger, warns, infos } = makeLevelRecorder();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            logger,
            retainActions: 3,
            undoPolicy: undoPolicyForMatchHistory({ undo: true, replay: true, retainActions: 3 }),
        });

        let s = makeSnapshot(0);
        for (let i = 0; i < 4; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        expect(infos.filter((d) => d.message === 'action-history:overflow')).toStrictEqual([]);
        expect(warns.filter((w) => w.message === 'action-history:overflow')).toStrictEqual([
            { message: 'action-history:overflow', context: { capacity: 3 } },
        ]);
    });

    it('falls back to the engine ceiling when no bound is supplied', () => {
        const { logger, warns } = makeLevelRecorder();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            logger,
        });

        let s = makeSnapshot(0);
        for (let i = 0; i < MAX_ACTION_HISTORY_ENTRIES + 1; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        expect(warns.filter((w) => w.message === 'action-history:overflow')).toStrictEqual([
            {
                message: 'action-history:overflow',
                context: { capacity: MAX_ACTION_HISTORY_ENTRIES },
            },
        ]);
    });

    it('still constructs a bounded history when a bound is supplied without a logger', () => {
        // The logger and the bound reach `InMemoryActionHistory` through one
        // options object; a bound dropped when the logger is absent would evict
        // against the ceiling instead.
        const { pipeline, undoManager } = buildHostSessionPipeline(makeRegistry(), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            retainActions: 2,
        });

        const s0 = makeSnapshot(0);
        undoManager.saveTurnMemento(s0, P1);
        let s = s0;
        for (let i = 0; i < 3; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        // Eviction has cut into the segment since the memento, so undo refuses
        // rather than replaying onto a stale baseline.
        expect(undoManager.canUndo(P1)).toBe(false);
    });
});
