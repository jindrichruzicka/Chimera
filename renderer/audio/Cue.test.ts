/**
 * renderer/audio/Cue.test.ts
 *
 * Type-level tests for the renderer-side cue / fade vocabulary: `Cue`,
 * `FadeCurve`, `FadeInSpec`, `LoopRegion`, the `FadeOutSpec` union, `FadeToSpec`,
 * and `CrossfadeOptions`. These are the renderer's authoring surface for
 * play-from-cue, play-to-cue, loop points, fades, and crossfade.
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * Invariants upheld:
 *   #124 — `AudioCueName` is DEFINED sim-side
 *     (`simulation/foundation/audio-cue-sheet.ts`) and flows sim → renderer, never
 *     the reverse. `Cue` type-imports it here; nothing in `simulation/`/`ai/`
 *     imports back from `renderer/`.
 *
 * Written test-first: this is a type-only surface, so the meaningful red is at
 * the `tsc` layer — the `expectTypeOf`/`@ts-expect-error` assertions below fail
 * typecheck when the source types are missing or wrong. vitest alone cannot see
 * it, because `import type` is erased and `expectTypeOf(...)` is a runtime no-op.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { AudioCueName } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import type { PlayOptions } from './AudioManager';
import type {
    Cue,
    FadeCurve,
    FadeInSpec,
    LoopRegion,
    FadeOutSpec,
    FadeToSpec,
    CrossfadeOptions,
} from './Cue.js';

// ─── Cue ──────────────────────────────────────────────────────────────────────

describe('Cue', () => {
    it('accepts a raw number, "start", "end", and a { name } form', () => {
        const seconds: Cue = 1.5;
        const start: Cue = 'start';
        const end: Cue = 'end';
        const named: Cue = { name: 'chorus' };

        expect([seconds, start, end, named]).toHaveLength(4);
    });

    it('rejects a string literal that is neither "start" nor "end"', () => {
        // @ts-expect-error: 'middle' is not a valid symbolic cue bound
        const bad: Cue = 'middle';
        expect(bad).toBe('middle');
    });

    it('carries a readonly AudioCueName on the { name } form', () => {
        const named: Extract<Cue, { name: AudioCueName }> = { name: 'intro' };
        expectTypeOf(named.name).toEqualTypeOf<AudioCueName>();
        expect(named.name).toBe('intro');

        // @ts-expect-error: Cue's { name } is readonly (compile-time only)
        named.name = 'outro';
        expect(named).toBeDefined();
    });
});

// ─── FadeCurve ──────────────────────────────────────────────────────────────────

describe('FadeCurve', () => {
    it('pins linear | exponential | equalPower', () => {
        expectTypeOf<FadeCurve>().toEqualTypeOf<'linear' | 'exponential' | 'equalPower'>();

        const curve: FadeCurve = 'equalPower';
        expect(curve).toBe('equalPower');
    });

    it('rejects an unknown curve name', () => {
        // @ts-expect-error: 'sine' is not a supported fade curve
        const bad: FadeCurve = 'sine';
        expect(bad).toBe('sine');
    });
});

// ─── FadeInSpec ─────────────────────────────────────────────────────────────────

describe('FadeInSpec', () => {
    it('requires durationMs, treats curve as optional, and is readonly', () => {
        const spec: FadeInSpec = { durationMs: 500 };
        expect(spec.durationMs).toBe(500);

        const withCurve: FadeInSpec = { durationMs: 500, curve: 'exponential' };
        expect(withCurve.curve).toBe('exponential');

        // @ts-expect-error: durationMs is required
        const missing: FadeInSpec = { curve: 'linear' };
        expect(missing).toBeDefined();

        // @ts-expect-error: FadeInSpec.durationMs is readonly
        spec.durationMs = 10;
        expect(spec).toBeDefined();
    });
});

// ─── LoopRegion ─────────────────────────────────────────────────────────────────

describe('LoopRegion', () => {
    it('has readonly start and end Cues', () => {
        const region: LoopRegion = { start: { name: 'loopStart' }, end: { name: 'loopEnd' } };
        expectTypeOf<LoopRegion>().toMatchTypeOf<{ readonly start: Cue; readonly end: Cue }>();

        // @ts-expect-error: LoopRegion.start is readonly
        region.start = 0;
        expect(region.end).toEqual({ name: 'loopEnd' });
    });
});

// ─── FadeOutSpec (discriminated union) ──────────────────────────────────────────

describe('FadeOutSpec', () => {
    it('accepts the { overMs } variant', () => {
        const spec: FadeOutSpec = { overMs: 300, curve: 'linear' };
        expect(spec).toHaveProperty('overMs', 300);
    });

    it('accepts the { toCue } variant', () => {
        const spec: FadeOutSpec = { toCue: { name: 'outro' } };
        expect(spec).toHaveProperty('toCue');
    });

    it('accepts the { toEnd: true } variant', () => {
        const spec: FadeOutSpec = { toEnd: true };
        expect(spec).toHaveProperty('toEnd', true);
    });

    it('rejects an empty object (no variant selected)', () => {
        // @ts-expect-error: FadeOutSpec requires one of overMs | toCue | toEnd
        const bad: FadeOutSpec = {};
        expect(bad).toBeDefined();
    });

    it('requires toEnd to be the literal true, not boolean', () => {
        // @ts-expect-error: toEnd must be literal true
        const bad: FadeOutSpec = { toEnd: false };
        expect(bad).toBeDefined();
    });

    it('rejects a variant carrying an unknown key', () => {
        // Note: mixing keys across variants (e.g. { overMs, toCue }) is NOT caught
        // — union excess-property checking only flags a key absent from EVERY
        // member. A key in no member (below) is the reliably-rejected case.
        // @ts-expect-error: `nonsense` is not a member of any FadeOutSpec variant
        const bad: FadeOutSpec = { overMs: 100, nonsense: true };
        expect(bad).toBeDefined();
    });
});

// ─── FadeToSpec ─────────────────────────────────────────────────────────────────

describe('FadeToSpec', () => {
    it('requires to and durationMs, treats curve as optional', () => {
        const spec: FadeToSpec = { to: 0.3, durationMs: 800 };
        expect(spec.to).toBe(0.3);

        // @ts-expect-error: `to` is required
        const missing: FadeToSpec = { durationMs: 800 };
        expect(missing).toBeDefined();
    });
});

// ─── CrossfadeOptions ───────────────────────────────────────────────────────────

describe('CrossfadeOptions', () => {
    it('requires durationMs and admits the current PlayOptions keys', () => {
        const opts: CrossfadeOptions = {
            durationMs: 2000,
            bus: 'music',
            loop: true,
            volume: 0.8,
            priority: 10,
            curve: 'equalPower',
        };
        expect(opts.durationMs).toBe(2000);

        // @ts-expect-error: durationMs is required
        const missing: CrossfadeOptions = { bus: 'music' };
        expect(missing).toBeDefined();
    });

    it('is assignable to Omit<PlayOptions, "fadeIn"> (tracks PlayOptions forward)', () => {
        // NOTE(later): once PlayOptions gains `fadeIn`, add a `@ts-expect-error`
        // pin that CrossfadeOptions rejects it. Today `Omit<…,'fadeIn'>` is a
        // legal no-op (PlayOptions has no fadeIn yet), so such a pin would be
        // vacuous — deferred to the PlayOptions-extension task.
        expectTypeOf<CrossfadeOptions>().toMatchTypeOf<Omit<PlayOptions, 'fadeIn'>>();
    });
});
