'use client';

import type { AnimationClip, Color, Material, Object3D, SkinnedMesh } from 'three';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import type { LoadedGltfAsset } from './AssetManager';

/**
 * A gltf asset the engine could not safely turn into a per-instance clone.
 *
 * Thrown instead of producing a clone that would render wrong or leak:
 * a non-`Object3D` scene, a rig whose bones live outside the cloned root,
 * an `EXT_mesh_gpu_instancing` model, or `userData` that cannot survive the
 * JSON round-trip `Object3D.copy` performs (original error in `cause`).
 */
export class MalformedModelAssetError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'MalformedModelAssetError';
    }
}

/**
 * What one {@link ModelInstance} may look like that its siblings do not.
 *
 * Passing an override — even an empty one — makes the clone OWN a copy of every
 * material under its root instead of sharing the cached asset's, and the values
 * here are applied to those copies. `Material.clone()` copies a material's
 * `Color` fields and hands its textures over by reference (`map`, pinned in
 * `ModelInstance.test.ts`), so the copies can be coloured freely while the
 * textures stay the cached asset's (Invariant #21).
 *
 * The cost, for a game deciding whether to tint many mounts: an overridden mount
 * allocates its own copy of every material under its root, held until the
 * instance is released. It compiles no new shader for a tint or an
 * emissive alone — three keys its program cache on a material's feature set,
 * not on its colour values (`WebGLPrograms.getProgramCacheKey`, three 0.184.0).
 */
export interface ModelInstanceMaterialOverride {
    /**
     * A tint, MULTIPLIED into each material's authored colour — a CSS colour
     * string or a packed `0xrrggbb` number.
     * White leaves the authored colour as it is; black masks it entirely.
     */
    readonly color?: string | number | undefined;
    /**
     * Replaces each material's emissive colour, in the same two forms. A
     * material with no emissive field — `MeshBasicMaterial`, which is what a
     * `KHR_materials_unlit` model loads as — takes none.
     */
    readonly emissive?: string | number | undefined;
}

/**
 * A per-instance clone of a cached gltf scene, safe to pose independently of
 * every sibling instance. `root` shares `geometry` and textures with the cached
 * original by reference, and shares its materials too unless the clone was
 * given a {@link ModelInstanceMaterialOverride}; `clips` is the cached asset's
 * `animations` array, shared deliberately (`AnimationClip` is read-only at
 * playback — a mixer keeps its own per-instance bindings).
 *
 * Each skeleton under `root` shares `boneInverses` BY REFERENCE with the
 * cached original: `Skeleton.clone()` hands `this.boneInverses` to a
 * constructor that assigns without copying. The clone stays safe only because
 * the bind uses an explicit bind matrix, which makes `SkinnedMesh.bind` skip
 * `calculateInverses()`. Never call `bind(skeleton)` WITHOUT a bind matrix on
 * any mesh under `root` — that recomputes the shared `boneInverses` in place
 * and corrupts every sibling instance plus the cache.
 */
export interface ModelInstance {
    readonly root: Object3D;
    readonly clips: readonly AnimationClip[];
}

/**
 * A material the clone owns, beside the cached one it was copied from. The
 * source is what an override is re-derived FROM on every apply, so a changed
 * tint never compounds on the previous one.
 */
interface OwnedMaterial {
    readonly owned: Material;
    readonly source: Material;
}

/**
 * Which materials each instance owns. Module-private, so ownership is
 * structural — never a property a caller could set on a material it supplied
 * itself.
 */
const ownedMaterials = new WeakMap<ModelInstance, readonly OwnedMaterial[]>();

function isObject3DLike(value: unknown): value is Object3D {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as { isObject3D?: unknown }).isObject3D === true
    );
}

function isSkinnedMeshLike(node: Object3D): node is SkinnedMesh {
    return (node as { isSkinnedMesh?: unknown }).isSkinnedMesh === true;
}

function isInstancedMeshLike(node: Object3D): boolean {
    return (node as { isInstancedMesh?: unknown }).isInstancedMesh === true;
}

function isMaterialLike(value: unknown): value is Material {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as { isMaterial?: unknown }).isMaterial === true
    );
}

function isColorLike(value: unknown): value is Color {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as { isColor?: unknown }).isColor === true
    );
}

/**
 * Clones a loaded gltf asset's whole scene into an independently posable
 * {@link ModelInstance}. Skinned and non-skinned models take the same path —
 * `SkeletonUtils.clone` re-links each skeleton to the cloned bones and leaves
 * everything else shared by reference. A `materialOverride` then replaces the
 * shared materials under the clone with copies the clone owns, coloured as the
 * override says (see {@link ModelInstanceMaterialOverride} for the cost).
 *
 * Takes the {@link LoadedGltfAsset} rather than an `Object3D` so a caller
 * cannot clone a sub-node: bones outside the cloned subtree would silently
 * map to `undefined` skeleton entries.
 *
 * @throws MalformedModelAssetError for the four unsafe shapes documented on
 * the error class.
 */
