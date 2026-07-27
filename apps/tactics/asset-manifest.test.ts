/**
 * apps/tactics/asset-manifest.test.ts
 *
 * Tactics is the reference adopter of the cue-sheet authoring surface (§4.25).
 * Two things are worth pinning here, and neither is pinned anywhere else.
 *
 * First, the sheet is authored through `audioClipEntry` (Invariant #124's sanctioned
 * builder) rather than a hand-written `metadata` key, and `validate-assets`
 * range-checks it at build time (Invariant #125). Those checks compare each cue
 * against the sheet's OWN `durationSeconds` — a self-consistent sheet whose
 * `durationSeconds` is simply wrong about the file passes the build and then
 * silently mis-times every cue at runtime, because the renderer clamps against the
 * DECODED buffer instead. So the assertion that matters is the one the build gate
 * structurally cannot make: the authored `durationSeconds` equals the real length
 * of the `.wav` on disk, read from its RIFF header.
 *
 * Second, the loop region must be seamless. `loopStart`/`loopEnd` land on sample
 * indices whose amplitudes match, so a wrap produces no click — the clips are
 * synthesised with every partial an integer multiple of `1 / (loopEnd - loopStart)`
 * precisely so this holds, and a regenerated or re-encoded clip that broke it would
 * otherwise only be audible.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tacticsAssetManifest, tacticsAudioRefs, tacticsMusicCues } from './asset-manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface WavFacts {
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitsPerSample: number;
    readonly frames: number;
    readonly durationSeconds: number;
    readonly sampleAt: (frameIndex: number) => number;
}

/**
 * Read the facts a cue sheet makes claims about straight out of the RIFF header,
 * walking the chunk list rather than assuming the canonical 44-byte layout (a
 * re-encode may insert `LIST`/`fact` chunks ahead of `data`).
 */
function readWav(relativePath: string): WavFacts {
    const bytes = readFileSync(resolve(__dirname, relativePath));
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');

    let offset = 12;
    let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | undefined;
    let dataOffset: number | undefined;
    let dataLength: number | undefined;

    while (offset + 8 <= bytes.length) {
        const id = bytes.toString('ascii', offset, offset + 4);
        const size = bytes.readUInt32LE(offset + 4);
        if (id === 'fmt ') {
            fmt = {
                channels: bytes.readUInt16LE(offset + 10),
                sampleRate: bytes.readUInt32LE(offset + 12),
                bitsPerSample: bytes.readUInt16LE(offset + 22),
            };
        }
        if (id === 'data') {
            dataOffset = offset + 8;
            dataLength = size;
        }
        offset += 8 + size + (size % 2); // chunks are word-aligned
    }

    expect(fmt).toBeDefined();
    expect(dataOffset).toBeDefined();
    expect(dataLength).toBeDefined();
    const { sampleRate, channels, bitsPerSample } = fmt!;
    const bytesPerFrame = (channels * bitsPerSample) / 8;
    const frames = dataLength! / bytesPerFrame;

    return {
        sampleRate,
        channels,
        bitsPerSample,
        frames,
        durationSeconds: frames / sampleRate,
        sampleAt: (frameIndex) => bytes.readInt16LE(dataOffset! + frameIndex * bytesPerFrame),
    };
}

const MUSIC_CLIPS = [
    {
        name: 'calm',
        ref: tacticsAudioRefs.ambienceCalm,
        file: 'assets/audio/music/ambience-calm.wav',
    },
    {
        name: 'tense',
        ref: tacticsAudioRefs.ambienceTense,
        file: 'assets/audio/music/ambience-tense.wav',
    },
] as const;

