/**
 * Shared domain types for the AI framework.
 *
 * Lives here (rather than in PlayerAgent.ts) to break the circular import between
 * AIBrain.ts and PlayerAgent.ts — both import from here.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen) to every lifecycle method.
 *          AI state and command implementations must not mutate them.
 */

import type { GameResult as EngineGameResult } from '@chimera-engine/simulation/engine/types.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';

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

// Re-export the canonical PlayerSnapshot type from StateProjector (§4.6) so the
// AI layer receives the same shape the projection system produces.
// Invariant #3 — GameSnapshot never leaves the host; PlayerSnapshot crosses boundaries.
export type { PlayerSnapshot };

/**
 * Outcome of a completed game session.
 * `winnerIds` is empty for draws or abandoned games.
 */
export type GameResult = EngineGameResult;
