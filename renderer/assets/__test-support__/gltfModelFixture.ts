/**
 * renderer/assets/__test-support__/gltfModelFixture.ts
 *
 * A minimal glTF model, built in memory and parsed by the real `GLTFLoader`, for
 * tests that need a model whose material has a lighting response.
 *
 * **Why this exists.** Both committed showcase rigs declare
 * `KHR_materials_unlit` (`apps/tactics/asset-manifest.test.ts` parses their
 * declarations), which `GLTFLoader` maps to `MeshBasicMaterial`. That class
 * carries no `emissive` field, so an emissive override applied to one writes a
 * property three never reads — a silent no-op a test asserting the write would
 * not catch. A per-instance material override needs a `MeshStandardMaterial` to
 * be measured against, and neither rig could supply one.
 *
 * **Why the bytes are built rather than committed.**
 * `showcase-rig-animated.glb` is committed because the app loads it at runtime
 * through `chimera://`, and a committed binary is opaque to review — which is
 * what forces the generator plus byte-equality gate around that one file.
 * Nothing loads this fixture at runtime. Only tests do, and a test can build the
 * container in memory, so there is no binary here and nothing that can drift
 * from the source describing it: this file IS the fixture. It is declared in no
 * asset manifest, so `validate:assets` neither sees it nor needs to.
 *
 * **Why it goes through `GLTFLoader` rather than constructing a material.** What
 * an override has to work against on a MODEL path is what the loader produces
 * from a container, including every default it fills in — and which CLASS it
 * produces is the loader's decision, taken from the container's extensions
 * rather than from anything a caller states. Parsing real bytes is what makes
 * the fixture's shading a measurement rather than an assumption.
 *
 * **Why it lives under `renderer/`.** `renderer/**` must name no game — held by
 * the `no-restricted-imports` zone in `eslint.config.mjs` that rejects every
 * `apps/**` specifier from renderer source — so a fixture the renderer's own
 * tests consume cannot be a game's asset.
 *
 * **Why the container writer is shared.** `glbContainer.ts` beside this file
 * writes the bytes, and `tools/gen-showcase-animated-glb.ts` writes the
 * committed rig through the same module. `renderer/` must not import `tools/`,
 * so the module sits here and the tool imports it — the direction the
 * `tools → renderer` edge already runs.
 *
 * What the container holds, and what is asserted about it, is
 * `__tests__/gltf-model-fixture.test.ts`; this header does not restate it.
 */

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { LoadedGltfAsset } from '../AssetManager.js';
import {
    COMPONENT_TYPE_FLOAT,
    COMPONENT_TYPE_UNSIGNED_SHORT,
    PRIMITIVE_MODE_TRIANGLES,
    TARGET_ARRAY_BUFFER,
    TARGET_ELEMENT_ARRAY_BUFFER,
    asFloat32,
    boundsOf,
    packFloats,
    packGlb,
    packUnsignedShorts,
} from './glbContainer.js';

/**
 * Which material the fixture's mesh loads as.
 *
 * `lit` is what an override is measured against. `unlit` is its CONTROL, so a
 * test can show its lit-material assertions are sensitive to shading rather than
 * passing for some other reason. It is also the shading both committed showcase
 * rigs have, which is what made them unusable here.
 *
 * How far the two arms are held identical — and over which parts of the
 * container — is `__tests__/gltf-model-fixture.test.ts`'s to state, because that
 * is what measures it.
 */
export type GltfModelFixtureShading = 'lit' | 'unlit';

/** The name of the fixture's single mesh node, asserted rather than searched on. */
export const GLTF_MODEL_FIXTURE_MESH_NAME = 'fixture-quad';

/**
 * The fixture's base colour, as a glTF `baseColorFactor`.
 *
 * WHITE, and that is load-bearing. A tint is a multiply: against the showcase
 * rigs' magenta a green tint resolves to black, so a correct override would be
 * indistinguishable from an unapplied one for whole classes of tint value. White
 * carries every tint through unchanged.
 */
const BASE_COLOR_FACTOR: readonly [number, number, number, number] = [1, 1, 1, 1];

/**
 * A mid roughness and no metalness — an ordinary dielectric surface.
 *
 * Neither value is load-bearing for an override; they are here because a glTF
 * material that declares no `pbrMetallicRoughness` at all takes the spec's
 * defaults (metallic 1, rough 1), and a fully metallic surface is the one shading
 * where a base colour barely reaches the frame.
 *
 * No `emissiveFactor` is authored anywhere in this container, and THAT is
 * load-bearing: it leaves the glTF default of black, and an emissive already lit
 * cannot be shown to have been set.
 */
const ROUGHNESS_FACTOR = 0.5;
const METALLIC_FACTOR = 0;

// ── Geometry ─────────────────────────────────────────────────────────────────
//
// A unit quad in the XY plane facing +Z. Two triangles, four vertices, and an
// authored NORMAL attribute. Normals are authored rather than left out because
// `GLTFLoader` answers an absent NORMAL by setting `flatShading` on a SEPARATE
// cached material (`GLTFLoader.js:3446`, `:3505`) — so omitting them would hand
// the override a different material than the one this fixture claims to be.

const HALF = 0.5;
/**
 * The quad's four corners, wound counter-clockwise from the RIGHT-BOTTOM corner.
 *
 * Starting there rather than at left-bottom is deliberate and is about the bounds
 * helper, not the geometry: `boundsOf` seeds `min` and `max` from the FIRST
 * vertex, so a first vertex that is already the component-wise minimum leaves
 * every `min` comparison unable to fire — and a bounds helper that never updated
 * its min would pass. From this corner the x lane's min must be found later in
 * the run and the y lane's max must be, so both comparisons are exercised. The
 * winding is unchanged, and so is the shape.
 */
