/**
 * renderer/assets/__tests__/gltf-model-fixture.test.ts
 *
 * Holds the properties that make `__test-support__/gltfModelFixture.ts` usable
 * as the model a per-instance material override is measured against. Why the
 * fixture exists, why it is built rather than committed, and why it lives under
 * `renderer/` are stated in that module's header and not restated here.
 *
 * **Two layers, and the container layer is the one that is easy to skip.** A
 * builder that emitted a correct glTF JSON object into a MALFORMED container
 * would satisfy every assertion made about the document — the trap
 * `tools/gen-showcase-animated-glb.test.ts` names for the generator beside this
 * one. So the container is read as a container first (magic, version, declared
 * length, chunk types, chunk padding), and the document is read out of that read
 * rather than out of a fixed offset.
 *
 * **The binary payload is decoded, not trusted.** Position, normal and index
 * views are read back out of the BIN chunk and compared to the authored values,
 * and the POSITION accessor's declared bounds are compared to the data they
 * claim to bound. Nothing about the geometry is asserted by presence alone: a
 * `NORMAL` attribute of four zero vectors, or an index view reading float bytes
 * as `UNSIGNED_SHORT`, both pass a presence check and both destroy the fixture.
 *
 * The `unlit` arm is this file's control, and it is only worth that if shading is
 * the single difference between the arms. So they are compared on BOTH halves of
 * the container: the JSON document down to the material (the axis the claim
 * lives on), and the BIN chunk byte for byte — the half a document comparison
 * cannot see, and where a zeroed buffer would otherwise hide.
 */

import { describe, expect, it } from 'vitest';

import { Group, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import type { Mesh } from 'three';

import {
    GLTF_MODEL_FIXTURE_MESH_NAME,
    buildGltfModelFixture,
    loadGltfModelFixture,
} from '../__test-support__/gltfModelFixture.js';
import { cloneModelInstance } from '../ModelInstance.js';

// ── Container reading ────────────────────────────────────────────────────────
//
// `electron/dev-tools/test-support/glbDocument.ts` does this for a committed
// FILE and is not reachable here: it takes a path and reads from disk, and this
// fixture never touches a disk.
//
// This reader is not a reimplementation of it, and no attempt is made to list
// where the two differ — such a list would be a claim about another module that
// nothing here keeps true. What it is for is feeding the assertions below.

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const COMPONENT_TYPE_UNSIGNED_SHORT = 5123;
const COMPONENT_TYPE_FLOAT = 5126;
const PRIMITIVE_MODE_TRIANGLES = 4;

interface GlbChunk {
    readonly type: number;
    /** The chunk's declared length — padding included. */
    readonly declaredLength: number;
    readonly body: Buffer;
}

interface GlbContainer {
    readonly version: number;
    readonly declaredTotalLength: number;
    readonly actualTotalLength: number;
    readonly magic: number;
    readonly chunks: readonly GlbChunk[];
}

/** Walk the container's header and chunk list, asserting nothing. */
function readGlbContainer(container: Uint8Array): GlbContainer {
    const bytes = Buffer.from(container.buffer, container.byteOffset, container.byteLength);
    const chunks: GlbChunk[] = [];
    let cursor = GLB_HEADER_BYTES;
    while (cursor + GLB_CHUNK_HEADER_BYTES <= bytes.length) {
        const declaredLength = bytes.readUInt32LE(cursor);
        const type = bytes.readUInt32LE(cursor + 4);
        const start = cursor + GLB_CHUNK_HEADER_BYTES;
        chunks.push({
            type,
            declaredLength,
            body: bytes.subarray(start, Math.min(start + declaredLength, bytes.length)),
        });
        cursor = start + declaredLength;
    }
    return {
        magic: bytes.readUInt32LE(0),
        version: bytes.readUInt32LE(4),
        declaredTotalLength: bytes.readUInt32LE(8),
        actualTotalLength: bytes.length,
        chunks,
    };
}

function chunkOfType(readContainer: GlbContainer, type: number): GlbChunk {
    const chunk = readContainer.chunks.find((candidate) => candidate.type === type);
    if (chunk === undefined) {
        throw new Error(`Container carries no chunk of type 0x${type.toString(16)}.`);
    }
    return chunk;
}

/** The glTF document, read out of the walked container rather than a fixed offset. */
function readDocument(container: Uint8Array): GltfJson {
    const json = chunkOfType(readGlbContainer(container), GLB_JSON_CHUNK_TYPE);
    return JSON.parse(json.body.toString('utf8')) as GltfJson;
}

interface GltfBufferView {
    readonly buffer: number;
    readonly byteOffset: number;
    readonly byteLength: number;
    readonly target?: number;
}
interface GltfAccessor {
    readonly bufferView: number;
    readonly componentType: number;
    readonly count: number;
    readonly type: string;
    readonly min?: readonly number[];
    readonly max?: readonly number[];
}
interface GltfPrimitive {
    readonly mode?: number;
    readonly attributes: Readonly<Record<string, number>>;
    readonly indices?: number;
}
interface GltfJson {
    readonly meshes: readonly { readonly primitives: readonly GltfPrimitive[] }[];
    readonly accessors: readonly GltfAccessor[];
    readonly bufferViews: readonly GltfBufferView[];
    readonly buffers: readonly { readonly byteLength: number }[];
    readonly materials: readonly Record<string, unknown>[];
    readonly extensionsUsed?: readonly string[];
    readonly [key: string]: unknown;
}

/** Decode one accessor's values out of the BIN chunk. */
function readAccessor(container: Uint8Array, accessorIndex: number): number[] {
    const document = readDocument(container);
    const bin = chunkOfType(readGlbContainer(container), GLB_BIN_CHUNK_TYPE).body;
    const accessor = document.accessors[accessorIndex];
    if (accessor === undefined) {
        throw new Error(`No accessor at index ${accessorIndex}.`);
    }
    const view = document.bufferViews[accessor.bufferView];
    if (view === undefined) {
        throw new Error(`Accessor ${accessorIndex} names no bufferView.`);
    }
    const lanes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type] ?? 0;
    const total = accessor.count * lanes;
    const values: number[] = [];
    for (let index = 0; index < total; index += 1) {
        values.push(
            accessor.componentType === COMPONENT_TYPE_FLOAT
                ? bin.readFloatLE(view.byteOffset + index * 4)
                : bin.readUInt16LE(view.byteOffset + index * 2),
        );
    }
    return values;
}

