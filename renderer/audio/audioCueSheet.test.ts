/**
 * renderer/audio/audioCueSheet.test.ts
 *
 * Unit tests for the pure, fail-soft cue-sheet parser + cue resolver:
 * `parseAudioCueSheet`, `resolveCue`, and `resolveCueWindow`. These parse the opaque
 * `AudioClipMetadata` a game authors onto an audio clip, which Invariant #124 keeps
 * inside `renderer/audio`; `simulation/`/`ai/` never import back.
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * Invariants upheld:
 *   #118 — Cue/second resolution is FAIL-SOFT and never throws into a caller:
 *     a load-bearing (anchor) unresolvable cue abandons with exactly one warning;
 *     end-point cues clamp; a post-clamp-collapsed window drops and playback
 *     continues; `parseAudioCueSheet` returns `null` for absent/malformed metadata.
 *   #124 — the sheet is read inside `renderer/audio` and nowhere else; it rides the
 *     opaque `AssetManifestEntry.metadata` slot (typed `unknown`).
 *
 * The resolver is PURE: it never calls a logger — it RETURNS the warning string
 * so the `AudioManager` logs it later. That keeps "exactly one warning" a pure,
 * synchronous assertion (no console spying needed to count warnings), and lets a
 * spy prove the resolver stays silent.
 */

import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';
import type { AudioClipMetadata } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import type { Cue } from './Cue.js';
import {
    parseAudioCueSheet,
    resolveCue,
    resolveCueWindow,
    type CueResolution,
    type CueWindowResolution,
} from './audioCueSheet.js';

afterEach(() => {
    vi.restoreAllMocks();
});

// ─── parseAudioCueSheet — accept ────────────────────────────────────────────────

describe('parseAudioCueSheet — well-formed metadata', () => {
    it('returns a typed sheet for cues + defaultLoopRegion + durationSeconds', () => {
        const sheet = parseAudioCueSheet({
            cues: { intro: 0, loopStart: 1.5, loopEnd: 42, outro: 44 },
            defaultLoopRegion: ['loopStart', 'loopEnd'],
            durationSeconds: 45,
        });

        expect(sheet).toEqual({
            cues: { intro: 0, loopStart: 1.5, loopEnd: 42, outro: 44 },
            defaultLoopRegion: ['loopStart', 'loopEnd'],
            durationSeconds: 45,
        });
        expectTypeOf(sheet).toEqualTypeOf<AudioClipMetadata | null>();
    });

    it('accepts an empty object as an empty (well-formed) sheet', () => {
        expect(parseAudioCueSheet({})).toEqual({});
    });

    it('accepts a cues-only sheet that carries durationSeconds', () => {
        expect(parseAudioCueSheet({ cues: { hit: 1 }, durationSeconds: 10 })).toEqual({
            cues: { hit: 1 },
            durationSeconds: 10,
        });
    });

    it('accepts a durationSeconds-only sheet', () => {
        expect(parseAudioCueSheet({ durationSeconds: 10 })).toEqual({ durationSeconds: 10 });
    });

    it('drops unknown extra keys, returning only known fields', () => {
        const sheet = parseAudioCueSheet({ cues: { a: 1 }, durationSeconds: 10, foo: 'bar' });
        expect(sheet).toEqual({ cues: { a: 1 }, durationSeconds: 10 });
        expect(sheet).not.toHaveProperty('foo');
    });

    it('accepts cue seconds at exactly 0 and exactly durationSeconds (inclusive bounds)', () => {
        expect(parseAudioCueSheet({ cues: { s: 0, e: 10 }, durationSeconds: 10 })).toEqual({
            cues: { s: 0, e: 10 },
            durationSeconds: 10,
        });
    });

    it('does not mutate the input metadata', () => {
        const input = Object.freeze({
            cues: Object.freeze({ a: 1 }),
            durationSeconds: 10,
        });
        expect(() => parseAudioCueSheet(input)).not.toThrow();
        expect(input).toEqual({ cues: { a: 1 }, durationSeconds: 10 });
    });
});

// ─── parseAudioCueSheet — reject → null ─────────────────────────────────────────

