'use client';

import type { AnimationClip, Object3D, SkinnedMesh } from 'three';
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
 * A per-instance clone of a cached gltf scene, safe to pose independently of
 * every sibling instance. `root` shares `geometry`, `material` and textures
 * with the cached original by reference; `clips` is the cached asset's
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

/**
 * Clones a loaded gltf asset's whole scene into an independently posable
 * {@link ModelInstance}. Skinned and non-skinned models take the same path —
 * `SkeletonUtils.clone` re-links each skeleton to the cloned bones and leaves
 * everything else shared by reference.
 *
 * Takes the {@link LoadedGltfAsset} rather than an `Object3D` so a caller
 * cannot clone a sub-node: bones outside the cloned subtree would silently
 * map to `undefined` skeleton entries.
 *
 * @throws MalformedModelAssetError for the four unsafe shapes documented on
 * the error class.
 */
export function cloneModelInstance(asset: LoadedGltfAsset): ModelInstance {
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

    return { root, clips: asset.animations };
}

const releasedInstances = new WeakSet<ModelInstance>();

/**
 * Releases the one GPU resource a clone owns: each of its skeletons' lazily
 * allocated bone texture, via `Skeleton.dispose()`. Everything else under the
 * instance — geometry, material, textures, morph attributes, clips — is
 * shared by reference with the cached original and is owned by
 * `AssetManager.dispose()` (Invariant #21), so touching it here would corrupt
 * the cache for every sibling instance.
 *
 * Idempotent and non-throwing: releasing the same instance again is a no-op,
 * and a dispose failure must not abort teardown of the remaining skeletons —
 * the only cost of a missed dispose is one leaked bone texture.
 */
export function releaseModelInstance(instance: ModelInstance): void {
    if (typeof instance !== 'object' || instance === null || releasedInstances.has(instance)) {
        return;
    }
    releasedInstances.add(instance);

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
