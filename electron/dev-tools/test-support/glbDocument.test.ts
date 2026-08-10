import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MalformedAssetFileError } from './MalformedAssetFileError.js';
import { readGlbDocument } from './glbDocument.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'chimera-glb-document-'));

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
const BIN_CHUNK_TYPE = 0x004e4942; // 'BIN\0'

/** A glTF chunk: length + type header, body padded to a 4-byte boundary. */
function glbChunk(type: number, body: Buffer, padWith: number): Buffer {
    const padding = (4 - (body.length % 4)) % 4;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(body.length + padding, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, body, Buffer.alloc(padding, padWith)]);
}

interface GlbOptions {
    readonly json?: unknown;
    readonly bin?: Buffer;
    readonly magic?: number;
    readonly version?: number;
    /** Overrides the declared total length without changing the bytes present. */
    readonly declaredLength?: number;
    readonly jsonChunkType?: number;
    /** Chunk text written verbatim — for bodies `JSON.stringify` cannot produce. */
    readonly rawJson?: string;
    /**
     * Overrides the JSON chunk's declared length INDEPENDENTLY of the container's,
     * so the chunk can outrun the file while the total still matches.
     */
    readonly jsonChunkLength?: number;
}

/** Writes arbitrary bytes — for the containers a structured builder cannot express. */
function writeRaw(name: string, bytes: Buffer): string {
    const filePath = path.join(scratch, name);
    writeFileSync(filePath, bytes);
    return filePath;
}

function writeGlb(name: string, options: GlbOptions = {}): string {
    const {
        json = { asset: { version: '2.0' } },
        bin,
        magic = GLB_MAGIC,
        version = 2,
        declaredLength,
        jsonChunkType = JSON_CHUNK_TYPE,
        rawJson,
        jsonChunkLength,
    } = options;

    // The JSON chunk pads with spaces and the BIN chunk with NULs, per the spec.
    const jsonText = rawJson ?? JSON.stringify(json);
    const jsonChunk = glbChunk(jsonChunkType, Buffer.from(jsonText, 'utf8'), 0x20);
    if (jsonChunkLength !== undefined) jsonChunk.writeUInt32LE(jsonChunkLength, 0);
    const binChunk = bin === undefined ? Buffer.alloc(0) : glbChunk(BIN_CHUNK_TYPE, bin, 0x00);

    const header = Buffer.alloc(12);
    header.writeUInt32LE(magic, 0);
    header.writeUInt32LE(version, 4);
    header.writeUInt32LE(declaredLength ?? 12 + jsonChunk.length + binChunk.length, 8);

    const filePath = path.join(scratch, name);
    writeFileSync(filePath, Buffer.concat([header, jsonChunk, binChunk]));
    return filePath;
}