describe('parseAudioCueSheet — absent / malformed metadata → null', () => {
    it('returns null for undefined and null', () => {
        expect(parseAudioCueSheet(undefined)).toBeNull();
        expect(parseAudioCueSheet(null)).toBeNull();
    });

    it('returns null for a primitive (string / number / boolean)', () => {
        expect(parseAudioCueSheet('sheet')).toBeNull();
        expect(parseAudioCueSheet(42)).toBeNull();
        expect(parseAudioCueSheet(true)).toBeNull();
    });

    it('returns null for an array', () => {
        expect(parseAudioCueSheet([])).toBeNull();
        expect(parseAudioCueSheet([{ cues: {} }])).toBeNull();
    });

    it('returns null when a cue value is negative', () => {
        expect(parseAudioCueSheet({ cues: { a: -1 }, durationSeconds: 10 })).toBeNull();
    });

    it('returns null when a cue value is non-finite (NaN / Infinity)', () => {
        expect(parseAudioCueSheet({ cues: { a: NaN }, durationSeconds: 10 })).toBeNull();
        expect(parseAudioCueSheet({ cues: { a: Infinity }, durationSeconds: 10 })).toBeNull();
    });

    it('returns null when a cue value is not a number', () => {
        expect(parseAudioCueSheet({ cues: { a: '1' }, durationSeconds: 10 })).toBeNull();
    });

    it('returns null when cues is present but durationSeconds is missing', () => {
        expect(parseAudioCueSheet({ cues: { a: 1 } })).toBeNull();
    });

    it('returns null when defaultLoopRegion is present but durationSeconds is missing', () => {
        expect(
            parseAudioCueSheet({ cues: { a: 1, b: 2 }, defaultLoopRegion: ['a', 'b'] }),
        ).toBeNull();
    });

    it('returns null when defaultLoopRegion is not a 2-tuple of strings', () => {
        expect(
            parseAudioCueSheet({ cues: { a: 1 }, defaultLoopRegion: ['a'], durationSeconds: 10 }),
        ).toBeNull();
        expect(
            parseAudioCueSheet({
                cues: { a: 1, b: 2, c: 3 },
                defaultLoopRegion: ['a', 'b', 'c'],
                durationSeconds: 10,
            }),
        ).toBeNull();
        expect(
            parseAudioCueSheet({ cues: { a: 1 }, defaultLoopRegion: [0, 1], durationSeconds: 10 }),
        ).toBeNull();
    });

    it('returns null when a defaultLoopRegion name is absent from cues', () => {
        expect(
            parseAudioCueSheet({
                cues: { a: 1 },
                defaultLoopRegion: ['a', 'z'],
                durationSeconds: 10,
            }),
        ).toBeNull();
    });

    it('returns null when defaultLoopRegion end <= start', () => {
        expect(
            parseAudioCueSheet({
                cues: { a: 5, b: 5 },
                defaultLoopRegion: ['a', 'b'],
                durationSeconds: 10,
            }),
        ).toBeNull();
        expect(
            parseAudioCueSheet({
                cues: { a: 5, b: 3 },
                defaultLoopRegion: ['a', 'b'],
                durationSeconds: 10,
            }),
        ).toBeNull();
    });

    it('returns null when defaultLoopRegion is present but cues is absent', () => {
        expect(
            parseAudioCueSheet({ defaultLoopRegion: ['a', 'b'], durationSeconds: 10 }),
        ).toBeNull();
    });

    it('returns null when durationSeconds is non-finite or negative', () => {
        expect(parseAudioCueSheet({ durationSeconds: NaN })).toBeNull();
        expect(parseAudioCueSheet({ durationSeconds: -1 })).toBeNull();
    });

    it('returns null when a cue second exceeds durationSeconds', () => {
        expect(parseAudioCueSheet({ cues: { a: 11 }, durationSeconds: 10 })).toBeNull();
    });

    it('never throws on hostile input (function / symbol / circular ref)', () => {
        expect(() => parseAudioCueSheet(() => undefined)).not.toThrow();
        expect(parseAudioCueSheet(() => undefined)).toBeNull();
        expect(() => parseAudioCueSheet(Symbol('x'))).not.toThrow();
        expect(parseAudioCueSheet(Symbol('x'))).toBeNull();

        const circular: Record<string, unknown> = {};
        circular['self'] = circular;
        expect(() => parseAudioCueSheet(circular)).not.toThrow();
    });
});

