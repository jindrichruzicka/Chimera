import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MalformedAssetFileError } from './MalformedAssetFileError.js';
import { readWavFacts } from './wavFacts.js';

// Fixtures are BUILT here rather than committed: the interesting cases are
// malformed containers, and a repo of deliberately-corrupt binaries is both
// unreviewable and indistinguishable from rot. Written under the OS tmpdir,
// which reclaims them — and leaves the bytes in place for a failed run.
const scratch = mkdtempSync(path.join(tmpdir(), 'chimera-wav-facts-'));

/** `'RIFF'` + size + `'WAVE'`, then per-chunk `id` + size. Mirrors the reader. */
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/** A `chunkId` + little-endian size header followed by `body`, word-aligned. */
function chunk(id: string, body: Buffer): Buffer {
    const header = Buffer.alloc(8);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32LE(body.length, 4);
    // RIFF chunks are word-aligned: an odd-sized body carries a pad byte that is
    // NOT counted in the declared size.
    const pad = body.length % 2 === 0 ? Buffer.alloc(0) : Buffer.alloc(1);
    return Buffer.concat([header, body, pad]);
}

function fmtChunk({
    channels = 1,
    sampleRate = 44100,
    bitsPerSample = 16,
}: {
    channels?: number;
    sampleRate?: number;
    bitsPerSample?: number;
} = {}): Buffer {
    const body = Buffer.alloc(16);
    body.writeUInt16LE(1, 0); // PCM
    body.writeUInt16LE(channels, 2);
    body.writeUInt32LE(sampleRate, 4);
    body.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 8); // byte rate
    body.writeUInt16LE((channels * bitsPerSample) / 8, 12); // block align
    body.writeUInt16LE(bitsPerSample, 14);
    return chunk('fmt ', body);
}

interface WavOptions {
    readonly channels?: number;
    readonly sampleRate?: number;
    readonly bitsPerSample?: number;
    /** Samples per channel, interleaved by the caller for multi-channel data. */
    readonly samples?: readonly number[];
    /** Extra chunks spliced in AHEAD of `data`, as a re-encoder would. */
    readonly leadingChunks?: readonly Buffer[];
    readonly riffId?: string;
    readonly waveId?: string;
    /** Overrides the declared `data` size without changing the bytes present. */
    readonly declaredDataSize?: number;
    /** Omits the `fmt ` chunk entirely. */
    readonly omitFormat?: boolean;
    /** Omits the `data` chunk entirely. */
    readonly omitData?: boolean;
    /**
     * Emits a `fmt ` chunk carrying (and correctly declaring) this many body
     * bytes instead of 16 — a well-formed chunk that is simply too short to hold
     * the format fields. Distinct from a file that ends early: here the bytes at
     * `body + 14` DO exist, they just belong to the next chunk.
     */
    readonly formatBodySize?: number;
    /** Cuts the file off after the `fmt ` header, so it ends mid-chunk. */
    readonly endFileInsideFormat?: boolean;
}

/** Writes arbitrary bytes — for the containers a structured builder cannot express. */
function writeRaw(name: string, bytes: Buffer): string {
    const filePath = path.join(scratch, name);
    writeFileSync(filePath, bytes);
    return filePath;
}

function writeWav(name: string, options: WavOptions = {}): string {
    const {
        channels = 1,
        sampleRate = 44100,
        bitsPerSample = 16,
        samples = [0, 1, 2, 3],
        leadingChunks = [],
        riffId = 'RIFF',
        waveId = 'WAVE',
        declaredDataSize,
        omitFormat = false,
        omitData = false,
        formatBodySize,
        endFileInsideFormat = false,
    } = options;

    const bytesPerSample = bitsPerSample / 8;
    const pcm = Buffer.alloc(samples.length * bytesPerSample);
    samples.forEach((sample, index) => {
        if (bitsPerSample === 16) pcm.writeInt16LE(sample, index * 2);
        else pcm.writeUInt8(sample, index);
    });

    // The declared size is rewritten IN PLACE, leaving the bytes present
    // unchanged — that divergence is the whole point of the truncation cases.
    const data = chunk('data', pcm);
    if (declaredDataSize !== undefined) data.writeUInt32LE(declaredDataSize, 4);

    // A short-but-honest `fmt `: the header declares exactly the body it carries.
    const fmt =
        formatBodySize === undefined
            ? fmtChunk({ channels, sampleRate, bitsPerSample })
            : chunk('fmt ', Buffer.alloc(formatBodySize));

    const body = Buffer.concat([
        Buffer.from(waveId, 'ascii'),
        ...(omitFormat ? [] : [fmt]),
        ...leadingChunks,
        ...(omitData ? [] : [data]),
    ]);
    const header = Buffer.alloc(8);
    header.write(riffId, 0, 4, 'ascii');
    header.writeUInt32LE(body.length, 4);

    const whole = Buffer.concat([header, body]);
    const filePath = path.join(scratch, name);
    // Cut mid-`fmt `: past the RIFF header, past the chunk's own header, and four
    // bytes into a body the header still declares as 16. Derived from the parts
    // rather than written as literals, so a change to either header size moves
    // the cut with it instead of silently landing somewhere else.
    const insideFormatBody = RIFF_HEADER_BYTES + CHUNK_HEADER_BYTES + 4;
    writeFileSync(filePath, endFileInsideFormat ? whole.subarray(0, insideFormatBody) : whole);
    return filePath;
}

