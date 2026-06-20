/**
 * Public contract surface of `@chimera/simulation`.
 *
 * The package root (`.`) exposes the engine's side-effect-free CONTRACT TYPES
 * only, re-exported from `./contracts`. Importing `@chimera/simulation`
 * therefore evaluates no runtime module — it is the curated, tree-shakeable
 * type barrel that downstream packages depend on without pulling the simulation
 * runtime graph (Invariant #1).
 *
 * Runtime APIs are reached through explicit subpaths, never the root:
 *   - `@chimera/simulation/engine`       — ActionRegistry, ActionPipeline, StateReducer, …
 *   - `@chimera/simulation/projection`   — StateProjector, visibility, commitments
 *   - `@chimera/simulation/content`      — ContentDatabase, AssetRef factories
 *   - `@chimera/simulation/persistence`  — save/load repositories
 *   - `@chimera/simulation/profile`      — player profile state
 *   - `@chimera/simulation/replay`       — replay serialization
 *   - `@chimera/simulation/scene`        — scene registry/manager
 *   - `@chimera/simulation/settings`     — engine settings
 *   - `@chimera/simulation/foundation/*` — absorbed foundation modules (contracts + leaf utils)
 *
 * `debug/` is deliberately NOT reachable from the root barrel: it is
 * debug-mode-only tooling (Invariant #31), imported via the
 * `@chimera/simulation/debug` subpath so the production graph never pulls it in.
 */
export type * from './contracts/index.js';