/** Component-wise extent of a flat run of `stride`-wide elements. */
function extentOf(values: readonly number[], stride: number): { min: number[]; max: number[] } {
    const min = [...values.slice(0, stride)];
    const max = [...values.slice(0, stride)];
    for (let index = stride; index < values.length; index += stride) {
        for (let lane = 0; lane < stride; lane += 1) {
            const value = values[index + lane] ?? 0;
            min[lane] = Math.min(min[lane] ?? 0, value);
            max[lane] = Math.max(max[lane] ?? 0, value);
        }
    }
    return { min, max };
}

/** The single mesh the fixture carries, or a failure naming what was found. */
function fixtureMesh(scene: Group): Mesh {
    const found: Mesh[] = [];
    scene.traverse((node) => {
        if ((node as Partial<Mesh>).isMesh === true) {
            found.push(node as Mesh);
        }
    });
    const [mesh] = found;
    if (mesh === undefined || found.length > 1) {
        throw new Error(`Fixture must carry exactly one Mesh, found ${found.length}.`);
    }
    return mesh;
}

/** The fixture's single material, asserted to be one rather than an array. */
function fixtureMaterial(scene: Group): MeshStandardMaterial | MeshBasicMaterial {
    const { material } = fixtureMesh(scene);
    if (Array.isArray(material)) {
        throw new Error('Fixture must carry a single material, not an array.');
    }
    return material as MeshStandardMaterial | MeshBasicMaterial;
}

/** The lit arm's material, narrowed to the class that carries a lighting response. */
function litMaterial(scene: Group): MeshStandardMaterial {
    const material = fixtureMaterial(scene);
    if (!(material instanceof MeshStandardMaterial)) {
        throw new Error(`The lit arm must load a MeshStandardMaterial, got ${material.type}.`);
    }
    return material;
}