// ─── resolveCue — anchor (load-bearing; abandons) ───────────────────────────────

describe('resolveCue — anchor role', () => {
    const sheet: AudioClipMetadata = { cues: { chorus: 5 }, durationSeconds: 10 };
    const anchor = (cue: Cue, duration = 10, s: AudioClipMetadata | null = sheet): CueResolution =>
        resolveCue(cue, { sheet: s, duration, role: 'anchor' });

    it('resolves a raw number within [0, duration]', () => {
        expect(anchor(3)).toEqual({ kind: 'resolved', seconds: 3 });
    });

    it('clamps a negative anchor number to 0 with no warning', () => {
        expect(anchor(-2)).toEqual({ kind: 'resolved', seconds: 0 });
    });

    it('abandons an anchor number beyond duration with exactly one warning', () => {
        const result = anchor(15);
        expect(result.kind).toBe('abandon');
        if (result.kind === 'abandon') {
            expect(typeof result.warning).toBe('string');
            expect(result.warning.length).toBeGreaterThan(0);
        }
    });

    it('abandons a non-finite anchor number (NaN)', () => {
        expect(anchor(NaN).kind).toBe('abandon');
    });

    it('resolves "start" to 0 and "end" to duration', () => {
        expect(anchor('start')).toEqual({ kind: 'resolved', seconds: 0 });
        expect(anchor('end')).toEqual({ kind: 'resolved', seconds: 10 });
    });

    it('resolves a { name } present in the sheet', () => {
        expect(anchor({ name: 'chorus' })).toEqual({ kind: 'resolved', seconds: 5 });
    });

    it('abandons an absent { name } with exactly one warning naming the cue', () => {
        const result = anchor({ name: 'missing' });
        expect(result.kind).toBe('abandon');
        if (result.kind === 'abandon') {
            expect(result.warning).toContain('missing');
        }
    });

    it('abandons a present { name } that lands beyond buffer.duration', () => {
        // Sheet is self-consistent (8 <= durationSeconds 20) but the decoded
        // buffer is only 5s — durationSeconds is an authoring hint, buffer.duration
        // is the real gate.
        const shortBuffer: AudioClipMetadata = { cues: { late: 8 }, durationSeconds: 20 };
        expect(anchor({ name: 'late' }, 5, shortBuffer).kind).toBe('abandon');
    });

    it('abandons a { name } when the sheet is null', () => {
        expect(anchor({ name: 'chorus' }, 10, null).kind).toBe('abandon');
    });

    it('is pure: returns the warning as a string and calls no console method', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        const result = anchor(15);

        expect(result.kind).toBe('abandon');
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });
});

// ─── resolveCue — endpoint (clamps; never abandons) ─────────────────────────────

describe('resolveCue — endpoint role', () => {
    const sheet: AudioClipMetadata = { cues: { chorus: 5, late: 12 }, durationSeconds: 20 };
    const endpoint = (
        cue: Cue,
        duration = 10,
        s: AudioClipMetadata | null = sheet,
    ): CueResolution => resolveCue(cue, { sheet: s, duration, role: 'endpoint' });

    it('resolves a raw number within range', () => {
        expect(endpoint(3)).toEqual({ kind: 'resolved', seconds: 3 });
    });

    it('clamps a negative endpoint number to 0 silently', () => {
        expect(endpoint(-2)).toEqual({ kind: 'resolved', seconds: 0 });
    });

    it('clamps an endpoint number beyond duration to duration silently', () => {
        expect(endpoint(15)).toEqual({ kind: 'resolved', seconds: 10 });
    });

    it('resolves "start" to 0 and "end" to duration', () => {
        expect(endpoint('start')).toEqual({ kind: 'resolved', seconds: 0 });
        expect(endpoint('end')).toEqual({ kind: 'resolved', seconds: 10 });
    });

    it('resolves a present { name } clamped into [0, duration]', () => {
        // late = 12 in the sheet, buffer duration = 10 → clamps to 10.
        expect(endpoint({ name: 'late' })).toEqual({ kind: 'resolved', seconds: 10 });
        expect(endpoint({ name: 'chorus' })).toEqual({ kind: 'resolved', seconds: 5 });
    });

    it('degrades an absent { name } to duration with no abandon and no warning', () => {
        expect(endpoint({ name: 'missing' })).toEqual({ kind: 'resolved', seconds: 10 });
    });

    it('NEVER returns abandon for any cue form (parametrized sweep)', () => {
        const forms: readonly Cue[] = [
            3,
            -2,
            15,
            NaN,
            'start',
            'end',
            { name: 'chorus' },
            { name: 'missing' },
        ];
        for (const form of forms) {
            expect(endpoint(form).kind).toBe('resolved');
        }
    });
});

