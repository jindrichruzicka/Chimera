/**
 * renderer/assets/__test-support__/glbContainer.test.ts
 *
 * The binary glTF writer `glbContainer.ts`, pinned directly.
 *
 * Both of its callers hold it only through what they build:
 * `__tests__/gltf-model-fixture.test.ts` reads the fixture's container back, and
 * `tools/gen-showcase-animated-glb.test.ts` compares the committed rig byte for
 * byte. Neither can reach an arm its own data never takes — both hand over a BIN
 * payload that is already 4-aligned, so the BIN chunk's pad byte is written by
 * neither. The cases here choose their inputs to take those arms.
 */

import { describe, expect, it } from 'vitest';

import { asFloat32, boundsOf, packGlb } from './glbContainer.js';

const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/** The container's header and its two chunks, read as the glTF 2.0 spec lays them out. */
function readContainer(container: Uint8Array): {
    readonly magic: number;
    readonly version: number;
    readonly declaredLength: number;
    readonly chunks: readonly { readonly type: number; readonly body: Buffer }[];
} {
    const bytes = Buffer.from(container.buffer, container.byteOffset, container.byteLength);
    const chunks: { type: number; body: Buffer }[] = [];
    let offset = GLB_HEADER_BYTES;
    while (offset < bytes.length) {
        const length = bytes.readUInt32LE(offset);
        const type = bytes.readUInt32LE(offset + 4);
        const start = offset + CHUNK_HEADER_BYTES;
        chunks.push({ type, body: bytes.subarray(start, start + length) });
        offset = start + length;
    }
    return {
        magic: bytes.readUInt32LE(0),
        version: bytes.readUInt32LE(4),
        declaredLength: bytes.readUInt32LE(8),
        chunks,
    };
}

describe('packGlb', () => {
    it('writes the glTF magic, version 2 and the whole container length into the header', () => {
        const container = packGlb('{}', Buffer.from([1, 2, 3, 4]));
        const read = readContainer(container);

        expect(read.magic).toBe(0x46546c67);
        expect(read.version).toBe(2);
        expect(read.declaredLength).toBe(container.byteLength);
    });

    it('emits the JSON chunk then the BIN chunk, each under its own type', () => {
        const read = readContainer(packGlb('{}', Buffer.from([1, 2, 3, 4])));

        expect(read.chunks.map((chunk) => chunk.type)).toEqual([0x4e4f534a, 0x004e4942]);
    });

    it('pads an unaligned JSON body to 4 with spaces', () => {
        // `{"a":1}` is 7 bytes, so exactly one pad byte follows it.
        const read = readContainer(packGlb('{"a":1}', Buffer.alloc(4)));
        const json = read.chunks[0]!.body;

        expect(json.length).toBe(8);
        expect(json.toString('utf8')).toBe('{"a":1} ');
        expect(JSON.parse(json.toString('utf8'))).toEqual({ a: 1 });
    });

    it('pads an unaligned BIN body to 4 with NULs', () => {
        // The arm neither caller reaches: a 5-byte payload takes three pad bytes.
        const read = readContainer(packGlb('{}  ', Buffer.from([9, 9, 9, 9, 9])));
        const bin = read.chunks[1]!.body;

        expect([...bin]).toEqual([9, 9, 9, 9, 9, 0, 0, 0]);
    });

    it('adds no padding to a body that is already 4-aligned', () => {
        const read = readContainer(packGlb('{}  ', Buffer.from([1, 2, 3, 4])));

        expect(read.chunks[0]!.body.length).toBe(4);
        expect([...read.chunks[1]!.body]).toEqual([1, 2, 3, 4]);
    });
});

describe('boundsOf', () => {
    it('finds each lane’s min and max wherever in the run they sit', () => {
        // Neither extreme of either lane is on the first element, so a helper that
        // only ever kept its seed fails both directions.
        const bounds = boundsOf([0, 0, -1, 5, 2, -3], 2);

        expect(bounds.min).toEqual([-1, -3]);
        expect(bounds.max).toEqual([2, 5]);
    });

    it('keeps an extreme that sits only on the first element', () => {
        // The seed arm. Lane 0 peaks and lane 1 bottoms out on the first element,
        // so a helper that seeded from 0 rather than from the first element fails
        // both lanes in both directions.
        const bounds = boundsOf([5, -5, 3, -1], 2);

        expect(bounds.min).toEqual([3, -5]);
        expect(bounds.max).toEqual([5, -1]);
    });
});

describe('asFloat32', () => {
    it('rounds each value to the float32 the buffer will hold', () => {
        expect(asFloat32([0.3, 0.5])).toEqual([Math.fround(0.3), 0.5]);
        expect(asFloat32([0.3])[0]).not.toBe(0.3);
    });
});
