import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
    AnimationClip,
    Bone,
    BufferGeometry,
    Group,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Points,
    PointsMaterial,
    Skeleton,
    SkinnedMesh,
    Texture,
} from 'three';
import type { Object3D } from 'three';

import type { LoadedGltfAsset } from './AssetManager';
import {
    GLTF_MODEL_FIXTURE_MESH_NAME,
    loadGltfModelFixture,
} from './__test-support__/gltfModelFixture.js';
import {
    applyModelInstanceMaterialOverride,
    cloneModelInstance,
    MalformedModelAssetError,
    type ModelInstance,
    releaseModelInstance,
} from './ModelInstance';

interface TwoBoneRigFixture {
    readonly asset: LoadedGltfAsset;
    readonly mesh: SkinnedMesh;
    readonly geometry: BufferGeometry;
    readonly material: MeshBasicMaterial;
    readonly texture: Texture;
    readonly clip: AnimationClip;
}

function createTwoBoneRigAsset(): TwoBoneRigFixture {
    const scene = new Group();
    const rootBone = new Bone();
    rootBone.name = 'hip';
    const childBone = new Bone();
    childBone.name = 'knee';
    rootBone.add(childBone);

    const geometry = new BufferGeometry();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = 'skin';
    mesh.add(rootBone);
    mesh.bind(new Skeleton([rootBone, childBone]));
    scene.add(mesh);

    const clip = new AnimationClip('idle', -1, []);
    return { asset: { scene, animations: [clip] }, mesh, geometry, material, texture, clip };
}

function createTwoSkinnedMeshAsset(): LoadedGltfAsset {
    const scene = new Group();
    for (const name of ['skin-a', 'skin-b']) {
        const bone = new Bone();
        const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
        mesh.name = name;
        mesh.add(bone);
        mesh.bind(new Skeleton([bone]));
        scene.add(mesh);
    }
    return { scene, animations: [] };
}

function getSkinnedMeshes(root: Object3D): SkinnedMesh[] {
    const found: SkinnedMesh[] = [];
    root.traverse((node) => {
        if ((node as Partial<SkinnedMesh>).isSkinnedMesh === true) {
            found.push(node as SkinnedMesh);
        }
    });
    return found;
}

function getSkinnedMesh(root: Object3D): SkinnedMesh {
    const meshes = getSkinnedMeshes(root);
    const [mesh] = meshes;
    if (mesh === undefined || meshes.length > 1) {
        throw new Error(`Fixture must contain exactly one SkinnedMesh, found ${meshes.length}.`);
    }
    return mesh;
}

function getBoneAt(root: Object3D, index: number): Object3D {
    const bone = getSkinnedMesh(root).skeleton.bones[index];
    if (bone === undefined) {
        throw new Error(`Fixture skeleton has no bone at index ${index}.`);
    }
    return bone;
}

function isDescendantOf(node: Object3D, ancestor: Object3D): boolean {
    for (let current = node.parent; current !== null; current = current.parent) {
        if (current === ancestor) {
            return true;
        }
    }
    return false;
}

