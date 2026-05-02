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

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Base type for game-specific AI personality parameters.
 *
 * Architecture reference: §4.9, Invariant #18 — AIParams are passed by value
 * (frozen) to every lifecycle method. AI state and command implementations
 * must not mutate them.
 */
// @chimera-review: Intentionally empty base interface; games extend with domain-specific fields (e.g., TacticsAIParams)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AIParams extends Record<string, unknown> {}

/**
 * Minimal viewer-safe snapshot delivered to each PlayerAgent per tick.
 *
 * Formal `PlayerSnapshot` definition is deferred to F26 (StateProjector
 * landing). Until then this interface captures the minimum shape required by
 * the AI layer — `tick` for temporal awareness, plus any additional fields
 * that concrete game snapshots extend with via structural subtyping.
 *
 * // TODO(F26): replace with import from @chimera/simulation/engine/types.js
 */
export interface PlayerSnapshot {
    readonly tick: number;
}

/**
 * Outcome of a completed game session.
 * `winner` is `null` for draws or abandoned games.
 */
export interface GameResult {
    readonly winner: PlayerId | null;
}

/**
 * Structural brain interface — mirrors the public lifecycle surface of
 * `AIBrain` (to be implemented in F23).
 *
 * Defined locally so `PlayerAgent.ts` does not import from `ai/engine/AIBrain.ts`
 * (which does not exist yet). `AIBrain` must satisfy this interface structurally
 * when implemented.
 *
 * Generic over `TParams extends AIParams` to enforce type-level guarantees that
 * an AIBrain is not accidentally wired to an AIPlayerAgent of a different game
 * (Invariant #18).
 */
// @chimera-review: TParams reserved for F23 when AIBrain lifecycle methods will receive AIParams (currently unused but architecturally required)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface AgentBrain<TParams extends AIParams = AIParams> {
    tick(snapshot: PlayerSnapshot, tick: number): void;
    onGameStart(snapshot: PlayerSnapshot): void;
    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void;
}

// ─── PlayerAgent interface ────────────────────────────────────────────────────

/**
 * Strategy interface for per-player controllers.
 *
 * Human players: actions arrive via IPC — all lifecycle methods are no-ops.
 * AI players:    lifecycle methods are forwarded to the `AgentBrain`.
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
        private readonly brain: AgentBrain<TParams>,
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