export function cloneModelInstance(
    asset: LoadedGltfAsset,
    materialOverride?: ModelInstanceMaterialOverride,
): ModelInstance {
    const scene: unknown = asset.scene;
    if (!isObject3DLike(scene)) {
        throw new MalformedModelAssetError(
            'Cannot clone model instance: asset.scene is not an Object3D.',
        );
    }

    scene.traverse((node) => {
        if (isInstancedMeshLike(node)) {
            throw new MalformedModelAssetError(
                `Cannot clone model instance: node '${node.name}' is an InstancedMesh ` +
                    '(EXT_mesh_gpu_instancing). Each clone would copy per-instance buffers ' +
                    'that releaseModelInstance never disposes, so such models are refused.',
            );
        }
    });

    let root: Object3D;
    try {
        root = cloneWithSkeleton(scene);
    } catch (error) {
        throw new MalformedModelAssetError(
            'Cannot clone model instance: cloning the scene failed. ' +
                'scene userData must survive a JSON round-trip.',
            { cause: error },
        );
    }

    root.traverse((node) => {
        if (!isSkinnedMeshLike(node)) {
            return;
        }
        if (node.skeleton.bones.some((bone) => bone === undefined)) {
            throw new MalformedModelAssetError(
                `Cannot clone model instance: skeleton of '${node.name}' references bones ` +
                    'that are not descendants of the cloned scene root.',
            );
        }
    });

    const instance: ModelInstance = { root, clips: asset.animations };
    if (materialOverride !== undefined) {
        const owned = adoptMaterials(root);
        applyOverride(owned, materialOverride);
        ownedMaterials.set(instance, owned);
    }
    return instance;
}

/**
 * Replace every material under `root` — single or array, on any node that
 * carries one — with a copy, and record the copies beside their sources.
 */
function adoptMaterials(root: Object3D): readonly OwnedMaterial[] {
    const owned: OwnedMaterial[] = [];
    const adopt = (source: Material): Material => {
        const copy = source.clone();
        owned.push({ owned: copy, source });
        return copy;
    };

    root.traverse((node) => {
        const holder = node as { material?: unknown };
        if (Array.isArray(holder.material)) {
            holder.material = holder.material.map((entry: unknown) =>
                isMaterialLike(entry) ? adopt(entry) : entry,
            );
        } else if (isMaterialLike(holder.material)) {
            holder.material = adopt(holder.material);
        }
    });
    return owned;
}

function colorFieldOf(material: Material, field: 'color' | 'emissive'): Color | null {
    const value: unknown = (material as unknown as Record<string, unknown>)[field];
    return isColorLike(value) ? value : null;
}

function applyOverride(
    owned: readonly OwnedMaterial[],
    override: ModelInstanceMaterialOverride,
): void {
    for (const pair of owned) {
        const color = colorFieldOf(pair.owned, 'color');
        const sourceColor = colorFieldOf(pair.source, 'color');
        if (color !== null && sourceColor !== null) {
            color.copy(sourceColor);
            if (override.color !== undefined) {
                color.multiply(sourceColor.clone().set(override.color));
            }
        }

        const emissive = colorFieldOf(pair.owned, 'emissive');
        const sourceEmissive = colorFieldOf(pair.source, 'emissive');
        if (emissive !== null && sourceEmissive !== null) {
            emissive.copy(sourceEmissive);
            if (override.emissive !== undefined) {
                emissive.set(override.emissive);
            }
        }
    }
}

/**
 * Re-colours the materials an instance owns to match `override`, in place.
 * Each value is re-derived from the cached material's own, so applying a new
 * tint replaces the previous one rather than multiplying into it, and a value
 * left out returns to what the asset authored. An instance cloned without an
 * override owns no materials and is left untouched.
 */
export function applyModelInstanceMaterialOverride(
    instance: ModelInstance,
    override: ModelInstanceMaterialOverride,
): void {
    const owned = ownedMaterials.get(instance);
    if (owned !== undefined) {
        applyOverride(owned, override);
    }
}

const releasedInstances = new WeakSet<ModelInstance>();

/**
 * Releases what a clone owns: the materials a
 * {@link ModelInstanceMaterialOverride} copied for it, and each of its
 * skeletons' lazily allocated bone texture, via `Skeleton.dispose()`.
 * Everything else under the instance — geometry, textures, morph attributes,
 * clips, and the materials of a clone given no override — is shared by
 * reference with the cached original and is owned by `AssetManager.dispose()`
 * (Invariant #21), so touching it here would corrupt the cache for every
 * sibling instance.
 *
 * Idempotent and non-throwing: releasing the same instance again is a no-op,
 * and a dispose failure must not abort teardown of what remains — the only
 * cost of a missed dispose is one leaked material or bone texture.
 */
export function releaseModelInstance(instance: ModelInstance): void {
    if (typeof instance !== 'object' || instance === null || releasedInstances.has(instance)) {
        return;
    }
    releasedInstances.add(instance);

    for (const { owned } of ownedMaterials.get(instance) ?? []) {
        try {
            owned.dispose();
        } catch {
            // Deliberately swallowed: see the TSDoc above.
        }
    }
    ownedMaterials.delete(instance);

    const root: unknown = instance.root;
    if (!isObject3DLike(root)) {
        return;
    }
    root.traverse((node) => {
        if (!isSkinnedMeshLike(node)) {
            return;
        }
        try {
            node.skeleton?.dispose?.();
        } catch {
            // Deliberately swallowed: see the TSDoc above.
        }
    });
}