describe('readGlbDocument', () => {
    it('parses the JSON chunk out of a binary glTF container', () => {
        const filePath = writeGlb('minimal.glb', {
            json: { asset: { version: '2.0', generator: 'chimera-test' } },
        });

        const document = readGlbDocument(filePath);

        expect(document.asset.version).toBe('2.0');
        expect(document.asset.generator).toBe('chimera-test');
    });

    it('stops at the declared JSON length rather than reading into the BIN chunk', () => {
        // Reading to end-of-file would append the binary payload to the JSON text
        // and every parse would throw where the real defect is a length mismatch.
        const filePath = writeGlb('with-bin.glb', {
            json: { asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] },
            bin: Buffer.from([1, 2, 3, 4]),
        });

        const document = readGlbDocument(filePath);

        expect(document.buffers?.[0]?.byteLength).toBe(4);
    });

    it('tolerates the space padding the spec requires on the JSON chunk', () => {
        // A 1-byte-short JSON body is padded to the 4-byte boundary with 0x20.
        // `JSON.parse` accepts trailing spaces; it does not accept trailing NULs.
        const filePath = writeGlb('padded.glb', { json: { asset: { version: '2.0' }, a: 1 } });

        expect(readGlbDocument(filePath).asset.version).toBe('2.0');
    });

    it('surfaces the structures a model assertion reads', () => {
        const filePath = writeGlb('rig.glb', {
            json: {
                asset: { version: '2.0' },
                extensionsUsed: ['KHR_materials_unlit'],
                nodes: [{ name: 'root', children: [1] }, { name: 'top' }],
                meshes: [{ name: 'quad', primitives: [{ attributes: { POSITION: 0 } }] }],
                accessors: [
                    {
                        count: 4,
                        type: 'VEC3',
                        componentType: 5126,
                        min: [-0.45, 0, 0],
                        max: [0.45, 1.4, 0],
                    },
                ],
                buffers: [{ byteLength: 4 }],
            },
            bin: Buffer.from([0, 0, 0, 0]),
        });

        const document = readGlbDocument(filePath);

        expect(document.extensionsUsed).toContain('KHR_materials_unlit');
        expect(document.nodes?.map((node) => node.name)).toEqual(['root', 'top']);
        expect(document.meshes?.[0]?.primitives[0]?.attributes['POSITION']).toBe(0);
        expect(document.accessors?.[0]?.max).toEqual([0.45, 1.4, 0]);
        expect(document.buffers?.[0]?.uri).toBeUndefined();
    });

    it('round-trips an animation with its channels and samplers', () => {
        // The animation half of the surface. Reading it is what lets a game
        // assert its clip sheet against the clip the container actually holds:
        // the clip's NAME (the key `useClipPlayer` plays), the node a channel
        // drives, and the sampler input whose accessor `max` is the clip's
        // length. None of the three is knowable without opening the file.
        const filePath = writeGlb('animated.glb', {
            json: {
                asset: { version: '2.0' },
                nodes: [{ name: 'root' }, { name: 'top' }],
                animations: [
                    {
                        name: 'wave',
                        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
                        samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
                    },
                ],
                accessors: [
                    { count: 2, type: 'SCALAR', componentType: 5126, min: [0], max: [1] },
                    { count: 2, type: 'VEC4', componentType: 5126 },
                ],
            },
        });

        const document = readGlbDocument(filePath);
        const animation = document.animations?.[0];

        expect(animation?.name).toBe('wave');
        expect(animation?.channels).toEqual([
            { sampler: 0, target: { node: 1, path: 'rotation' } },
        ]);
        expect(animation?.samplers).toEqual([{ input: 0, output: 1, interpolation: 'LINEAR' }]);
        // The length read, spelled out: sampler input → accessor → max[0].
        const input = animation?.samplers?.[0]?.input;
        expect(document.accessors?.[input ?? -1]?.max?.[0]).toBe(1);
    });

    it('reads an animation with no samplers as undefined rather than throwing', () => {
        // Every field on the animation types is OPTIONAL because the reader
        // casts unvalidated JSON. A caller that maps over `samplers` on a
        // malformed animation therefore gets `undefined` to handle, not a
        // TypeError from inside the reader — which would name no file.
        const filePath = writeGlb('animation-no-samplers.glb', {
            json: {
                asset: { version: '2.0' },
                animations: [{ name: 'empty' }],
            },
        });

        const animation = readGlbDocument(filePath).animations?.[0];

        expect(animation?.name).toBe('empty');
        expect(animation?.samplers).toBeUndefined();
        expect(animation?.channels).toBeUndefined();
        expect(() => animation?.samplers?.map((sampler) => sampler.input)).not.toThrow();
    });

    it('rejects a file whose glTF magic is wrong', () => {
        const filePath = writeGlb('not-glb.glb', { magic: 0x12345678 });

        expect(() => readGlbDocument(filePath)).toThrow(MalformedAssetFileError);
    });

    it('rejects a container version it cannot read', () => {
        const filePath = writeGlb('v1.glb', { version: 1 });

        expect(() => readGlbDocument(filePath)).toThrow(/version/u);
    });

    it('rejects a truncated container', () => {
        // The declared total length is the only in-band signal that the tail
        // survived the copy; a short file otherwise parses fine and loads wrong.
        const filePath = writeGlb('truncated.glb', { declaredLength: 9999 });

        expect(() => readGlbDocument(filePath)).toThrow(MalformedAssetFileError);
    });

    it('rejects a container whose first chunk is not JSON', () => {
        const filePath = writeGlb('bin-first.glb', { jsonChunkType: BIN_CHUNK_TYPE });

        expect(() => readGlbDocument(filePath)).toThrow(/JSON/u);
    });

    it('names the file it rejected', () => {
        const filePath = writeGlb('named.glb', { magic: 0 });

        expect(() => readGlbDocument(filePath)).toThrow(
            expect.objectContaining({ name: 'MalformedAssetFileError', filePath }),
        );
    });

    it('rejects a file too short to hold a header and one chunk', () => {
        const filePath = writeRaw('stub.glb', Buffer.alloc(16));

        expect(() => readGlbDocument(filePath)).toThrow(/shorter than a glTF header/u);
    });

    it('rejects a JSON chunk that outruns the file', () => {
        // The chunk's own declared length, not the container's — the total still
        // matches, so only the per-chunk bound catches it. Left unchecked,
        // `toString` silently clamps and the JSON parses SHORT, losing the tail.
        const filePath = writeGlb('long-json-chunk.glb', { jsonChunkLength: 4096 });

        expect(() => readGlbDocument(filePath)).toThrow(/JSON chunk declares 4096 bytes/u);
    });

    it('reports invalid JSON as a malformed asset, not a raw SyntaxError', () => {
        const filePath = writeGlb('bad-json.glb', { rawJson: '{"asset":' });

        expect(() => readGlbDocument(filePath)).toThrow(
            expect.objectContaining({ name: 'MalformedAssetFileError', filePath }),
        );
    });

    it.each([
        { name: 'null', rawJson: 'null' },
        { name: 'array', rawJson: '[]' },
        { name: 'number', rawJson: '5' },
        { name: 'no-asset', rawJson: '{"nodes":[]}' },
        { name: 'no-version', rawJson: '{"asset":{}}' },
        // The rows above all make `asset?.version` UNDEFINED, so a presence-only
        // check (`=== undefined`) rejects every one of them and the `typeof …
        // !== 'string'` half goes unexercised. These three are present and the
        // wrong type — the shape a consumer then compares against `'2.0'`.
        { name: 'number-version', rawJson: '{"asset":{"version":2}}' },
        { name: 'null-version', rawJson: '{"asset":{"version":null}}' },
        { name: 'array-version', rawJson: '{"asset":{"version":["2.0"]}}' },
    ])('rejects a JSON chunk whose document shape is $name', ({ name, rawJson }) => {
        // All valid JSON. Without the shape check the cast succeeds and the
        // caller's first `.asset.version` read throws a TypeError naming no file
        // — or, worse, silently compares a number to a string, which is what the
        // scaffolded template's manifest test does.
        const filePath = writeGlb(`shape-${name}.glb`, { rawJson });

        expect(() => readGlbDocument(filePath)).toThrow(/not a glTF document/u);
    });
});
