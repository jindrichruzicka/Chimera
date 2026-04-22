/**
 * Public API of the simulation package.
 *
 * This barrel is the exclusive re-export surface for `@chimera/simulation`.
 * Consumers import from `@chimera/simulation` (this file) or sub-paths such as
 * `@chimera/simulation/engine` — never from internal module paths directly.
 *
 * Populated progressively as F03 tasks land:
 *   - T2 (§4.2): domain types
 *   - T3 (§4.7): ActionRegistry
 *   - T4 (§4.7): EngineActions
 *   - T5 (§4.7): ActionPipeline + StateReducer
 */

export * from './engine/index.js';
export * from './persistence/index.js';
