// simulation/foundation/engine-asset-kinds.ts
// §4.10 — The runtime ids of the asset kinds the engine registers a loader for.
//
// The phantom brands and the open `AssetKindRegistry` next door are TYPES: they
// say which ids exist, and nothing reads them at runtime. `validate:assets`
// needs the list itself, to report a manifest kind the engine cannot load.
//
// What "cannot load" means is decided elsewhere — by the loaders the renderer's
// default registry is built from — and this list is not what builds them.
// `renderer/assets/__tests__/engine-asset-loader-kinds.test.ts` is what holds
// the two answers equal.
//
// Lives in `simulation/foundation/` so the gate and that guard can both reach
// it from a leaf neither of them is inside.
//
// Zero dependencies — no Three.js, no DOM, no electron.

import type { AssetKindId } from './asset-contract.js';

/**
 * Every asset kind the engine registers a loader for.
 *
 * Typed against {@link AssetKindId}, so an id with no phantom brand behind it is
 * a compile error rather than a kind the gate accepts and the runtime refuses.
 */
export const ENGINE_ASSET_LOADER_KIND_IDS = [
    'texture',
    'audio-clip',
    'gltf-model',
    'sprite-sheet',
    'particle-config',
    'environment-map',
] as const satisfies readonly AssetKindId[];
