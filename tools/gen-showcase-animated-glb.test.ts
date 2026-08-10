// tools/gen-showcase-animated-glb.test.ts
//
// Unit tests for the animated showcase-rig generator and its drift gate.
//
// Two properties, and the second is why the generator exists at all:
//
//   1. the builder emits a well-formed, self-contained, animated glTF container
//      — asserted by parsing what it produced, never by re-reading the literals
//      that produced it;
//   2. the COMMITTED `.glb` equals the builder's output byte for byte. A binary
//      is opaque to review: without this, a hand-edited or re-exported model is
//      indistinguishable from the generated one, and the comment claiming it is
//      reproducible is the only thing saying otherwise.
//
// The generator is deterministic on purpose, and that costs something visible in
// its source: every quaternion component is an authored decimal literal rather
// than a `Math.sin` call, because ECMAScript leaves `Math.sin` implementation-
// defined and a last-bit difference between two Node builds would turn the
// byte-equality gate above into a machine-dependent failure.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readGlbDocument } from '../electron/dev-tools/test-support/glbDocument.js';
import {
    BufferPacker,
    SHOWCASE_ANIMATED_CLIP_NAME,
    SHOWCASE_ANIMATED_DURATION_SECONDS,
    SHOWCASE_ANIMATED_GLB_REL_PATH,
    SHOWCASE_ANIMATED_KEY_SECONDS,
    SHOWCASE_POSED_BONE_NAME,
    buildShowcaseAnimatedGlb,
    checkGlbDrift,
} from './gen-showcase-animated-glb.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const committedPath = path.join(repoRoot, SHOWCASE_ANIMATED_GLB_REL_PATH);

const scratch = mkdtempSync(path.join(tmpdir(), 'chimera-showcase-glb-'));

/**
 * Parse the given bytes through the same reader a game's own test uses.
 *
 * Round-tripping through a file rather than asserting on the builder's
 * intermediate JSON is the point: what a consumer sees is the container, and a
 * builder that emitted a correct JSON object into a malformed container would
 * satisfy any assertion made before the write.
 */
function documentOf(bytes: Uint8Array, name: string): ReturnType<typeof readGlbDocument> {
    const filePath = path.join(scratch, name);
    writeFileSync(filePath, bytes);
    return readGlbDocument(filePath);
}

describe('buildShowcaseAnimatedGlb', () => {
    const bytes = buildShowcaseAnimatedGlb();
    const doc = documentOf(bytes, 'built.glb');

    it('emits one animation, named as the sheet names it', () => {
        expect(doc.animations?.map((animation) => animation.name)).toEqual([
            SHOWCASE_ANIMATED_CLIP_NAME,
        ]);
    });

    it('drives the posed bone rotation, so the clip is visible on the bone the screen reads', () => {
        const topIndex = doc.nodes?.findIndex((node) => node.name === SHOWCASE_POSED_BONE_NAME);
        expect(topIndex).toBeGreaterThanOrEqual(0);

        const channels = doc.animations?.[0]?.channels ?? [];
        expect(channels).toHaveLength(1);
        expect(channels[0]?.target).toEqual({ node: topIndex, path: 'rotation' });
    });

    it("carries the clip's authored length as the sampler input's max", () => {
        // The one number the manifest sheet has to agree with, and the reason
        // the reader was widened: it is only knowable by parsing the container.
        const animation = doc.animations?.[0];
        const durations = (animation?.samplers ?? []).map((sampler) => {
            const input = sampler.input === undefined ? undefined : doc.accessors?.[sampler.input];
            return input?.max?.[0];
        });

        expect(durations).toEqual([SHOWCASE_ANIMATED_DURATION_SECONDS]);
    });

    it('keys the sampler on the authored times, with a matching rotation per key', () => {
        const animation = doc.animations?.[0];
        const sampler = animation?.samplers?.[0];
        expect(sampler?.interpolation).toBe('LINEAR');

        const input = sampler?.input === undefined ? undefined : doc.accessors?.[sampler.input];
        const output = sampler?.output === undefined ? undefined : doc.accessors?.[sampler.output];

        expect(input?.count).toBe(SHOWCASE_ANIMATED_KEY_SECONDS.length);
        expect(input?.type).toBe('SCALAR');
        expect(input?.min).toEqual([0]);
        // A rotation channel is quaternions, one per key — a count mismatch is
        // the shape glTF readers accept and then play as garbage.
        expect(output?.count).toBe(SHOWCASE_ANIMATED_KEY_SECONDS.length);
        expect(output?.type).toBe('VEC4');
    });

    it('is self-contained: one embedded buffer, no images, unlit', () => {
        expect(doc.buffers).toHaveLength(1);
        expect(doc.buffers?.[0]?.uri).toBeUndefined();
        expect(doc.images ?? []).toHaveLength(0);
        expect(doc.extensionsUsed).toContain('KHR_materials_unlit');
    });

    it('keeps the skinned two-bone rig the showcase screen poses by name', () => {
        expect(doc.nodes?.map((node) => node.name)).toEqual([
            'showcase-rig-animated',
            'showcase-quad',
            'root',
            SHOWCASE_POSED_BONE_NAME,
        ]);
        expect(doc.skins).toHaveLength(1);
        expect(doc.meshes?.[0]?.primitives[0]?.attributes).toMatchObject({
            POSITION: expect.any(Number),
            JOINTS_0: expect.any(Number),
            WEIGHTS_0: expect.any(Number),
        });
    });

    it('stays inside the size budget a committed fixture earns', () => {
        // Not a style rule: the file is reviewed as an opaque blob, and the
        // reason a blob is acceptable at all is that it is small and generated.
        expect(bytes.length).toBeLessThanOrEqual(4096);
    });

    it('is deterministic — two builds produce identical bytes', () => {
        // The property the committed-bytes gate rests on. A `Math.sin` in the
        // generator would pass this on one machine and fail the gate on another.
        expect(Buffer.from(buildShowcaseAnimatedGlb())).toEqual(Buffer.from(bytes));
    });
});

