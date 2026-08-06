/**
 * electron/dev-tools/test-support/wavFacts.ts
 *
 * Reads, straight out of a `.wav` file's RIFF header, the facts a cue sheet
 * makes claims about.
 *
 * This exists because of a gap no build gate can close. `validate-assets`
 * range-checks a cue sheet against the sheet's OWN `durationSeconds`
 * (Invariant #125), so a self-consistent sheet that is simply wrong about the
 * file passes the build and then mis-times every cue at runtime — the renderer
 * clamps against the DECODED buffer, not the authored number. Comparing the
 * authored duration to the real length of the bytes on disk is the assertion
 * the gate structurally cannot make, and it needs the header read.
 *
 * The chunk list is WALKED rather than assumed at the canonical 44-byte layout:
 * a re-encode may splice `LIST`/`fact` chunks ahead of `data`, and a fixed-offset
 * read would then report metadata bytes as audio.
 */

import { readFileSync } from 'node:fs';

import { MalformedAssetFileError } from './MalformedAssetFileError.js';

/** The format facts of a `.wav`, plus a reader for its individual samples. */
export interface WavFacts {
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitsPerSample: number;
    /** Sample frames — one frame is one sample on EVERY channel. */
    readonly frames: number;
    /** `frames / sampleRate`: the real playing length of the file. */
    readonly durationSeconds: number;
    /**
     * The first channel's signed amplitude at `frameIndex`.
     *
     * @throws {MalformedAssetFileError} When the clip is not 16-bit — the reader
     *   returns 16-bit LE, and on any other width it would pair unrelated bytes
     *   into a plausible-looking number instead of failing.
     * @throws {RangeError} When `frameIndex` is outside the clip.
     */
    readonly sampleAt: (frameIndex: number) => number;
}

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
/** Bytes of a `fmt ` body the PCM format fields occupy; extensible forms are longer. */
const FMT_BODY_BYTES = 16;

interface WavFormat {
    readonly channels: number;
    readonly sampleRate: number;
    readonly bitsPerSample: number;
}

/**
 * Read the format facts of the `.wav` at `filePath`.
 *
 * @throws {MalformedAssetFileError} When the file is not a RIFF/WAVE container,
 *   is missing its `fmt `/`data` chunks, or declares more audio than it carries.
 */
export function readWavFacts(filePath: string): WavFacts {
    const bytes = readFileSync(filePath);
    if (bytes.length < RIFF_HEADER_BYTES) {
        throw new MalformedAssetFileError(filePath, 'shorter than a RIFF header');
    }
    if (bytes.toString('ascii', 0, 4) !== 'RIFF') {
        throw new MalformedAssetFileError(
            filePath,
            `expected a 'RIFF' magic, found '${bytes.toString('ascii', 0, 4)}'`,
        );
    }
    if (bytes.toString('ascii', 8, 12) !== 'WAVE') {
        throw new MalformedAssetFileError(
            filePath,
            `expected a 'WAVE' RIFF form, found '${bytes.toString('ascii', 8, 12)}'`,
        );
    }

    let format: WavFormat | undefined;
    let dataOffset: number | undefined;
    let dataLength: number | undefined;
    // Distinguishes "no `fmt ` chunk" from "a `fmt ` chunk whose body is cut
    // short" — the same silence otherwise, and only the second is a truncation.
    let sawTruncatedFormat = false;

    let offset = RIFF_HEADER_BYTES;
    while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
        const id = bytes.toString('ascii', offset, offset + 4);
        const size = bytes.readUInt32LE(offset + 4);
        const body = offset + CHUNK_HEADER_BYTES;
        if (id === 'fmt ') {
            // BOTH bounds. The file-length one alone misses the sharper case: a
            // `fmt ` chunk that DECLARES fewer than 16 bytes and is followed by
            // another chunk. The bytes at `body+14` exist — they belong to the
            // next chunk's header — so `bitsPerSample` would be read out of
            // `data`'s id, and the reader would go on to report a frame size
            // derived from it and fail while naming the wrong chunk entirely.
            if (size < FMT_BODY_BYTES || body + FMT_BODY_BYTES > bytes.length) {
                sawTruncatedFormat = true;
            } else {
                format = {
                    channels: bytes.readUInt16LE(body + 2),
                    sampleRate: bytes.readUInt32LE(body + 4),
                    bitsPerSample: bytes.readUInt16LE(body + 14),
                };
            }
        }
        if (id === 'data') {
            dataOffset = body;
            dataLength = size;
        }
        // Chunks are word-aligned: an odd body carries a pad byte that the
        // declared size does NOT count. Advancing by size alone lands one byte
        // short and reads garbage as the next chunk id.
        offset = body + size + (size % 2);
    }

    if (format === undefined) {
        throw new MalformedAssetFileError(
            filePath,
            sawTruncatedFormat
                ? `a 'fmt ' chunk is present but its body is shorter than the ${FMT_BODY_BYTES} bytes the format fields occupy`
                : "no 'fmt ' chunk in the chunk list",
        );
    }
    if (dataOffset === undefined || dataLength === undefined) {
        throw new MalformedAssetFileError(filePath, "no 'data' chunk in the chunk list");
    }
    if (dataOffset + dataLength > bytes.length) {
        throw new MalformedAssetFileError(
            filePath,
            `the 'data' chunk declares ${dataLength} bytes but only ${bytes.length - dataOffset} follow it`,
        );
    }

    const { channels, sampleRate, bitsPerSample } = format;
    if (channels === 0 || sampleRate === 0 || bitsPerSample === 0) {
        throw new MalformedAssetFileError(
            filePath,
            `degenerate 'fmt ' chunk (${channels}ch ${sampleRate}Hz ${bitsPerSample}-bit)`,
        );
    }

    const bytesPerFrame = (channels * bitsPerSample) / 8;
    const frames = dataLength / bytesPerFrame;
    if (!Number.isInteger(frames)) {
        throw new MalformedAssetFileError(
            filePath,
            `the 'data' chunk holds ${dataLength} bytes, not a whole number of ${bytesPerFrame}-byte frames`,
        );
    }

    const audioStart = dataOffset;
    return {
        sampleRate,
        channels,
        bitsPerSample,
        frames,
        durationSeconds: frames / sampleRate,
        sampleAt: (frameIndex: number): number => {
            if (bitsPerSample !== 16) {
                throw new MalformedAssetFileError(
                    filePath,
                    `sampleAt reads 16-bit LE samples; this clip is ${bitsPerSample}-bit`,
                );
            }
            if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= frames) {
                throw new RangeError(
                    `frame ${frameIndex} is outside the ${frames}-frame clip ${filePath}`,
                );
            }
            return bytes.readInt16LE(audioStart + frameIndex * bytesPerFrame);
        },
    };
}