describe('readWavFacts', () => {
    it('reports the format facts a cue sheet makes claims about', () => {
        const filePath = writeWav('plain.wav', { sampleRate: 8000, samples: [0, 0, 0, 0] });

        const facts = readWavFacts(filePath);

        expect(facts.sampleRate).toBe(8000);
        expect(facts.channels).toBe(1);
        expect(facts.bitsPerSample).toBe(16);
        expect(facts.frames).toBe(4);
        expect(facts.durationSeconds).toBe(4 / 8000);
    });

    it('walks the chunk list rather than assuming the canonical 44-byte layout', () => {
        // A re-encode may splice `LIST`/`fact` ahead of `data`. Reading `fmt `/`data`
        // at fixed offsets would report the LIST bytes as audio.
        const filePath = writeWav('with-list.wav', {
            leadingChunks: [
                chunk('LIST', Buffer.from('INFOISFT', 'ascii')),
                chunk('fact', Buffer.alloc(4)),
            ],
            samples: [7, 8],
        });

        const facts = readWavFacts(filePath);

        expect(facts.frames).toBe(2);
        expect(facts.sampleAt(0)).toBe(7);
        expect(facts.sampleAt(1)).toBe(8);
    });

    it('skips the pad byte of an odd-sized chunk', () => {
        // An odd body carries a pad byte excluded from the declared size. Advancing
        // by size alone lands one byte short and every later chunk id is garbage.
        const filePath = writeWav('odd-chunk.wav', {
            leadingChunks: [chunk('LIST', Buffer.from('odd', 'ascii'))],
            samples: [5],
        });

        expect(readWavFacts(filePath).sampleAt(0)).toBe(5);
    });

    it('counts frames, not samples, for a multi-channel clip', () => {
        const filePath = writeWav('stereo.wav', {
            channels: 2,
            sampleRate: 100,
            samples: [1, 2, 3, 4, 5, 6],
        });

        const facts = readWavFacts(filePath);

        expect(facts.channels).toBe(2);
        expect(facts.frames).toBe(3);
        expect(facts.durationSeconds).toBe(3 / 100);
    });

    it('reads the first channel of a frame through sampleAt', () => {
        const filePath = writeWav('stereo-samples.wav', {
            channels: 2,
            samples: [10, -10, 20, -20],
        });

        const facts = readWavFacts(filePath);

        expect(facts.sampleAt(0)).toBe(10);
        expect(facts.sampleAt(1)).toBe(20);
    });

    it('rejects a file whose RIFF magic is wrong', () => {
        const filePath = writeWav('not-riff.wav', { riffId: 'RIFX' });

        expect(() => readWavFacts(filePath)).toThrow(MalformedAssetFileError);
    });

    it('rejects a RIFF container that is not WAVE', () => {
        const filePath = writeWav('not-wave.wav', { waveId: 'AVI ' });

        expect(() => readWavFacts(filePath)).toThrow(/WAVE/u);
    });

    it('rejects a data chunk that outruns the file', () => {
        // A WHOLE number of frames (1000 bytes / 2 = 500) that the file does not
        // carry — six bytes of PCM are present. Only the length check catches
        // this: `frames` comes out integral, so `sampleAt` would happily read
        // past the end of the buffer for 497 of the 500 frames it advertises.
        const filePath = writeWav('overrun.wav', { samples: [1, 2, 3], declaredDataSize: 1000 });

        expect(() => readWavFacts(filePath)).toThrow(/declares 1000 bytes/u);
    });

    it('rejects a data chunk that is not a whole number of frames', () => {
        // Present in the file, but 7 bytes of 2-byte frames. Reporting 3.5 frames
        // would put every derived offset half a frame off from there on.
        const filePath = writeWav('half-frame.wav', {
            samples: [1, 2, 3, 4],
            declaredDataSize: 7,
        });

        expect(() => readWavFacts(filePath)).toThrow(/not a whole number of 2-byte frames/u);
    });

    it('names the file it rejected', () => {
        const filePath = writeWav('named.wav', { riffId: 'XXXX' });

        expect(() => readWavFacts(filePath)).toThrow(
            expect.objectContaining({ name: 'MalformedAssetFileError', filePath }),
        );
    });

    it('refuses sampleAt on an encoding it cannot read', () => {
        // The reader returns 16-bit LE. On 8-bit data it would silently pair two
        // frames into one nonsense value — the failure mode the caller cannot see.
        const filePath = writeWav('eight-bit.wav', { bitsPerSample: 8, samples: [1, 2, 3, 4] });

        const facts = readWavFacts(filePath);

        expect(facts.bitsPerSample).toBe(8);
        expect(facts.frames).toBe(4);
        expect(() => facts.sampleAt(0)).toThrow(/16-bit/u);
    });

    it('refuses a frame index outside the clip', () => {
        const filePath = writeWav('bounds.wav', { samples: [1, 2] });

        const facts = readWavFacts(filePath);

        // The MESSAGE, not just the class: `readInt16LE` past the end of the
        // buffer throws a RangeError of its own, so `toThrow(RangeError)` alone
        // passes whether the guard is present, off by one, or absent entirely —
        // it cannot tell this module's error from the cryptic one it replaces.
        expect(() => facts.sampleAt(2)).toThrow(/frame 2 is outside the 2-frame clip/u);
        expect(() => facts.sampleAt(-1)).toThrow(/frame -1 is outside the 2-frame clip/u);
    });

    it('refuses a fractional frame index', () => {
        // Reads at a half-frame offset land mid-sample and return a number built
        // from two neighbours' bytes — plausible, and wrong.
        const filePath = writeWav('fractional.wav', { samples: [1, 2, 3, 4] });

        expect(() => readWavFacts(filePath).sampleAt(1.5)).toThrow(RangeError);
    });

    it('rejects a file too short to hold a RIFF header', () => {
        const filePath = writeRaw('stub.wav', Buffer.from('RIF', 'ascii'));

        expect(() => readWavFacts(filePath)).toThrow(/shorter than a RIFF header/u);
    });

    it('rejects a container with no fmt chunk', () => {
        const filePath = writeWav('no-fmt.wav', { omitFormat: true });

        expect(() => readWavFacts(filePath)).toThrow(/no 'fmt ' chunk/u);
    });

    it('rejects a container with no data chunk', () => {
        const filePath = writeWav('no-data.wav', { omitData: true });

        expect(() => readWavFacts(filePath)).toThrow(/no 'data' chunk/u);
    });

    it('distinguishes a fmt chunk cut off by the end of the file from a missing one', () => {
        // Both leave the format unread; only one is a truncation, and a reader
        // told "no 'fmt ' chunk" about a file that plainly has one looks for the
        // wrong defect.
        const filePath = writeWav('short-fmt.wav', { endFileInsideFormat: true });

        expect(() => readWavFacts(filePath)).toThrow(/'fmt ' chunk is present but its body/u);
    });

    it('rejects a fmt chunk that DECLARES a body too short for the format fields', () => {
        // The sharper case, and the one a file-length bound alone misses: the
        // chunk honestly declares 12 bytes and `data` follows it, so the bytes at
        // `body + 14` exist — they are `data`'s own id. Reading `bitsPerSample`
        // from there yields a frame size built out of the letters "ta", and the
        // reader would then fail while naming the `data` chunk for it.
        const filePath = writeWav('declared-short-fmt.wav', { formatBodySize: 12 });

        expect(() => readWavFacts(filePath)).toThrow(/'fmt ' chunk is present but its body/u);
    });

    it('rejects a degenerate fmt chunk rather than dividing by zero', () => {
        // 0 channels makes `bytesPerFrame` 0, so `frames` is Infinity or NaN —
        // both of which flow on into `durationSeconds` as a number-shaped lie.
        const filePath = writeWav('zero-channels.wav', { channels: 0 });

        expect(() => readWavFacts(filePath)).toThrow(/degenerate 'fmt ' chunk/u);
    });
});
