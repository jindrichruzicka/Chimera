/**
 * Public contract surface of `@chimera-engine/simulation`.
 *
 * The package root (`.`) exposes the engine's side-effect-free CONTRACT TYPES
 * only, re-exported from `./contracts`. Importing `@chimera-engine/simulation`
 * therefore evaluates no runtime module — it is the curated, tree-shakeable
 * type barrel that downstream packages depend on without pulling the simulation
 * runtime graph (Invariant #1).
 *
 * Runtime APIs are reached through explicit subpaths, never the root:
 *   - `@chimera-engine/simulation/engine`       — ActionRegistry, ActionPipeline, StateReducer, …
 *   - `@chimera-engine/simulation/projection`   — StateProjector, visibility, commitments
 *   - `@chimera-engine/simulation/content`      — ContentDatabase, AssetRef factories
 *   - `@chimera-engine/simulation/persistence`  — save/load repositories
 *   - `@chimera-engine/simulation/profile`      — player profile state
 *   - `@chimera-engine/simulation/replay`       — replay serialization
 *   - `@chimera-engine/simulation/scene`        — scene registry/manager
 *   - `@chimera-engine/simulation/settings`     — engine settings
 *   - `@chimera-engine/simulation/foundation/*` — absorbed foundation modules (contracts + leaf utils)
 *
 * `debug/` is deliberately NOT reachable from the root barrel: it is
 * debug-mode-only tooling (Invariant #31), imported via the
 * `@chimera-engine/simulation/debug` subpath so the production graph never pulls it in.
 */
export type * from './contracts/index.js';
