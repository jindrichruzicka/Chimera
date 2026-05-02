/**
 * ai/engine/AITypes.ts
 *
 * Shared domain types for the AI framework.
 *
 * Extracted from PlayerAgent.ts to break the circular import between
 * AIBrain.ts ↔ PlayerAgent.ts (both now import from here instead).
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method.
 *          AI state and command implementations must not mutate them.
 */

import type { PlayerId } from '@chimera/simulation/engine/types.js';

// ─── AIParams ─────────────────────────────────────────────────────────────────

/**
 * Base type for game-specific AI personality parameters.
 *
 * Architecture reference: §4.9, Invariant #18 — AIParams are passed by value
 * (frozen) to every lifecycle method. AI state and command implementations
 * must not mutate them.
 */
// Primitive-only values ensure shallow Object.freeze in AIBrain is complete (Invariant #18).
// Games extend this with number/string/boolean/null/undefined fields only — no arrays or nested objects.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AIParams extends Record<string, number | string | boolean | null | undefined> {}

// ─── PlayerSnapshot ───────────────────────────────────────────────────────────

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

// ─── GameResult ───────────────────────────────────────────────────────────────

/**
 * Outcome of a completed game session.
 * `winner` is `null` for draws or abandoned games.
 */
export interface GameResult {
    readonly winner: PlayerId | null;
}
