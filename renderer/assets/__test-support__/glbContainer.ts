/**
 * renderer/assets/__test-support__/glbContainer.ts
 *
 * The binary glTF writer two GLB builders share: the in-memory
 * `gltfModelFixture.ts` beside this file, and `tools/gen-showcase-animated-glb.ts`,
 * which emits the committed animated showcase rig.
 *
 * `electron/dev-tools/test-support/glbDocument.test.ts` keeps a writer of its
 * own on purpose: its container header and JSON chunk can be overridden field by
 * field, to build the malformed containers the GLB reader there is tested against.
 *
 * **Why it lives here.** `renderer/` is a published package and must not import
 * repo tooling, so the module cannot sit under `tools/`. The edge the other way
 * already exists — `tools/shell-page-routes.ts` imports renderer source — and
 * `__test-support__/` is excluded from the renderer build
 * (`renderer/tsconfig.build.json`), so nothing here reaches the package.
 *
 * **What holds it.** `glbContainer.test.ts` beside it pins it directly, on
 * inputs that take arms neither caller's data reaches. Beyond that, every byte
 * it writes into the showcase rig is held by the generator's byte-equality gate
 * (`tools/gen-showcase-animated-glb.test.ts`), and the fixture's container by
 * `__tests__/gltf-model-fixture.test.ts`.
 */

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
const GLB_BIN_CHUNK_TYPE = 0x004e4942; // 'BIN\0'
const GLB_CONTAINER_VERSION = 2;

export const COMPONENT_TYPE_UNSIGNED_SHORT = 5123;
export const COMPONENT_TYPE_FLOAT = 5126;
export const TARGET_ARRAY_BUFFER = 34962;
export const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
export const PRIMITIVE_MODE_TRIANGLES = 4;

export function packFloats(values: readonly number[]): Buffer {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    return bytes;
}

export function packUnsignedShorts(values: readonly number[]): Buffer {
    const bytes = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
    return bytes;
}

/**
 * Component-wise min/max of a flat run of `stride`-wide elements.
 *
 * Computed from the packed values rather than authored beside them: an accessor
 * whose declared bounds disagree with its data is a defect a loader silently
 * culls geometry over, and a hand-written bound is exactly how that happens.
 */
export function boundsOf(
    values: readonly number[],
    stride: number,
): {
    readonly min: readonly number[];
    readonly max: readonly number[];
} {
    const min = values.slice(0, stride);
    const max = values.slice(0, stride);
    for (let index = stride; index < values.length; index += stride) {
        for (let lane = 0; lane < stride; lane += 1) {
            const value = values[index + lane] ?? 0;
            if (value < (min[lane] ?? 0)) min[lane] = value;
            if (value > (max[lane] ?? 0)) max[lane] = value;
        }
    }
    return { min, max };
}

/**
 * Round every element to the float32 value the buffer will actually hold.
 *
 * An accessor's declared min/max must bound the STORED data, not the authored
 * doubles: `0.3` stored as float32 reads back as `0.30000001192092896`, so a
 * `max` of `0.3` would be below the value it is meant to bound — which is what
 * makes a strict glTF validator reject the container.
 */
export function asFloat32(values: readonly number[]): number[] {
    return Array.from(new Float32Array(values));
}

/**
 * Assemble the container: a 12-byte header, the JSON chunk padded with spaces
 * (which `JSON.parse` tolerates), then the BIN chunk padded with NULs.
 */
export function packGlb(jsonText: string, bin: Buffer): Uint8Array {
    const jsonChunk = glbChunk(GLB_JSON_CHUNK_TYPE, Buffer.from(jsonText, 'utf8'), 0x20);
    const binChunk = glbChunk(GLB_BIN_CHUNK_TYPE, bin, 0x00);

    const header = Buffer.alloc(12);
    header.writeUInt32LE(GLB_MAGIC, 0);
    header.writeUInt32LE(GLB_CONTAINER_VERSION, 4);
    header.writeUInt32LE(header.length + jsonChunk.length + binChunk.length, 8);

    return new Uint8Array(Buffer.concat([header, jsonChunk, binChunk]));
}

/**
 * One glTF chunk, padded so the NEXT chunk header starts 4-aligned.
 *
 * The outer `% 4` is what keeps an already-aligned body unpadded; without it an
 * aligned body gains four bytes, and the BIN chunk then declares four bytes more
 * than the `buffers[0].byteLength` it carries.
 */
function glbChunk(type: number, body: Buffer, padWith: number): Buffer {
    const padding = (4 - (body.length % 4)) % 4;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(body.length + padding, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, body, Buffer.alloc(padding, padWith)]);
}
