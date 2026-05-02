/**
 * ai/engine/PlayerAgent.ts
 *
 * PlayerAgent strategy interface with HumanPlayerAgent (no-op stub) and
 * AIPlayerAgent (brain delegate) implementations.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 * Task: F22 (issue #412)
 *
 * Invariants upheld:
 *   #16 — AI players submit EngineAction through ActionPipeline. AIPlayerAgent
 *          provides no mutation shortcut; it only calls brain lifecycle methods.
 */

import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type { AIBrain } from './AIBrain.js';
import type { AIParams, GameResult, PlayerSnapshot } from './AITypes.js';

export type { AIParams, GameResult, PlayerSnapshot };

// ─── PlayerAgent interface ────────────────────────────────────────────────────

/**
 * Strategy interface for per-player controllers.
 *
 * Human players: actions arrive via IPC — all lifecycle methods are no-ops.
 * AI players:    lifecycle methods are forwarded to the `AIBrain`.
 *
 * Both kinds share the same `ActionPipeline` path for any submitted
 * `EngineAction` (Invariant #16).
 */
export interface PlayerAgent {
    readonly playerId: PlayerId;
    readonly kind: 'human' | 'ai';
    onTick(snapshot: PlayerSnapshot, tick: number): void;
    onGameStart(snapshot: PlayerSnapshot): void;
    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void;
}

// ─── HumanPlayerAgent ─────────────────────────────────────────────────────────

/**
 * No-op human player stub.
 *
 * Human actions arrive through IPC (not through the agent system), so every
 * lifecycle method is intentionally empty. The empty bodies are valid per the
 * `ai/` lint exception for no-op stubs.
 */
export class HumanPlayerAgent implements PlayerAgent {
    readonly kind = 'human' as const;

    constructor(readonly playerId: PlayerId) {}

    // @chimera-review: HumanPlayerAgent lifecycle methods are intentional no-ops — human actions arrive via IPC, not the agent system (§4.9)
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onTick(_snapshot: PlayerSnapshot, _tick: number): void {}

    // @chimera-review: HumanPlayerAgent lifecycle methods are intentional no-ops — human actions arrive via IPC, not the agent system (§4.9)
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onGameStart(_snapshot: PlayerSnapshot): void {}

    // @chimera-review: HumanPlayerAgent lifecycle methods are intentional no-ops — human actions arrive via IPC, not the agent system (§4.9)
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onGameEnd(_snapshot: PlayerSnapshot, _result: GameResult): void {}
}

// ─── AIPlayerAgent ────────────────────────────────────────────────────────────

/**
 * AI player agent — thin wrapper that delegates all lifecycle calls to its brain.
 *
 * Does not provide any mutation shortcut. The brain must dispatch any
 * `EngineAction` through `CommandContext.dispatch()` which routes through
 * `ActionPipeline`, identical to human actions (Invariant #16).
 *
 * Generic over `TParams extends AIParams` to enforce type-level guarantees
 * (Invariant #18) — an AIBrain<TacticsAIParams> cannot be accidentally wired
 * to an AIPlayerAgent belonging to a different game.
 */
export class AIPlayerAgent<TParams extends AIParams = AIParams> implements PlayerAgent {
    readonly kind = 'ai' as const;

    constructor(
        readonly playerId: PlayerId,
        private readonly brain: AIBrain<TParams>,
    ) {}

    onTick(snapshot: PlayerSnapshot, tick: number): void {
        this.brain.tick(snapshot, tick);
    }

    onGameStart(snapshot: PlayerSnapshot): void {
        this.brain.onGameStart(snapshot);
    }

    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void {
        this.brain.onGameEnd(snapshot, result);
    }
}