describe('the lit gltf model fixture — container', () => {
    it('is a well-formed version-2 glTF container carrying exactly a JSON and a BIN chunk', () => {
        const container = readGlbContainer(buildGltfModelFixture('lit'));

        expect(container.magic).toBe(GLB_MAGIC);
        expect(container.version).toBe(2);
        // A truncated container otherwise parses with pieces missing.
        expect(container.declaredTotalLength).toBe(container.actualTotalLength);
        expect(container.chunks.map((chunk) => chunk.type)).toEqual([
            GLB_JSON_CHUNK_TYPE,
            GLB_BIN_CHUNK_TYPE,
        ]);
    });

    it('starts each chunk header 4-aligned, and pads each chunk to exactly the 4-byte formula', () => {
        const built = buildGltfModelFixture('lit');
        const container = readGlbContainer(built);

        // A chunk whose declared length is not a multiple of 4 leaves the
        // FOLLOWING chunk header unaligned, and the walk above only finds the BIN
        // chunk because the JSON chunk's length happens to land it there.
        let cursor = GLB_HEADER_BYTES;
        for (const chunk of container.chunks) {
            expect(cursor % 4, `chunk 0x${chunk.type.toString(16)} header offset`).toBe(0);
            expect(chunk.declaredLength % 4, `chunk 0x${chunk.type.toString(16)} length`).toBe(0);
            cursor += GLB_CHUNK_HEADER_BYTES + chunk.declaredLength;
        }

        // And the JSON chunk's padding is the FORMULA, asserted by equality
        // against its own unpadded length rather than by the alignment check
        // above. That check only catches a dropped pad while the body happens to
        // be unaligned; one more document key could make it 4-aligned, and the
        // padding logic would go unmeasured with nothing reddening.
        //
        // The unpadded length is re-derived by re-serialising the parsed document
        // rather than by stripping trailing pad bytes off the body. Stripping
        // would presume the very byte under test, which is what let a tab-padded
        // chunk satisfy this equality; re-serialising is independent of it. It is
        // a BYTE length, not a code-unit count — equal here only because the
        // document is ASCII, and `Buffer.byteLength` is what keeps that from
        // mattering.
        const json = chunkOfType(container, GLB_JSON_CHUNK_TYPE);
        const unpadded = Buffer.byteLength(JSON.stringify(readDocument(built)), 'utf8');
        expect(json.declaredLength).toBe(unpadded + ((4 - (unpadded % 4)) % 4));
        // GLB 2.0 pads the JSON chunk with spaces. No reader in this repo cares —
        // `JSON.parse` tolerates a tab too — so this assertion is the only thing
        // that holds the pad byte to the one the format names.
        expect([...json.body.subarray(unpadded)]).toEqual(
            Array.from({ length: json.declaredLength - unpadded }, () => 0x20),
        );
    });

    it('declares a buffer length equal to its payload, and a BIN chunk exceeding it only by padding', () => {
        const built = buildGltfModelFixture('lit');
        const bin = chunkOfType(readGlbContainer(built), GLB_BIN_CHUNK_TYPE);
        const document = readDocument(built);
        const declared = document.buffers[0]?.byteLength ?? 0;
        // Independent of the field under test: the payload's size is where the
        // last bufferView ends, which is derived from the views rather than from
        // `buffers[0]`.
        const payloadExtent = Math.max(
            ...document.bufferViews.map((view) => view.byteOffset + view.byteLength),
        );

        // EQUALITY, not a range. A range that admits three bytes of slack cannot
        // pin the field at all while the fixture's payload happens to be
        // 4-aligned: `byteLength` could be declared 1, 2 or 3 bytes SHORT of the
        // buffer and sit inside the range, leaving a document whose last
        // bufferView ends past the buffer it names.
        expect(declared).toBe(payloadExtent);
        // And the chunk carries the payload plus EXACTLY what alignment needs —
        // an equality rather than a `0 <= slack <= 3` range, because this
        // payload is 4-aligned so the slack is always 0: a range would sit on its
        // own lower bound and pin neither end. This is what notices the outer
        // `% 4` being dropped from the padding, which pads an already-aligned
        // body by a whole four bytes and satisfies every alignment assertion
        // above. `GLTFLoader` does not compare the chunk to
        // `buffers[0].byteLength` (measured against three 0.184.0), so the bound
        // is stated here rather than inherited.
        expect(bin.declaredLength).toBe(declared + ((4 - (declared % 4)) % 4));
    });

    it('places every bufferView 4-aligned inside the BIN chunk, each declaring its binding target', () => {
        const built = buildGltfModelFixture('lit');
        const document = readDocument(built);
        const binLength = chunkOfType(readGlbContainer(built), GLB_BIN_CHUNK_TYPE).body.length;

        expect(document.bufferViews).toHaveLength(3);
        for (const view of document.bufferViews) {
            expect(view.byteOffset % 4, JSON.stringify(view)).toBe(0);
            expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(binLength);
        }
        // The two vertex views bind as array buffers and the index view as an
        // element array. `GLTFLoader` never reads `target`, so nothing else in
        // the repo would notice the index view declaring the wrong one — which is
        // the reason to assert it rather than leave two emitted constants
        // unmeasured.
        expect(document.bufferViews.map((view) => view.target)).toEqual([
            TARGET_ARRAY_BUFFER,
            TARGET_ARRAY_BUFFER,
            TARGET_ELEMENT_ARRAY_BUFFER,
        ]);
    });
});

