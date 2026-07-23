/**
 * electron/main/__tests__/logger-wiring.integration.test.ts
 *
 * Integration tests for the mandated structured-logger wiring in the
 * electron/main host-session composition (`buildHostSessionPipeline`).
 *
 * Two invariant-mandated warnings are only reachable in production when the
 * injected `Logger` is forwarded from the factory into the objects that emit
 * them. Both were dropped: the factory built `InMemoryActionHistory` and
 * `ActionPipeline` with no logger, so the warns went to a noop.
 *
 * Architecture: §4.20 — Structured Logging
 *
 * Tests written FIRST (red); implementation in
 * `electron/main/runtime/HostSessionPipeline.ts`.
 *
 * Invariants verified:
 *   #45 — `action-history:overflow` warn on safety-net eviction is reachable
 *          from a built host pipeline.
 *   #90 — `ReduceContext.logger` is populated from the pipeline's injected
 *          `Logger`, so `engine:tick` surfaces the warn for a timer-fired
 *          action rejected by `validate()`.
 *   #67 — logging flows through the injected `Logger`; the test asserts on a
 *          `createMemorySink()`-backed logger, never `console.*`.
 */

import { describe, it, expect } from 'vitest';

import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';
import { createLogger, createMemorySink } from '../logging/logger.js';

import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { MAX_ACTION_HISTORY_ENTRIES } from '@chimera-engine/simulation/engine/UndoManager.js';
import type {
    ActionDefinition,
    ActionEnvelope,
    BaseGameSnapshot,
} from '@chimera-engine/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { GameTimer, TimerId } from '@chimera-engine/simulation/engine/GameTimer.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');

function makeMemoryLogger() {
    const sink = createMemorySink();
    const logger = createLogger({ source: { process: 'main', module: 'test' }, sink });
    return { logger, sink };
}

function makeBaseSnapshot(tick = 0): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: { [P1]: { id: P1 } },
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

/** Increments tick — a new reference so Stage 7 broadcast fires and Stage 6 appends. */
const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

const advanceEnvelope = (tick: number): ActionEnvelope => ({
    type: 'game:advance',
    playerId: P1,
    tick,
    payload: {},
});

/** Always rejected by validate() — used as a timer-fired action target for #90. */
const rejectDef: ActionDefinition<Record<string, never>> = {
    type: 'game:reject',
    parsePayload: () => ({}),
    validate: () => ({ ok: false, reason: 'always_rejected' }),
    reduce: (state) => state,
};

const firingTimer = (id: string, actionType: string): GameTimer => ({
    id: id as TimerId,
    remainingTicks: 1,
    intervalTicks: 0,
    actionType,
    payload: {},
    active: true,
});

const tickEnvelope = (tick: number): ActionEnvelope => ({
    type: 'engine:tick',
    playerId: P1,
    tick,
    payload: { seed: 1 },
});

function makeRegistry(...defs: ActionDefinition<Record<string, never>>[]): ActionRegistry {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    for (const def of defs) {
        registry.register(def);
    }
    return registry;
}

// `gameId`/`savePort` are required on HostSessionPipelineOptions; autosave only fires
// after engine:end_turn, which neither test dispatches, so a no-op port is inert here.
const noopSavePort = { autoSave: async (): Promise<void> => {} };

// ── #45 — action-history overflow warn is reachable ────────────────────────────

describe('buildHostSessionPipeline — #45: action-history:overflow warn is wired', () => {
    it('emits action-history:overflow on the injected logger when the safety-net cap is exceeded', () => {
        const { logger, sink } = makeMemoryLogger();
        const { pipeline } = buildHostSessionPipeline(makeRegistry(advanceDef), () => {}, {
            gameId: 'test',
            savePort: noopSavePort,
            logger,
        });

        // Every top-level action appends one ActionHistoryEntry (Stage 6). One more
        // than the cap forces exactly one overflow eviction — and its warn.
        let s = makeBaseSnapshot(0);
        for (let i = 0; i < MAX_ACTION_HISTORY_ENTRIES + 1; i++) {
            s = pipeline.process(s, advanceEnvelope(s.tick));
        }

        const overflowWarns = sink.entries.filter(
            (e) => e.level === 'warn' && e.message === 'action-history:overflow',
        );
        expect(overflowWarns.length).toBeGreaterThanOrEqual(1);
    });
});

// ── #90 — ReduceContext.logger populated → engine:tick warn is reachable ────────

describe('buildHostSessionPipeline — #90: ReduceContext.logger is wired', () => {
    it('emits the engine:tick warn on the injected logger when a timer-fired action is rejected by validate()', () => {
        const { logger, sink } = makeMemoryLogger();
        const { pipeline } = buildHostSessionPipeline(
            makeRegistry(advanceDef, rejectDef),
            () => {},
            { gameId: 'test', savePort: noopSavePort, logger },
        );

        const s0: BaseGameSnapshot = {
            ...makeBaseSnapshot(0),
            timers: { ['tmr-reject' as TimerId]: firingTimer('tmr-reject', 'game:reject') },
        };

        // engine:tick advances the timer (remainingTicks 1 → 0), fires game:reject,
        // whose validate() rejects → ActionUnauthorizedError, caught non-fatally with
        // a warn on ReduceContext.logger.
        pipeline.process(s0, tickEnvelope(s0.tick));

        const rejectWarns = sink.entries.filter(
            (e) => e.level === 'warn' && e.message === 'timer fired action rejected by validate()',
        );
        expect(rejectWarns.length).toBe(1);
    });
});
