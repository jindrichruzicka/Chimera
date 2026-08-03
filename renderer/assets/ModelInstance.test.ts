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
    Skeleton,
    SkinnedMesh,
    Texture,
} from 'three';
import type { Object3D } from 'three';

import type { LoadedGltfAsset } from './AssetManager';
import {
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