describe('the lit gltf model fixture — binary payload', () => {
    it('decodes the authored quad positions back out of the BIN chunk', () => {
        // Presence of a POSITION view proves nothing: a wrong byteOffset reads
        // whatever is at it and still decodes to four VEC3s.
        expect(readAccessor(buildGltfModelFixture('lit'), 0)).toEqual([
            0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0,
        ]);
    });

    it('decodes four UNIT +Z normals, not merely a normal attribute that exists', () => {
        // Four zero vectors are an attribute that EXISTS while carrying no
        // direction, so a presence check passes them. Nothing here renders, so
        // what the shader would do with them is not this file's claim to make —
        // the authored direction is.
        expect(readAccessor(buildGltfModelFixture('lit'), 1)).toEqual([
            0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
        ]);
    });

    it('decodes the six authored index values, as unsigned shorts, from the index view', () => {
        // Catches both an index view pointed at the normal bytes (float bytes
        // read as UNSIGNED_SHORT) and a one-byte write stride, neither of which
        // any alignment or presence assertion can see. Six VALUES is all this
        // measures — what makes them two triangles is the primitive mode, pinned
        // separately below.
        expect(readAccessor(buildGltfModelFixture('lit'), 2)).toEqual([0, 1, 2, 0, 2, 3]);
        expect(readDocument(buildGltfModelFixture('lit')).accessors[2]?.componentType).toBe(
            COMPONENT_TYPE_UNSIGNED_SHORT,
        );
    });

    it('declares the TRIANGLES primitive mode, which is what makes those six indices two triangles', () => {
        const document = readDocument(buildGltfModelFixture('lit'));

        // The mode decides what the index values MEAN, and no other assertion
        // reads it. Under `TRIANGLE_STRIP` the loader expands these same six
        // indices into FOUR triangles, of which only ONE still faces +Z — so the
        // quad silently loses front-facing coverage while every index, bounds and
        // alignment assertion passes. The test below is the pin on the expansion.
        expect(document.meshes[0]?.primitives[0]?.mode).toBe(PRIMITIVE_MODE_TRIANGLES);
    });

    it('loads a geometry whose index buffer is the six authored values, not an expanded strip', async () => {
        // The consumer-side half of the mode pin: a non-TRIANGLES mode reaches
        // three's `toTrianglesDrawMode`, which rewrites the index buffer. Reading
        // it back off the loaded geometry is what makes the expansion visible
        // rather than inferred from the document.
        const asset = await loadGltfModelFixture('lit');

        const index = fixtureMesh(asset.scene).geometry.getIndex();
        expect(index?.count).toBe(6);
        expect(Array.from(index?.array ?? [])).toEqual([0, 1, 2, 0, 2, 3]);
    });

    it('declares POSITION bounds that match the data they claim to bound', () => {
        const built = buildGltfModelFixture('lit');
        const accessor = readDocument(built).accessors[0];
        const decoded = extentOf(readAccessor(built, 0), 3);

        // Three derives the geometry's bounding volume from these, so bounds
        // that disagree with the data cull the quad out of frame while every
        // other assertion stays green.
        expect(accessor?.min).toEqual(decoded.min);
        expect(accessor?.max).toEqual(decoded.max);
        // And they are not equal to each other, which a min/max swap would also
        // satisfy on a symmetric quad if the extents happened to match.
        expect(accessor?.min).not.toEqual(accessor?.max);
        expect(accessor?.min?.[0]).toBeLessThan(accessor?.max?.[0] ?? 0);
        expect(accessor?.min?.[1]).toBeLessThan(accessor?.max?.[1] ?? 0);
    });
});