describe('cloneModelInstance', () => {
    it('gives each instance an independent skeleton — posing one leaves the other unmoved', () => {
        const { asset } = createTwoBoneRigAsset();
        const first = cloneModelInstance(asset);
        const second = cloneModelInstance(asset);

        const firstKnee = getBoneAt(first.root, 1);
        const secondKnee = getBoneAt(second.root, 1);
        // Captured before posing: under a plain Object3D.clone() both skeletons
        // are the source skeleton, so firstKnee IS secondKnee and the pose
        // shows up here as PI/2.
        const secondKneeRotationX = secondKnee.rotation.x;
        firstKnee.rotation.x = Math.PI / 2;

        expect(secondKnee.rotation.x).toBe(secondKneeRotationX);
        expect(secondKnee.rotation.x).not.toBe(Math.PI / 2);
    });

    it('clones distinct skeletons whose bones descend from their own root while sharing geometry, material, and clips', () => {
        const { asset, mesh, geometry, material } = createTwoBoneRigAsset();
        const first = cloneModelInstance(asset);
        const second = cloneModelInstance(asset);

        const firstSkinned = getSkinnedMesh(first.root);
        const secondSkinned = getSkinnedMesh(second.root);
        expect(firstSkinned.skeleton).not.toBe(secondSkinned.skeleton);
        for (const instance of [first, second]) {
            const { bones } = getSkinnedMesh(instance.root).skeleton;
            expect(bones).toHaveLength(2);
            for (const bone of bones) {
                expect(isDescendantOf(bone, instance.root)).toBe(true);
            }
        }
        expect(firstSkinned.geometry).toBe(geometry);
        expect(secondSkinned.geometry).toBe(geometry);
        expect(firstSkinned.material).toBe(material);
        expect(secondSkinned.material).toBe(material);
        expect(first.clips[0]).toBe(asset.animations[0]);
        expect(second.clips[0]).toBe(asset.animations[0]);
        // Pins the boneInverses shared-by-reference fact the ModelInstance
        // TSDoc's re-bind prohibition rests on.
        expect(firstSkinned.skeleton.boneInverses).toBe(mesh.skeleton.boneInverses);
    });

    it('clones a non-skinned model through the same unconditional path', () => {
        const scene = new Group();
        const geometry = new BufferGeometry();
        const material = new MeshBasicMaterial();
        const mesh = new Mesh(geometry, material);
        mesh.name = 'static-prop';
        scene.add(mesh);
        const clip = new AnimationClip('spin', -1, []);
        const asset: LoadedGltfAsset = { scene, animations: [clip] };

        const instance = cloneModelInstance(asset);

        expect(instance.root).not.toBe(scene);
        const clonedMesh = instance.root.getObjectByName('static-prop') as Mesh;
        expect(clonedMesh).toBeDefined();
        expect(clonedMesh).not.toBe(mesh);
        expect(clonedMesh.geometry).toBe(geometry);
        expect(clonedMesh.material).toBe(material);
        expect(instance.clips[0]).toBe(clip);
    });

    it('throws MalformedModelAssetError for a rig whose bones are not descendants of the cloned root', () => {
        const scene = new Group();
        const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
        scene.add(mesh);
        // One bone inside the cloned root, one outside: the guard must refuse a
        // rig with ANY out-of-root bone, not only a fully orphaned skeleton.
        const insideBone = new Bone();
        mesh.add(insideBone);
        const orphanBone = new Bone();
        new Group().add(orphanBone);
        mesh.bind(new Skeleton([insideBone, orphanBone]));
        const asset: LoadedGltfAsset = { scene, animations: [] };

        expect(() => cloneModelInstance(asset)).toThrow(MalformedModelAssetError);
        expect(() => cloneModelInstance(asset)).toThrow(/descendant/);
    });

    it('throws MalformedModelAssetError naming EXT_mesh_gpu_instancing for an InstancedMesh node', () => {
        const scene = new Group();
        scene.add(new InstancedMesh(new BufferGeometry(), new MeshBasicMaterial(), 2));
        const asset: LoadedGltfAsset = { scene, animations: [] };

        expect(() => cloneModelInstance(asset)).toThrow(MalformedModelAssetError);
        expect(() => cloneModelInstance(asset)).toThrow(/EXT_mesh_gpu_instancing/);
    });

    it('wraps a circular-userData clone failure in MalformedModelAssetError with the original error as cause', () => {
        const { asset } = createTwoBoneRigAsset();
        asset.scene.userData['self'] = asset.scene.userData;

        let caught: unknown;
        try {
            cloneModelInstance(asset);
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(MalformedModelAssetError);
        expect((caught as MalformedModelAssetError).cause).toBeInstanceOf(TypeError);
    });

    it('throws MalformedModelAssetError with a distinct reason for a non-Object3D scene', () => {
        const asset = {
            scene: { name: 'not-a-scene' },
            animations: [],
        } as unknown as LoadedGltfAsset;

        expect(() => cloneModelInstance(asset)).toThrow(MalformedModelAssetError);
        expect(() => cloneModelInstance(asset)).toThrow(/Object3D/);
    });

    it.each([null, undefined])(
        'throws MalformedModelAssetError rather than a TypeError for a %s scene',
        (scene) => {
            const asset = { scene, animations: [] } as unknown as LoadedGltfAsset;

            expect(() => cloneModelInstance(asset)).toThrow(MalformedModelAssetError);
            expect(() => cloneModelInstance(asset)).toThrow(/Object3D/);
        },
    );
});

describe('releaseModelInstance', () => {
    it('disposes each SkinnedMesh skeleton exactly once and leaves shared resources alone', () => {
        const { asset, mesh, geometry, material, texture } = createTwoBoneRigAsset();
        const geometryDispose = vi.spyOn(geometry, 'dispose');
        const materialDispose = vi.spyOn(material, 'dispose');
        const textureDispose = vi.spyOn(texture, 'dispose');
        const sourceSkeletonDispose = vi.spyOn(mesh.skeleton, 'dispose');

        const instance = cloneModelInstance(asset);
        const cloneSkeletonDispose = vi.spyOn(getSkinnedMesh(instance.root).skeleton, 'dispose');

        releaseModelInstance(instance);
        releaseModelInstance(instance);

        expect(cloneSkeletonDispose).toHaveBeenCalledTimes(1);
        expect(sourceSkeletonDispose).not.toHaveBeenCalled();
        expect(geometryDispose).not.toHaveBeenCalled();
        expect(materialDispose).not.toHaveBeenCalled();
        expect(textureDispose).not.toHaveBeenCalled();
    });

    it('is a safe no-op for an instance with no skinned meshes', () => {
        const scene = new Group();
        scene.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
        const instance = cloneModelInstance({ scene, animations: [] });

        expect(() => releaseModelInstance(instance)).not.toThrow();
    });

    it('keeps disposing the remaining skeletons when one skeleton dispose throws', () => {
        const instance = cloneModelInstance(createTwoSkinnedMeshAsset());
        const [firstSkinned, secondSkinned] = getSkinnedMeshes(instance.root);
        if (firstSkinned === undefined || secondSkinned === undefined) {
            throw new Error('Fixture must clone two skinned meshes.');
        }
        vi.spyOn(firstSkinned.skeleton, 'dispose').mockImplementation(() => {
            throw new Error('boneTexture dispose listener failure');
        });
        const secondDispose = vi.spyOn(secondSkinned.skeleton, 'dispose');

        expect(() => releaseModelInstance(instance)).not.toThrow();
        expect(secondDispose).toHaveBeenCalledTimes(1);
    });

    it('is non-throwing for malformed instance values', () => {
        expect(() => releaseModelInstance(null as unknown as ModelInstance)).not.toThrow();
        expect(() => releaseModelInstance(undefined as unknown as ModelInstance)).not.toThrow();
        expect(() =>
            releaseModelInstance({ root: null, clips: [] } as unknown as ModelInstance),
        ).not.toThrow();
    });
});

describe('ModelInstance module shape', () => {
    it('imports neither react nor @react-three/fiber, and imports SkeletonUtils with the .js extension', () => {
        // The module must stay hook-free and renderer-free; reading the sibling
        // source file's import specifiers is how this test asserts that.
        const source = readFileSync(
            fileURLToPath(new URL('./ModelInstance.ts', import.meta.url)),
            'utf8',
        );
        const specifiers = [...source.matchAll(/import[^'"]*['"]([^'"]+)['"]/g)].map(
            (match) => match[1],
        );

        expect(specifiers.length).toBeGreaterThan(0);
        expect(specifiers).toContain('three/examples/jsm/utils/SkeletonUtils.js');
        for (const specifier of specifiers) {
            expect(specifier).not.toMatch(/^react(\/|$)/);
            expect(specifier).not.toMatch(/^@react-three\/fiber(\/|$)/);
        }
    });
});

// ── the per-instance material override ───────────────────────────────────────

function materialOf(root: Object3D, name: string): MeshStandardMaterial | MeshBasicMaterial {
    const node = root.getObjectByName(name);
    if (node === undefined) {
        throw new Error(`No node named '${name}' under the root.`);
    }
    const material = (node as Mesh).material;
    if (Array.isArray(material)) {
        throw new Error(`Node '${name}' carries an array material; use materialsOf.`);
    }
    return material as MeshStandardMaterial | MeshBasicMaterial;
}

function litMaterialOf(root: Object3D): MeshStandardMaterial {
    const material = materialOf(root, GLTF_MODEL_FIXTURE_MESH_NAME);
    if (!(material instanceof MeshStandardMaterial)) {
        throw new Error(`Expected a MeshStandardMaterial, got ${material.type}.`);
    }
    return material;
}

describe('cloneModelInstance with a material override', () => {
    it('gives two clones different tints while the cached material keeps its own colour', async () => {
        const asset = await loadGltfModelFixture('lit');
        const cached = litMaterialOf(asset.scene);

        const red = cloneModelInstance(asset, { color: 'red' });
        const green = cloneModelInstance(asset, { color: 0x00ff00 });

        expect(litMaterialOf(red.root)).not.toBe(cached);
        expect(litMaterialOf(green.root)).not.toBe(cached);
        expect(litMaterialOf(red.root)).not.toBe(litMaterialOf(green.root));
        expect(litMaterialOf(red.root).color.getHexString()).toBe('ff0000');
        expect(litMaterialOf(green.root).color.getHexString()).toBe('00ff00');
        expect(cached.color.getHexString()).toBe('ffffff');
    });

    it('sets the emissive independently of the tint, and never on the cached material', async () => {
        const asset = await loadGltfModelFixture('lit');
        const cached = litMaterialOf(asset.scene);

        const emissiveOnly = cloneModelInstance(asset, { emissive: 'blue' });
        const both = cloneModelInstance(asset, { color: 'red', emissive: 0x0000ff });

        expect(litMaterialOf(emissiveOnly.root).emissive.getHexString()).toBe('0000ff');
        expect(litMaterialOf(emissiveOnly.root).color.getHexString()).toBe('ffffff');
        expect(litMaterialOf(both.root).emissive.getHexString()).toBe('0000ff');
        expect(litMaterialOf(both.root).color.getHexString()).toBe('ff0000');
        expect(cached.emissive.getHexString()).toBe('000000');
        expect(cached.color.getHexString()).toBe('ffffff');
    });

    it('multiplies the tint into the authored base colour rather than replacing it', () => {
        const scene = new Group();
        const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ color: 0xff8000 }));
        mesh.name = 'authored';
        scene.add(mesh);

        const instance = cloneModelInstance({ scene, animations: [] }, { color: 0x00ff00 });

        // (1, 0.5, 0) × (0, 1, 0) — the authored red lane is masked, the green
        // lane keeps the authored half-intensity. A replacing override would
        // read 00ff00 here.
        expect(materialOf(instance.root, 'authored').color.getHexString()).toBe('008000');
    });

    it('keeps the texture shared by reference between the owned material and the cached one', () => {
        const scene = new Group();
        const texture = new Texture();
        const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: texture }));
        mesh.name = 'textured';
        scene.add(mesh);

        const instance = cloneModelInstance({ scene, animations: [] }, { color: 'red' });

        expect(materialOf(instance.root, 'textured')).not.toBe(mesh.material);
        expect(materialOf(instance.root, 'textured').map).toBe(texture);
    });

    it('reaches every element of an array material and every material-bearing node, not only meshes', () => {
        const scene = new Group();
        const first = new MeshStandardMaterial();
        const second = new MeshStandardMaterial();
        const multi = new Mesh(new BufferGeometry(), [first, second]);
        multi.name = 'multi';
        const points = new Points(new BufferGeometry(), new PointsMaterial());
        points.name = 'points';
        scene.add(multi, points);

        const instance = cloneModelInstance({ scene, animations: [] }, { color: 'red' });

        const owned = (instance.root.getObjectByName('multi') as Mesh).material;
        expect(Array.isArray(owned)).toBe(true);
        for (const [index, material] of (owned as MeshStandardMaterial[]).entries()) {
            expect(material).not.toBe([first, second][index]);
            expect(material.color.getHexString()).toBe('ff0000');
        }
        const ownedPoints = (instance.root.getObjectByName('points') as Points)
            .material as PointsMaterial;
        expect(ownedPoints).not.toBe(points.material);
        expect(ownedPoints.color.getHexString()).toBe('ff0000');
        expect(first.color.getHexString()).toBe('ffffff');
        expect(second.color.getHexString()).toBe('ffffff');
        expect(points.material.color.getHexString()).toBe('ffffff');
    });

    it('applies the tint to the unlit control arm and its emissive to nothing, without throwing', async () => {
        const asset = await loadGltfModelFixture('unlit');

        const instance = cloneModelInstance(asset, { color: 'red', emissive: 'blue' });

        const material = materialOf(instance.root, GLTF_MODEL_FIXTURE_MESH_NAME);
        expect(material).toBeInstanceOf(MeshBasicMaterial);
        expect(material.color.getHexString()).toBe('ff0000');
        // The property the lit fixture exists for: a MeshBasicMaterial has no
        // emissive, and the override must not invent one.
        expect((material as { readonly emissive?: unknown }).emissive).toBeUndefined();
    });
});

