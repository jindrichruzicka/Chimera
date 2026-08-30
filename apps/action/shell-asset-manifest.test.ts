/**
 * The gap this closes is the one `validate-assets` structurally cannot: it
 * range-checks a cue sheet against the sheet's OWN `durationSeconds`
 * (Invariant #125), so a self-consistent sheet that is simply wrong about the
 * file passes the build and then mis-times the menu→match handoff at runtime.
 * Comparing the authored numbers to the real bytes needs the RIFF header read,
 * which `@chimera-engine/electron/test-support` publishes — the parsing is what
 * is easy to get wrong, and it is written once there rather than here.
 *
 * It also checks the synthesis facts the manifest's own comment claims: the
 * clips' rate, channel count and width, and — for the bed — that the loop body
 * really is a whole number of cycles of the three partials the comment names, so
 * the "sample-continuous wrap" sentence is measured rather than asserted.
 */

import { describe, expect, it } from 'vitest';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetPathForRef, readWavFacts } from '@chimera-engine/electron/test-support';

import { ACTION_GAME_ID } from './simulation/constants.js';
import {
    actionShellAssetManifest,
    actionShellAudioRefs,
    actionShellMusicCues,
} from './shell-asset-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve a ref the same way the runtime resolver does, from the ref itself. */
const readWav = (ref: string) => readWavFacts(assetPathForRef(here, ref));

/** The partials the manifest comment names, in Hz. */
const BED_PARTIALS = [110, 220, 330] as const;

describe('action shell asset manifest', () => {
    it('is declared for this game and lists both clips exactly once', () => {
        expect(actionShellAssetManifest.gameId).toBe(ACTION_GAME_ID);

        const refs = actionShellAssetManifest.entries.map((entry) => entry.ref);
        expect(new Set(refs).size).toBe(refs.length);
        for (const ref of Object.values(actionShellAudioRefs)) {
            expect(refs).toContain(ref);
        }
    });

    it('declares every entry as an audio clip the shell session preloads', () => {
        for (const entry of actionShellAssetManifest.entries) {
            expect(entry.kind, entry.ref).toBe('audio-clip');
            expect(entry.priority, entry.ref).toBe('critical');
        }
    });

    it('attaches the mirrored cue sheet to the BED entry', () => {
        const entry = actionShellAssetManifest.entries.find(
            (candidate) => candidate.ref === actionShellAudioRefs.menuBed,
        );

        expect(entry?.metadata).toEqual({
            cues: {
                intro: actionShellMusicCues.intro,
                loopStart: actionShellMusicCues.loopStart,
                loopEnd: actionShellMusicCues.loopEnd,
                outro: actionShellMusicCues.outro,
            },
            defaultLoopRegion: ['loopStart', 'loopEnd'],
            durationSeconds: actionShellMusicCues.durationSeconds,
        });
    });

    it('declares the `outro` cue the cue-aligned handoff looks for', () => {
        // `ShellAudioSession` reads exactly this name off the declared bed and
        // falls back to a plain screen-fade-timed fade without it. Dropping the
        // cue would silently downgrade the handoff, with nothing else red.
        const entry = actionShellAssetManifest.entries.find(
            (candidate) => candidate.ref === actionShellAudioRefs.menuBed,
        );
        const cues = (entry?.metadata as { cues?: Record<string, number> } | undefined)?.cues;

        expect(typeof cues?.['outro']).toBe('number');
    });

    it('leaves the blip entry SHEETLESS rather than giving it an empty sheet', () => {
        // An entry with `cues` owes a `durationSeconds` (Invariant #125), and a
        // 120 ms tick has no cue to name; an empty sheet would be a declaration
        // with nothing behind it.
        const entry = actionShellAssetManifest.entries.find(
            (candidate) => candidate.ref === actionShellAudioRefs.select,
        );

        expect(entry).toBeDefined();
        expect(entry && 'metadata' in entry).toBe(false);
    });

    it('orders the bed’s cues, and keeps every one inside the clip', () => {
        const { intro, loopStart, loopEnd, outro, durationSeconds } = actionShellMusicCues;

        expect(intro).toBeGreaterThan(0);
        expect(loopStart).toBeLessThan(loopEnd);
        expect(outro).toBeGreaterThanOrEqual(loopEnd);
        expect(durationSeconds).toBeGreaterThan(outro);
    });

    it('gives the bed the real length its sheet claims', () => {
        // Exact, not approximate: the clip is synthesised at a whole number of
        // frames, so a rounded duration would mean the wrong file.
        expect(readWav(actionShellAudioRefs.menuBed).durationSeconds).toBe(
            actionShellMusicCues.durationSeconds,
        );
    });

    it.each(Object.entries(actionShellAudioRefs))(
        'ships %s as 44.1 kHz mono 16-bit PCM',
        (_name, ref) => {
            const wav = readWav(ref);

            expect(wav.sampleRate).toBe(44100);
            expect(wav.channels).toBe(1);
            expect(wav.bitsPerSample).toBe(16);
        },
    );

    it('lands the bed’s loop bounds on whole sample frames', () => {
        // A loop bound between two frames is resolved by rounding at play time,
        // which moves the wrap off the continuous point the partials were cut for.
        const { sampleRate } = readWav(actionShellAudioRefs.menuBed);

        for (const [name, seconds] of Object.entries(actionShellMusicCues)) {
            expect(Number.isInteger(seconds * sampleRate), name).toBe(true);
        }
    });

    it('makes the bed’s loop body a whole number of cycles of every partial', () => {
        // This is what "sample-continuous wrap" means. A loop body holding 165.5
        // cycles of the 110 Hz partial would step the waveform by half a period
        // on every wrap — an audible click once a loop.
        const body = actionShellMusicCues.loopEnd - actionShellMusicCues.loopStart;

        for (const partial of BED_PARTIALS) {
            const cycles = body * partial;
            expect(Math.abs(cycles - Math.round(cycles)), `${partial.toString()} Hz`).toBeLessThan(
                1e-9,
            );
        }
    });

    it('starts and ends the bed at silence, so the ramps the comment claims are real', () => {
        const wav = readWav(actionShellAudioRefs.menuBed);
        const peak = Math.max(
            ...Array.from({ length: 64 }, (_unused, index) =>
                Math.abs(wav.sampleAt(Math.floor(wav.frames / 2) + index)),
            ),
        );

        expect(Math.abs(wav.sampleAt(0))).toBeLessThan(peak / 10);
        expect(Math.abs(wav.sampleAt(wav.frames - 1))).toBeLessThan(peak / 10);
        expect(peak).toBeGreaterThan(0);
    });

    it('keeps the blip short enough not to overlap a second pick', () => {
        expect(readWav(actionShellAudioRefs.select).durationSeconds).toBeLessThan(0.25);
    });
});