const POSITIONS: readonly (readonly [number, number, number])[] = [
    [HALF, -HALF, 0],
    [HALF, HALF, 0],
    [-HALF, HALF, 0],
    [-HALF, -HALF, 0],
];
const NORMALS: readonly (readonly [number, number, number])[] = [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
];
const INDICES: readonly number[] = [0, 1, 2, 0, 2, 3];

const UNLIT_EXTENSION = 'KHR_materials_unlit';

/**
 * Build the fixture as a binary glTF container.
 *
 * Deterministic: the same bytes on every machine, so the two
 * shading arms are comparable at all. What differs between them is
 * `gltf-model-fixture.test.ts`'s to state.
 */
export function buildGltfModelFixture(shading: GltfModelFixtureShading): Uint8Array {
    const positionValues = POSITIONS.flatMap((vertex) => [...vertex]);
    const normalValues = NORMALS.flatMap((vertex) => [...vertex]);

    const positionBytes = packFloats(positionValues);
    const normalBytes = packFloats(normalValues);
    const indexBytes = packUnsignedShorts([...INDICES]);

    // Laid out end to end with no padding: each of these three views is a whole
    // number of 4-byte words (48, 48 and 12 bytes), so sequential offsets are
    // already 4-aligned. `gltf-model-fixture.test.ts` asserts that ALIGNMENT and
    // separately decodes each view back out of the buffer — the decode is what
    // catches an offset that is aligned but wrong, which an alignment check
    // cannot see.
    const bin = Buffer.concat([positionBytes, normalBytes, indexBytes]);
    const positionOffset = 0;
    const normalOffset = positionBytes.length;
    const indexOffset = normalOffset + normalBytes.length;

    const positionBounds = boundsOf(asFloat32(positionValues), 3);
    const isUnlit = shading === 'unlit';

    const json = {
        asset: { version: '2.0', generator: 'chimera gltfModelFixture' },
        scene: 0,
        scenes: [{ name: 'fixture-scene', nodes: [0] }],
        nodes: [{ name: GLTF_MODEL_FIXTURE_MESH_NAME, mesh: 0 }],
        meshes: [
            {
                primitives: [
                    {
                        mode: PRIMITIVE_MODE_TRIANGLES,
                        attributes: { POSITION: 0, NORMAL: 1 },
                        indices: 2,
                        material: 0,
                    },
                ],
            },
        ],
        materials: [
            {
                name: 'fixture-surface',
                pbrMetallicRoughness: {
                    baseColorFactor: [...BASE_COLOR_FACTOR],
                    metallicFactor: METALLIC_FACTOR,
                    roughnessFactor: ROUGHNESS_FACTOR,
                },
                // No `emissiveFactor` in either arm: the glTF default is black,
                // which is what makes an emissive override observable on the lit
                // one. What differs between the arms, and over which parts of the
                // container, is `gltf-model-fixture.test.ts`'s to state.
                ...(isUnlit ? { extensions: { [UNLIT_EXTENSION]: {} } } : {}),
            },
        ],
        accessors: [
            {
                bufferView: 0,
                componentType: COMPONENT_TYPE_FLOAT,
                count: POSITIONS.length,
                type: 'VEC3',
                min: [...positionBounds.min],
                max: [...positionBounds.max],
            },
            {
                bufferView: 1,
                componentType: COMPONENT_TYPE_FLOAT,
                count: NORMALS.length,
                type: 'VEC3',
            },
            {
                bufferView: 2,
                componentType: COMPONENT_TYPE_UNSIGNED_SHORT,
                count: INDICES.length,
                type: 'SCALAR',
            },
        ],
        bufferViews: [
            {
                buffer: 0,
                byteOffset: positionOffset,
                byteLength: positionBytes.length,
                target: TARGET_ARRAY_BUFFER,
            },
            {
                buffer: 0,
                byteOffset: normalOffset,
                byteLength: normalBytes.length,
                target: TARGET_ARRAY_BUFFER,
            },
            {
                buffer: 0,
                byteOffset: indexOffset,
                byteLength: indexBytes.length,
                target: TARGET_ELEMENT_ARRAY_BUFFER,
            },
        ],
        // No `uri`: the buffer IS this container's BIN chunk.
        buffers: [{ byteLength: bin.length }],
        // `GLTFLoader` instantiates an extension plugin only for a name listed
        // here, and then looks the plugin up by name for any material carrying
        // the extension. So this is not a redundant declaration beside the
        // material's own: without it, MEASURED, `parse` REJECTS rather than
        // ignoring the material's entry — it reads the missing plugin and throws
        // on `getMaterialType`.
        ...(isUnlit ? { extensionsUsed: [UNLIT_EXTENSION] } : {}),
    };

    return packGlb(JSON.stringify(json), bin);
}

/**
 * Parse the fixture into the shape `useModelInstance` consumes.
 *
 * `GLTFLoader.parse` takes bytes directly and reaches no network and no DOM for
 * a container with no textures, which is what lets this run in the default node
 * test environment.
 */
export async function loadGltfModelFixture(
    shading: GltfModelFixtureShading,
): Promise<LoadedGltfAsset> {
    const container = buildGltfModelFixture(shading);
    // `parse` reads a whole `ArrayBuffer`, so it is handed one holding exactly
    // the container and nothing else. `packGlb` happens to return a view that
    // already satisfies that, and this does not rely on it.
    const bytes = new ArrayBuffer(container.byteLength);
    new Uint8Array(bytes).set(container);

    const gltf = await new Promise<GLTF>((resolve, reject) => {
        new GLTFLoader().parse(bytes, '', resolve, reject);
    });
    return { scene: gltf.scene, animations: gltf.animations };
}