describe('applyModelInstanceMaterialOverride', () => {
    it('re-derives from the authored colour, so a changed tint does not compound', async () => {
        const asset = await loadGltfModelFixture('lit');
        const instance = cloneModelInstance(asset, { color: 'lime', emissive: 'blue' });

        applyModelInstanceMaterialOverride(instance, { color: 'red' });

        const material = litMaterialOf(instance.root);
        // Compounding green then red multiplies to black; re-deriving reads red.
        expect(material.color.getHexString()).toBe('ff0000');
        // The emissive left out of the new override returns to the authored black.
        expect(material.emissive.getHexString()).toBe('000000');
        expect(litMaterialOf(asset.scene).color.getHexString()).toBe('ffffff');
    });

    it('does nothing to an instance cloned without an override', async () => {
        const asset = await loadGltfModelFixture('lit');
        const instance = cloneModelInstance(asset);

        applyModelInstanceMaterialOverride(instance, { color: 'red' });

        expect(litMaterialOf(instance.root)).toBe(litMaterialOf(asset.scene));
        expect(litMaterialOf(asset.scene).color.getHexString()).toBe('ffffff');
    });
});

describe('releaseModelInstance with clone-owned materials', () => {
    it('disposes each clone-owned material once and leaves the cached material and its texture alone', () => {
        const scene = new Group();
        const texture = new Texture();
        const cached = new MeshStandardMaterial({ map: texture });
        const mesh = new Mesh(new BufferGeometry(), cached);
        mesh.name = 'textured';
        scene.add(mesh);
        const cachedDispose = vi.spyOn(cached, 'dispose');
        const textureDispose = vi.spyOn(texture, 'dispose');

        const instance = cloneModelInstance({ scene, animations: [] }, { color: 'red' });
        const ownedDispose = vi.spyOn(materialOf(instance.root, 'textured'), 'dispose');

        releaseModelInstance(instance);
        releaseModelInstance(instance);

        expect(ownedDispose).toHaveBeenCalledTimes(1);
        expect(cachedDispose).not.toHaveBeenCalled();
        expect(textureDispose).not.toHaveBeenCalled();
    });
});
