/**
 * renderer/assets/__tests__/engine-asset-loader-kinds.test.ts
 *
 * The engine's asset kinds are declared in one place and registered in another,
 * and this holds the two together (§4.10).
 *
 * `ENGINE_ASSET_LOADER_KIND_IDS` is what `validate:assets` checks a manifest's
 * kinds against; `createDefaultAssetLoaderRegistry` is what actually resolves
 * one at runtime. They were two lists with nothing holding them equal.
 *
 * Both directions matter. A kind declared with no loader is a gate that passes a
 * manifest the runtime then refuses; a loader with no declaration is the
 * opposite, a gate that refuses a file the engine can load.
 */

import { describe, expect, it } from 'vitest';

import { ENGINE_ASSET_LOADER_KIND_IDS } from '@chimera-engine/simulation/foundation/engine-asset-kinds.js';

import { createDefaultAssetLoaderRegistry, defaultAssetLoaders } from '../AssetManager';

describe('the engine asset-kind declaration', () => {
    it('registers a loader for exactly the kinds it declares', () => {
        // Read off the loader objects the registry is built from, not off a
        // list of ids beside them — a projection could be edited to agree with
        // the declaration while the loaders themselves had moved. Sorted and
        // compared whole, so a kind on either side alone is named in the
        // failure rather than reported as a count.
        const registered = defaultAssetLoaders().map((loader) => loader.kind);

        expect([...registered].sort()).toEqual([...ENGINE_ASSET_LOADER_KIND_IDS].sort());
    });

    it('resolves a loader for every declared kind through the default registry', () => {
        // The case above reads the loaders; this one reads the registry they
        // were handed to, so a loader dropped on the way in is still caught.
        const registry = createDefaultAssetLoaderRegistry();

        for (const kind of ENGINE_ASSET_LOADER_KIND_IDS) {
            expect(registry.has(kind), kind).toBe(true);
        }
    });

    it('declares no kind twice', () => {
        expect(new Set(ENGINE_ASSET_LOADER_KIND_IDS).size).toBe(
            ENGINE_ASSET_LOADER_KIND_IDS.length,
        );
    });
});