describe('the lit gltf model fixture — loaded material', () => {
    it('loads as a MeshStandardMaterial — the class that carries a lighting response', async () => {
        const asset = await loadGltfModelFixture('lit');

        const material = fixtureMaterial(asset.scene);
        expect(material).toBeInstanceOf(MeshStandardMaterial);
        // Named as well as classed: `MeshPhysicalMaterial` EXTENDS
        // `MeshStandardMaterial`, so the instanceof above admits it, and a
        // container that acquired a `KHR_materials_*` extension would load as
        // the subclass while this assertion still passed.
        expect(material.type).toBe('MeshStandardMaterial');
    });

    it('loads smooth-shaded, so the override sees the material the fixture claims', async () => {
        const asset = await loadGltfModelFixture('lit');

        // `GLTFLoader` answers an absent NORMAL attribute by handing back a
        // CLONE with `flatShading` set, so dropping the attribute changes which
        // material the override is given. This is the loader-side consequence of
        // the authored normals.
        expect(litMaterial(asset.scene).flatShading).toBe(false);
    });

    it('carries a WHITE base colour, so a tint multiplies visibly rather than into itself', async () => {
        const asset = await loadGltfModelFixture('lit');

        // The showcase rigs are magenta. Multiplying a green tint into magenta
        // yields black, so a fixture that inherited their base colour would make
        // a correct tint indistinguishable from an unapplied one for whole
        // classes of tint value. White is the only base that carries every tint
        // through unchanged.
        expect(fixtureMaterial(asset.scene).color.getHexString()).toBe('ffffff');
    });

    it('carries a BLACK emissive at unit intensity, so an emissive override is observable', async () => {
        const asset = await loadGltfModelFixture('lit');

        const material = litMaterial(asset.scene);
        // An emissive already lit cannot be shown to have been set. Black is
        // three's own default and the glTF default alike, and authoring no
        // `emissiveFactor` is what keeps it there. The intensity is named in the
        // test title because it is the other half of whether an emissive shows:
        // black at intensity 0 would be unobservable for a different reason.
        expect(material.emissive.getHexString()).toBe('000000');
        expect(material.emissiveIntensity).toBe(1);
    });

    it('loads at mid roughness and zero metalness, not the metallic surface a bare glTF defaults to', async () => {
        const asset = await loadGltfModelFixture('lit');

        // glTF defaults `metallicFactor` and `roughnessFactor` to 1
        // (`GLTFLoader.js:3586-3587`). A fully metallic surface takes almost all
        // of its colour from the environment, and with no env map that is close
        // to black — so these two are what keep the base colour reaching the
        // frame at all.
        const material = litMaterial(asset.scene);
        expect(material.metalness).toBe(0);
        expect(material.roughness).toBe(0.5);
    });
});

