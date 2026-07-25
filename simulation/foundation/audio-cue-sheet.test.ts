/**
 * simulation/foundation/audio-cue-sheet.test.ts
 *
 * Type-level and runtime unit tests for the sim-side audio cue-sheet vocabulary:
 * `AudioCueName`, `WellKnownAudioCueName`, and `AudioClipMetadata`. These names
 * are the authoring vocabulary games use to attach cue sheets to audio clips.
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * Invariants upheld:
 *   #124 — `AudioCueName`/`AudioClipMetadata` are DEFINED sim-side
 *     (`simulation/foundation/audio-cue-sheet.ts`) and flow sim → renderer, never
 *     the reverse; the cue sheet rides `AssetManifestEntry.metadata`, which stays
 *     typed `unknown` (opaque to `simulation/`/`ai/`, extends #20). This test
 *     pins the names as sim-exported and pins `metadata` as still `unknown`.
 *   §3 Module Boundary — `simulation/foundation/` is the zero-dependency engine
 *     leaf. The source module imports nothing; this test type-imports only the
 *     module under test and the sibling `simulation/content` manifest type (an
 *     intra-package, cycle-free edge).
 *
 * Written test-first: for this type-only module the meaningful red is at the
 * type layer, not the runtime one. The `expectTypeOf`/`@ts-expect-error`
 * assertions below fail `tsc` when the source types are missing or wrong;
 * vitest alone cannot see it, because `import type` is erased and
 * `expectTypeOf(...)` is a runtime no-op.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { AudioCueName, WellKnownAudioCueName, AudioClipMetadata } from './audio-cue-sheet.js';
import type { AssetManifestEntry } from '../content/AssetManifest.js';

// ─── AudioCueName ─────────────────────────────────────────────────────────────

describe('AudioCueName', () => {
    it('is the open string alias games author cue names with', () => {
        expectTypeOf<AudioCueName>().toEqualTypeOf<string>();

        const name: AudioCueName = 'myCustomCue';
        expect(name).toBe('myCustomCue');
    });
});

// ─── WellKnownAudioCueName ────────────────────────────────────────────────────

describe('WellKnownAudioCueName', () => {
    it('pins the four conventional cue names', () => {
        expectTypeOf<WellKnownAudioCueName>().toEqualTypeOf<
            'intro' | 'loopStart' | 'loopEnd' | 'outro'
        >();

        const name: WellKnownAudioCueName = 'loopStart';
        expect(name).toBe('loopStart');
    });

    it('is a subset of the open AudioCueName type', () => {
        expectTypeOf<WellKnownAudioCueName>().toMatchTypeOf<AudioCueName>();
    });

    it('rejects a name outside the conventional set at compile time', () => {
        // @ts-expect-error: 'chorus' is not a well-known cue name
        const name: WellKnownAudioCueName = 'chorus';
        expect(name).toBe('chorus');
    });
});

// ─── AudioClipMetadata ────────────────────────────────────────────────────────

describe('AudioClipMetadata', () => {
    it('accepts a well-formed sheet (cues map + defaultLoopRegion tuple + durationSeconds)', () => {
        const sheet: AudioClipMetadata = {
            cues: { intro: 0, loopStart: 1.5, loopEnd: 42, outro: 44 },
            defaultLoopRegion: ['loopStart', 'loopEnd'],
            durationSeconds: 45,
        };

        expect(sheet).toBeDefined();
        expect(sheet.cues?.['loopStart']).toBe(1.5);
        expect(sheet.defaultLoopRegion).toEqual(['loopStart', 'loopEnd']);
        expect(sheet.durationSeconds).toBe(45);
    });

    it('type-checks a partial sheet (every field is optional at the type level)', () => {
        const empty: AudioClipMetadata = {};
        expect(empty).toEqual({});

        // Structural pin: cues maps names → seconds.
        expectTypeOf<AudioClipMetadata>().toMatchTypeOf<{
            readonly cues?: Readonly<Record<string, number>>;
        }>();
    });

    it('requires cue seconds to be numbers', () => {
        const bad: AudioClipMetadata = {
            cues: {
                // @ts-expect-error: cue seconds must be a number, not a string
                intro: 'zero',
            },
        };
        expect(bad).toBeDefined();
    });

    it('requires defaultLoopRegion to be a two-element tuple', () => {
        const bad: AudioClipMetadata = {
            // @ts-expect-error: defaultLoopRegion must be a [start, end] two-tuple
            defaultLoopRegion: ['loopStart'],
        };
        expect(bad).toBeDefined();
    });

    it('exposes readonly fields (a sheet cannot be reassigned in place)', () => {
        const sheet: AudioClipMetadata = { durationSeconds: 12 };
        // @ts-expect-error: AudioClipMetadata.durationSeconds is readonly
        sheet.durationSeconds = 5;
        expect(sheet).toBeDefined();
    });
});

// ─── AssetManifestEntry.metadata stays `unknown` (anti-rot, #124 / #20) ────────

describe('AssetManifestEntry.metadata (opaque slot the cue sheet rides on)', () => {
    it('is still typed `unknown` — the cue sheet must ride the opaque slot unchanged', () => {
        expectTypeOf<AssetManifestEntry['metadata']>().toEqualTypeOf<unknown>();
    });

    it('accepts any value — narrowing `metadata` away from `unknown` would break this', () => {
        // A symbol is assignable to `unknown` but not to `AudioClipMetadata` (or
        // `object`/`Record<…>`). If `metadata` is ever narrowed, this stops
        // compiling — the whole point of keeping the slot opaque (Invariant #124).
        const slot: AssetManifestEntry['metadata'] = Symbol('opaque');
        expect(typeof slot).toBe('symbol');

        // A well-formed cue sheet also rides the same opaque slot.
        const sheet: AudioClipMetadata = { durationSeconds: 3 };
        const asMetadata: AssetManifestEntry['metadata'] = sheet;
        expect(asMetadata).toBe(sheet);
    });
});
