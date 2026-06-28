/**
 * `@chimera-engine/simulation/contracts` — the side-effect-free contract surface.
 *
 * This barrel re-exports ONLY contract *types* from the zero-dependency
 * foundation layer (`simulation/foundation/`). Every re-export is `export type`,
 * so importing this subpath evaluates no simulation runtime module: consumers
 * such as `@chimera-engine/networking` and `@chimera-engine/renderer` can depend on the
 * engine's wire/contract types without pulling the simulation runtime graph,
 * preserving Invariant #1 (the engine core stays free of React, DOM, and
 * networking) from the consumer side.
 *
 * Only genuinely type-only foundation modules are re-exported here. Foundation
 * modules that carry runtime (schemas, brand factories, wire codecs — e.g.
 * `messages-schemas`, `crc32`, `asset-ref-parse`) are reached through their own
 * `@chimera-engine/simulation/foundation/<module>` subpath, not this barrel.
 *
 * Asserted side-effect-free by
 * `simulation/__tests__/contract-barrel-side-effects.test.ts`.
 */
export type * from '../foundation/engine-contract.js';
export type * from '../foundation/asset-contract.js';
export type * from '../foundation/commitment-contract.js';
export type * from '../foundation/snapshot-contract.js';
export type * from '../foundation/lobby-contract.js';
export type * from '../foundation/chat.js';
export type * from '../foundation/game-content-contract.js';
export type * from '../foundation/game-shell-contract.js';
export type * from '../foundation/replay-bridge-contract.js';
export type * from '../foundation/logging.js';