describe('the lit gltf model fixture — scene shape', () => {
    it('is one named mesh under a Group with one material, and no animation, skin, camera, morph target or extension', async () => {
        const asset = await loadGltfModelFixture('lit');
        const document = readDocument(buildGltfModelFixture('lit'));

        expect(asset.animations).toEqual([]);
        expect(asset.scene).toBeInstanceOf(Group);
        expect(fixtureMesh(asset.scene).name).toBe(GLTF_MODEL_FIXTURE_MESH_NAME);
        expect(fixtureMesh(asset.scene).morphTargetInfluences).toBeUndefined();
        // Named individually rather than as "nothing else": each is a container
        // feature that would change what an override has to cope with. glTF
        // lights are extension-only, so the `extensions` entry is what covers
        // them — they are not separately absent.
        for (const absent of ['animations', 'skins', 'cameras', 'extensions']) {
            expect(document[absent], absent).toBeUndefined();
        }
        expect(document.materials).toHaveLength(1);
    });

    it('survives cloneModelInstance, the consumer path an override runs on', async () => {
        const asset = await loadGltfModelFixture('lit');

        // `cloneModelInstance` refuses four container shapes outright. A fixture
        // that tripped any of them would be unusable by the override it exists
        // for, and this file is where that is cheapest to find out.
        const instance = cloneModelInstance(asset);

        expect(instance.root).not.toBe(asset.scene);
        expect(fixtureMesh(instance.root as Group).name).toBe(GLTF_MODEL_FIXTURE_MESH_NAME);
        // Still SHARED at this point: the override is what changes that, and
        // this pins the pre-override baseline it changes from.
        expect(fixtureMesh(instance.root as Group).material).toBe(fixtureMaterial(asset.scene));
    });
});

describe('the unlit control arm', () => {
    it('loads as a MeshBasicMaterial, which carries no emissive field at all', async () => {
        const asset = await loadGltfModelFixture('unlit');

        const material = fixtureMaterial(asset.scene);
        expect(material).toBeInstanceOf(MeshBasicMaterial);
        // This is the whole reason the lit fixture exists: `emissive` is not a
        // field of this class, so an emissive override against an unlit model
        // writes a property three never reads — a silent no-op, and a test that
        // asserted the write would pass.
        expect((material as { readonly emissive?: unknown }).emissive).toBeUndefined();
    });

    it('carries a BIN chunk byte-identical to the lit arm, so the control varies no geometry', () => {
        const lit = chunkOfType(readGlbContainer(buildGltfModelFixture('lit')), GLB_BIN_CHUNK_TYPE);
        const unlit = chunkOfType(
            readGlbContainer(buildGltfModelFixture('unlit')),
            GLB_BIN_CHUNK_TYPE,
        );

        // Comparing the parsed DOCUMENTS is not enough and this is the gap it
        // leaves: the whole binary payload — positions, normals, indices — lives
        // outside the JSON chunk, so an `unlit` arm emitting a zeroed or
        // degenerate buffer satisfies every document-level comparison. The
        // control's value is that shading is the ONLY difference; a second
        // difference in geometry would mean a tint failing against it proves
        // nothing about shading.
        expect(unlit.body.equals(lit.body)).toBe(true);
        expect(unlit.declaredLength).toBe(lit.declaredLength);
    });

    it('differs from the lit arm in the JSON document ONLY by the unlit extension, material included', () => {
        const lit = readDocument(buildGltfModelFixture('lit'));
        const unlit = readDocument(buildGltfModelFixture('unlit'));

        // The MATERIAL is the axis this control's claim lives on, so dropping
        // the whole `materials` array before comparing would leave the control
        // free to differ in base colour, roughness or emissive as well — and a
        // pair differing in two variables at once measures neither. Only the
        // `extensions` key is removed.
        expect(unlit.materials.map(withoutExtensions)).toEqual(
            lit.materials.map(withoutExtensions),
        );
        expect(withoutMaterials(unlit)).toEqual(withoutMaterials(lit));

        // And the difference IS the extension, rather than the two arms being
        // identical — which would make the control vacuous.
        expect(lit.extensionsUsed).toBeUndefined();
        expect(unlit.extensionsUsed).toEqual(['KHR_materials_unlit']);
        expect(lit.materials[0]?.['extensions']).toBeUndefined();
        expect(unlit.materials[0]?.['extensions']).toEqual({ KHR_materials_unlit: {} });
    });
});

/** One material with its `extensions` key dropped. */
function withoutExtensions(material: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...material };
    delete copy['extensions'];
    return copy;
}

/** The document with the two shading-carrying top-level fields dropped. */
function withoutMaterials(document: GltfJson): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...document };
    delete copy['materials'];
    delete copy['extensionsUsed'];
    return copy;
}
