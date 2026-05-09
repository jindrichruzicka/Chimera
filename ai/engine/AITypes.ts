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

import type { MatchResult } from '@chimera/simulation/engine/types.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';

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

// ─── PlayerSnapshot (imported from StateProjector) ────────────────────────────

// Re-export the canonical PlayerSnapshot type from F26 StateProjector (§4.6).
// This replaces the pre-F26 local stub interface, ensuring the AI layer receives
// the same `PlayerSnapshot` shape that the projection system produces.
// Invariant #3 — GameSnapshot never leaves the host; PlayerSnapshot crosses boundaries.
export type { PlayerSnapshot };

// ─── GameResult ───────────────────────────────────────────────────────────────

/**
 * Outcome of a completed game session.
 * `winnerIds` is empty for draws or abandoned games.
 */
export type GameResult = MatchResult;