describe('the committed fixture', () => {
    it('equals the generator output byte for byte', () => {
        expect(Buffer.from(readFileSync(committedPath))).toEqual(
            Buffer.from(buildShowcaseAnimatedGlb()),
        );
    });

    it('reds on a one-byte mutation (the negative control)', () => {
        // Without this, an assertion comparing the file to itself — or to a
        // builder that read the file — would look identical to the one above.
        const committed = readFileSync(committedPath);
        const mutated = Buffer.from(committed);
        // The last byte: inside the BIN chunk, so no header length changes and
        // the container still parses. A mutation the reader rejected would be
        // caught by the parse rather than by the byte comparison under test.
        mutated[mutated.length - 1] = (mutated[mutated.length - 1]! + 1) % 256;

        expect(checkGlbDrift(mutated, buildShowcaseAnimatedGlb())).toBe(true);
        expect(checkGlbDrift(committed, buildShowcaseAnimatedGlb())).toBe(false);
    });
});

describe('BufferPacker', () => {
    // Driven DIRECTLY, because the generator cannot reach these arms: every view
    // it packs today is a multiple of 4 bytes long, so deleting the alignment
    // entirely leaves the committed bytes identical and every other case green.
    // MEASURED at the shipped fixture — offsets 0,48,80,144,192,204,332,352 and
    // a 432-byte buffer — so a suite that only built the real container would be
    // asserting nothing about alignment at all.

    it('leaves an already-aligned run untouched', () => {
        const packer = new BufferPacker();

        expect(packer.push(Buffer.alloc(8)).byteOffset).toBe(0);
        expect(packer.push(Buffer.alloc(4)).byteOffset).toBe(8);
        expect(packer.concat()).toHaveLength(12);
    });

    it('aligns the NEXT view after an odd-sized one, without padding its byteLength', () => {
        // The property the whole class exists for. A bufferView offset that is
        // not a multiple of 4 is a container a strict glTF reader refuses, and a
        // byteLength inflated by the padding is one it reads garbage from.
        const packer = new BufferPacker();

        const odd = packer.push(Buffer.alloc(6));
        const next = packer.push(Buffer.alloc(4));

        expect(odd.byteOffset).toBe(0);
        expect(odd.bytes).toHaveLength(6);
        expect(next.byteOffset).toBe(8);
        expect(next.byteOffset % 4).toBe(0);
    });

    it('pads the whole buffer up to a 4-byte boundary', () => {
        // The BIN chunk's own length must be a multiple of 4 even when the last
        // view is not, and no view exists to carry that padding.
        const packer = new BufferPacker();
        packer.push(Buffer.alloc(6));

        expect(packer.concat()).toHaveLength(8);
    });

    it('writes the padding as NULs, not as whatever the allocator had', () => {
        const packer = new BufferPacker();
        packer.push(Buffer.from([1, 2, 3, 4, 5, 6]));
        packer.push(Buffer.from([7, 8, 9, 10]));

        expect([...packer.concat()]).toEqual([1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10]);
    });
});

describe('checkGlbDrift', () => {
    it('reports drift for a length difference as well as a content one', () => {
        const built = buildShowcaseAnimatedGlb();

        expect(checkGlbDrift(built.subarray(0, built.length - 1), built)).toBe(true);
        expect(checkGlbDrift(new Uint8Array(0), built)).toBe(true);
        expect(checkGlbDrift(built, built)).toBe(false);
    });
});
