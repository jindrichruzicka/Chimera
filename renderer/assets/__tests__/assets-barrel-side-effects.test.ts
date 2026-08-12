/**
 * renderer/assets/__tests__/assets-barrel-side-effects.test.ts
 *
 * Holds the claims `renderer/assets/index.ts` makes about itself, none of
 * which any other artifact checks.
 *
 * **What it drags in.** The barrel's header says importing it mounts nothing,
 * loads nothing, and constructs no store. What this test measures is the
 * import GRAPH, not what evaluating it does: a side effect added inside a
 * module already in the set would change no edge and pass here.
 *
 * **The exported surface.** `package-exports-contract.test.ts` pins the
 * package's `exports` MAP, never what the barrel behind it exports — so the
 * runtime names are pinned as a closed set below, and the types by
 * `BarrelTypeSurface`, which catches a removal but not an addition.
 *
 * **The client boundary.** Every module shipping React surface (hooks,
 * context, provider, the clone seam the hooks publish) must carry
 * `'use client'` on line 1 so a Next consumer can import the barrel from a
 * client tree. The class-only modules the exported errors live in
 * (`AssetManager.ts`, `AssetLoaderRegistry.ts`, `DelegatingAssetManager.ts`)
 * deliberately lack the directive, matching the audio barrel's shape.
 *
 * Mechanism mirrors `renderer/audio/__tests__/audio-barrel-side-effects.test.ts`:
 * esbuild bundles the barrel with tree-shaking, and the test asserts over the
 * resolved inputs and external specifiers. The analyzer itself lives in
 * `assetsGraph.ts`, shared with the sheet readers' purity guard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as assetsBarrel from '../index';
import type {
    AssetManager,
    AssetManagerProviderProps,
    LoadedGltfAsset,
    LoadedSpriteSheetAsset,
    ModelInstance,
    ParsedModelAnimationSheet,
    ResolvedAsset,
    UseAssetState,
    UseModelInstanceState,
} from '../index';
import type { GLTFModelAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { analyzeModule, importsRuntime } from './assetsGraph.js';

/**
 * The barrel's TYPE surface, held by naming every member of it. Types leave no
 * runtime trace, so the symbol-set assertion below cannot see them; naming
 * each here makes `pnpm typecheck` the gate that catches a removal.
 */
interface BarrelTypeSurface {
    readonly manager: AssetManager;
    readonly providerProps: AssetManagerProviderProps;
    readonly gltf: LoadedGltfAsset;
    readonly spriteSheet: LoadedSpriteSheetAsset;
    readonly instance: ModelInstance;
    readonly resolved: ResolvedAsset;
    readonly assetState: UseAssetState<GLTFModelAsset>;
    readonly instanceState: UseModelInstanceState;
    readonly animationSheet: ParsedModelAnimationSheet;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('@chimera-engine/renderer/assets barrel', () => {
    it('exports exactly the documented public surface', () => {
        const typeSurface: BarrelTypeSurface | undefined = undefined;
        expect(typeSurface).toBeUndefined();

        // Sorted and exhaustive on purpose: an ADDITION is as reportable as a
        // removal, since every name here becomes public API of a published
        // package the moment it lands.
        expect(Object.keys(assetsBarrel).sort()).toEqual([
            'AssetManagerProvider',
            'MalformedModelAssetError',
            'NoActiveGameSessionError',
            'UnknownAssetManifestEntryError',
            'parseSpriteAtlas',
            'useAnimationSheet',
            'useAsset',
            'useAssetManager',
            'useModelInstance',
            'useSpriteAnimationSheet',
            'useSpriteAtlas',
        ]);
    });

    it('pulls in exactly thirteen asset-layer modules and no store', async () => {
        const { inputs, externals } = await analyzeModule('index.ts');

        // EXHAUSTIVE, not a denylist (see the audio sibling for why).
        // `AssetManager.ts` and `DelegatingAssetManager.ts` are in the graph
        // because the exported errors live in them; `AssetLoaderRegistry.ts`
        // rides in because `AssetManager.ts` builds its default loader
        // registry from it; `animationSheet.ts` because `useAnimationSheet.ts`
        // calls both its parsers; `spriteAtlas.ts` and `useSpriteAtlas.ts`
        // because the sprite half of the sheet seam now ships from here — it
        // has a React binding to serve (`AnimatedSprite`, `useSpriteClipPlayer`).
        // No `state/` store appears — this barrel, unlike `audio`,
        // is import-inert at the store level.
        // Compared on the last TWO path segments (CWD-independent — see the
        // audio sibling).
        const dirAndFile = inputs.map((input) => input.split('/').slice(-2).join('/')).sort();
        expect(dirAndFile).toEqual([
            'assets/AssetLoaderRegistry.ts',
            'assets/AssetManager.ts',
            'assets/AssetManagerContext.ts',
            'assets/AssetManagerProvider.tsx',
            'assets/DelegatingAssetManager.ts',
            'assets/ModelInstance.ts',
            'assets/animationSheet.ts',
            'assets/index.ts',
            'assets/spriteAtlas.ts',
            'assets/useAnimationSheet.ts',
            'assets/useAsset.ts',
            'assets/useModelInstance.ts',
            'assets/useSpriteAtlas.ts',
        ]);

        // three IS reached — a recorded decision, not drift: `AssetManager.ts`
        // names `TextureLoader`/`GLTFLoader` for its default loader registry
        // and `ModelInstance.ts` names `SkeletonUtils` for the clone. All are
        // externalized peers, so the consumer app still owns the one copy.
        expect(importsRuntime(externals, 'three')).toBe(true);
        expect(externals.has('three/examples/jsm/utils/SkeletonUtils.js')).toBe(true);
        // The frame loop stays out: the barrel must be mountable outside a
        // <Canvas>; only `components/r3f` may reach @react-three/fiber.
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });

    it("carries 'use client' on line 1 of every module shipping React surface", () => {
        for (const moduleFile of [
            'useAsset.ts',
            'AssetManagerContext.ts',
            'AssetManagerProvider.tsx',
            'useModelInstance.ts',
            'ModelInstance.ts',
            'useAnimationSheet.ts',
            'useSpriteAtlas.ts',
        ]) {
            const source = readFileSync(resolve(__dirname, '..', moduleFile), 'utf8');
            expect(source.split('\n')[0], moduleFile).toBe(`'use client';`);
        }
    });
});