// ─── resolveCueWindow (dynamic tier: window | abandon | dropped) ─────────────────

describe('resolveCueWindow', () => {
    const win = (from: Cue, to: Cue, duration = 10, sheet: AudioClipMetadata | null = null) =>
        resolveCueWindow(from, to, { sheet, duration });

    it('returns a window (start / end / durationSeconds) for a valid from < to pair', () => {
        expect(win(2, 6)).toEqual({
            kind: 'window',
            startSeconds: 2,
            endSeconds: 6,
            durationSeconds: 4,
        });
    });

    it('clamps both bounds into [0, duration] and still yields a window', () => {
        expect(win(-5, 15)).toEqual({
            kind: 'window',
            startSeconds: 0,
            endSeconds: 10,
            durationSeconds: 10,
        });
    });

    it('abandons, propagating the from-warning, when from is unresolvable', () => {
        const sheet: AudioClipMetadata = { durationSeconds: 10 };
        const result = win({ name: 'noStart' }, 6, 10, sheet);
        expect(result.kind).toBe('abandon');
        if (result.kind === 'abandon') {
            expect(result.warning).toContain('noStart');
        }
    });

    it('drops the window (playback continues) when end <= start after clamping', () => {
        // NOTE: a both-raw-finite reversed pair is the STATIC-reject case in the
        // real playback path — the AudioManager runs that synchronous gate BEFORE
        // calling resolveCueWindow. In isolation the dynamic resolver simply drops.
        const result = win(8, 3);
        expect(result.kind).toBe('dropped');
        if (result.kind === 'dropped') {
            expect(typeof result.warning).toBe('string');
            expect(result.warning.length).toBeGreaterThan(0);
        }
    });

    it('drops a zero-length window (start === end)', () => {
        expect(win(5, 5).kind).toBe('dropped');
    });

    it('short-circuits: a from-abandon yields exactly abandon, not also a drop', () => {
        const sheet: AudioClipMetadata = { durationSeconds: 10 };
        // from unresolvable AND to unresolvable — must abandon on `from` (naming
        // it), never fall through to resolve `to` or emit a second/drop warning.
        const result = win({ name: 'badFrom' }, { name: 'badTo' }, 10, sheet);
        expect(result.kind).toBe('abandon');
        if (result.kind === 'abandon') {
            expect(result.warning).toContain('badFrom');
            expect(result.warning).not.toContain('badTo');
        }
    });

    it('does not throw and returns a discriminated union for extreme inputs', () => {
        expect(() => win(Number.MAX_VALUE, -Number.MAX_VALUE)).not.toThrow();
        expect(win(Number.MAX_VALUE, -Number.MAX_VALUE)).toHaveProperty('kind');
    });

    it('does not mutate the input sheet or ctx', () => {
        const sheet: AudioClipMetadata = Object.freeze({
            cues: Object.freeze({ a: 2 }),
            durationSeconds: 10,
        });
        const ctx = Object.freeze({ sheet, duration: 10 });
        expect(() => resolveCueWindow({ name: 'a' }, 6, ctx)).not.toThrow();
        expect(sheet).toEqual({ cues: { a: 2 }, durationSeconds: 10 });
    });

    it('has a window | abandon | dropped result union with readonly seconds', () => {
        expectTypeOf(win(2, 6)).toEqualTypeOf<CueWindowResolution>();
    });
});