describe('Tactics asset manifest — cue-sheet adoption', () => {
    it('declares every audio ref exactly once, and the music refs among them', () => {
        const refs = tacticsAssetManifest.entries.map((entry) => entry.ref);
        expect(new Set(refs).size).toBe(refs.length);
        for (const ref of Object.values(tacticsAudioRefs)) {
            expect(refs).toContain(ref);
        }
    });

    it.each(MUSIC_CLIPS)(
        'attaches a cue sheet to the $name ambience entry via audioClipEntry',
        ({ ref }) => {
            const entry = tacticsAssetManifest.entries.find((candidate) => candidate.ref === ref);
            expect(entry).toBeDefined();
            expect(entry?.kind).toBe('audio-clip');
            // Cue-sheet-bearing entries preload: a music bed that has to decode on
            // first use cannot fade in on time (priority is the only lever there).
            expect(entry?.priority).toBe('critical');
            expect(entry?.metadata).toEqual({
                cues: {
                    intro: tacticsMusicCues.intro,
                    loopStart: tacticsMusicCues.loopStart,
                    loopEnd: tacticsMusicCues.loopEnd,
                    outro: tacticsMusicCues.outro,
                },
                defaultLoopRegion: ['loopStart', 'loopEnd'],
                durationSeconds: tacticsMusicCues.durationSeconds,
            });
        },
    );

    it.each(MUSIC_CLIPS)(
        "the $name sheet's durationSeconds is the real length of the file on disk",
        ({ file }) => {
            const wav = readWav(file);
            // The gate compares cues against the AUTHORED duration; only this compares
            // the authored duration against the ASSET. Exact, not approximate: the clip
            // is synthesised to a whole number of frames at this length.
            expect(wav.durationSeconds).toBe(tacticsMusicCues.durationSeconds);
        },
    );

    it.each(MUSIC_CLIPS)('the $name cues land on whole sample frames', ({ file }) => {
        const wav = readWav(file);
        for (const seconds of [
            tacticsMusicCues.intro,
            tacticsMusicCues.loopStart,
            tacticsMusicCues.loopEnd,
            tacticsMusicCues.outro,
        ]) {
            expect(Number.isInteger(seconds * wav.sampleRate)).toBe(true);
        }
    });

    it.each(MUSIC_CLIPS)('the $name loop region wraps without a discontinuity', ({ file }) => {
        const wav = readWav(file);
        // `sampleAt` reads 16-bit LE and the tolerance below is stated in 16-bit LSBs;
        // both are silently wrong for any other encoding.
        expect(wav.bitsPerSample).toBe(16);
        expect(wav.channels).toBe(1);
        // The manifest comment states the cue offsets land on whole frames "at
        // 44.1 kHz"; a re-encode to 48 kHz keeps every other assertion green.
        expect(wav.sampleRate).toBe(44100);
        const startFrame = tacticsMusicCues.loopStart * wav.sampleRate;
        const endFrame = tacticsMusicCues.loopEnd * wav.sampleRate;
        expect(endFrame).toBeLessThan(wav.frames);
        // Identical amplitude AND identical local slope: matching one sample can happen
        // by coincidence at a zero crossing, matching the step into the next cannot.
        expect(wav.sampleAt(endFrame)).toBe(wav.sampleAt(startFrame));
        // Within a couple of LSBs: the two steps are the same curve sampled at the
        // same phase, and only 16-bit rounding separates them.
        const wrapStep = wav.sampleAt(endFrame + 1) - wav.sampleAt(endFrame);
        const loopStep = wav.sampleAt(startFrame + 1) - wav.sampleAt(startFrame);
        expect(Math.abs(wrapStep - loopStep)).toBeLessThanOrEqual(2);
    });

    // A plain `it`: the shared sheet is one value, so running this per clip would
    // report one assertion's worth of work as two clips' worth of coverage.
    it('orders the shared cue offsets inside the clip', () => {
        const { intro, loopStart, loopEnd, outro, durationSeconds } = tacticsMusicCues;
        expect(intro).toBeGreaterThanOrEqual(0);
        expect(loopStart).toBeGreaterThanOrEqual(intro);
        expect(loopEnd).toBeGreaterThan(loopStart);
        expect(outro).toBeGreaterThanOrEqual(loopEnd);
        expect(durationSeconds).toBeGreaterThanOrEqual(outro);
    });
});
