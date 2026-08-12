/**
 * renderer/animation/ClipBackend.test.ts
 *
 * Unit tests for the runtime code in the clip-backend seam: the narrowing guard
 * `supportsBlending` and the argument refusals the seam owns.
 * Everything else in `ClipBackend.ts` is an interface, held by the conforming
 * double below — a shape error there is a `pnpm typecheck` failure, not an
 * assertion failure, which is the only gate a type has.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * The guard exists because blending is the one capability the two planned
 * backends do NOT share: a mesh mixer crossfades between actions, while a sprite
 * atlas has nothing to interpolate. Making it a separate interface plus a
 * narrowing guard is what keeps `ClipBackend` honest — the alternative, a
 * `crossfadeTo` on the base interface that one implementation throws from, is
 * exactly the LSP violation the seam is shaped to avoid.
 */

import { describe, expect, it } from 'vitest';

import type { AnimationLoopMode } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import {
    checkedFade,
    checkedLoopMode,
    checkedPlaybackSpeed,
    supportsBlending,
} from './ClipBackend.js';
import type {
    ClipBackend,
    ClipPlayback,
    ClipPlayOptions,
    PlayheadSample,
    SupportsClipBlending,
} from './ClipBackend.js';
import {
    createBlendingFakeClipBackend,
    createFakeClipBackend,
} from './__test-support__/fakeClipBackend.js';

/** A playback double; the sample it returns is fixed and never read for its value here. */
const playback: ClipPlayback = {
    clipName: 'swing',
    sample: (): PlayheadSample => ({ phase: 0, cycle: 0, ended: false }),
    setSpeed: () => undefined,
    stop: () => undefined,
};

/** Both option fields, so the shape is named somewhere rather than only declared. */
const options: ClipPlayOptions = { loop: 'once', speed: 1 };

/** A backend that cannot blend — the sprite shape. Conformance is held by tsc. */
const plainBackend: ClipBackend = {
    getDurationSeconds: () => 2,
    play: (_clipName, playOptions) => (playOptions?.loop === 'once' ? playback : null),
    advance: () => undefined,
    dispose: () => undefined,
};

/** A backend that can — the mesh shape. */
const blendingBackend: SupportsClipBlending = {
    ...plainBackend,
    crossfadeTo: () => playback,
};

describe('supportsBlending', () => {
    it('accepts a backend that declares crossfadeTo', () => {
        expect(supportsBlending(blendingBackend)).toBe(true);
    });

    it('refuses a backend that declares none', () => {
        expect(supportsBlending(plainBackend)).toBe(false);
    });

    it('refuses a backend whose crossfadeTo is present but not callable', () => {
        // The property test rather than the `in` test: a backend carrying
        // `crossfadeTo: undefined` — which `exactOptionalPropertyTypes` does not
        // stop a plain object literal from producing through a spread — would
        // pass an `in` check and then throw at the call site.
        const notCallable = { ...plainBackend, crossfadeTo: undefined } as unknown as ClipBackend;

        expect(supportsBlending(notCallable)).toBe(false);
    });

    it('tells the two shipped doubles apart', () => {
        // The doubles the rest of the suite runs against, rather than the hand
        // written literals above: with only a blending one in the repo, a guard
        // that answered `true` unconditionally would pass everything that uses
        // it, so the plain fake is the negative control that keeps the conjunct
        // killable.
        const specs = { attack: { durationSeconds: 1 } };

        expect(supportsBlending(createBlendingFakeClipBackend(specs))).toBe(true);
        expect(supportsBlending(createFakeClipBackend(specs))).toBe(false);
    });

    it('narrows the backend type for the caller', () => {
        // The reason the guard is a type predicate and not a boolean helper: the
        // call below does not compile unless the narrowing happened. It passes
        // `options` so `ClipPlayOptions` is constructed by something, not merely
        // declared — a field removed from it would otherwise fail no gate.
        const backend: ClipBackend = blendingBackend;

        expect(supportsBlending(backend) ? backend.crossfadeTo('swing', 0.2, options) : null).toBe(
            playback,
        );
        expect(backend.play('swing', options)).toBe(playback);
        expect(backend.play('swing', { loop: 'loop' })).toBeNull();
    });
});

describe('the blending fake', () => {
    const specs = { attack: { durationSeconds: 1 }, idle: { durationSeconds: 1 } };

    it('starts the incoming clip and releases every other live playback', () => {
        const backend = createBlendingFakeClipBackend(specs);
        const outgoing = backend.play('attack', { loop: 'loop' });
        backend.advance(0.4);

        const incoming = backend.crossfadeTo('idle', 0.2, { loop: 'loop' });

        expect(incoming?.clipName).toBe('idle');
        expect(backend.stopped).toEqual(['attack']);
        expect(backend.sampleOf('attack')).toBeNull();
        // Released, not forgotten: the handle still answers where it was, which
        // is what a caller reads a terminal playhead out of.
        expect(outgoing?.sample().phase).toBeCloseTo(0.4, 12);
        expect(backend.sampleOf('idle')).toEqual({ phase: 0, cycle: 0, ended: false });
    });

    it('releases every other live playback, including a second one of the same clip', () => {
        const backend = createBlendingFakeClipBackend(specs);
        const first = backend.play('attack', { loop: 'loop' });
        const second = backend.play('attack', { loop: 'loop' });
        backend.advance(0.25);

        backend.crossfadeTo('idle', 0.2, { loop: 'loop' });

        // The fake it wraps keeps both playbacks of a clip live, so a ledger
        // keyed by clip name would release `second` and leave `first`
        // integrating for the rest of the test.
        expect(backend.stopped).toEqual(['attack', 'attack']);
        expect(first?.sample().phase).toBeCloseTo(0.25, 12);
        expect(second?.sample().phase).toBeCloseTo(0.25, 12);
        backend.advance(0.25);
        expect(first?.sample().phase).toBeCloseTo(0.25, 12);
    });

    it('records what it was asked, after the fade was accepted', () => {
        const backend = createBlendingFakeClipBackend(specs);

        backend.crossfadeTo('attack', 0.25, { loop: 'loop', speed: 2 });
        backend.crossfadeTo('idle', 0);

        expect(backend.crossfadeCalls).toEqual([
            { clipName: 'attack', fadeSeconds: 0.25, options: { loop: 'loop', speed: 2 } },
            { clipName: 'idle', fadeSeconds: 0, options: undefined },
        ]);
    });

    it('refuses a bad fade and fails soft on a clip it does not have', () => {
        const backend = createBlendingFakeClipBackend(specs);

        expect(() => backend.crossfadeTo('attack', -1)).toThrow(RangeError);
        expect(() => backend.crossfadeTo('no-such-clip', Number.NaN)).toThrow(RangeError);
        expect(backend.crossfadeTo('no-such-clip', 0.2)).toBeNull();
        // Nothing was started or recorded by any of the three.
        expect(backend.crossfadeCalls).toEqual([]);
        expect(backend.sampleOf('attack')).toBeNull();
    });

    it('keeps its ledgers live rather than snapshotting the ones it wraps', () => {
        const backend = createBlendingFakeClipBackend(specs);

        backend.advance(0.1);
        backend.dispose();

        // A `{ ...base }` would have frozen each getter's value at construction,
        // and every ledger below would read empty for the whole test.
        expect(backend.advanceCalls).toEqual([0.1]);
        expect(backend.disposeCalls).toBe(1);
    });
});

describe('checkedPlaybackSpeed', () => {
    it.each([0, 0.25, 1, 100, Number.MAX_VALUE])('accepts the usable multiplier %s', (value) => {
        expect(checkedPlaybackSpeed(value, 'clip speed')).toBe(value);
    });

    it.each([-0.0001, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'refuses %s',
        (value) => {
            expect(() => checkedPlaybackSpeed(value, 'clip speed')).toThrow(RangeError);
        },
    );

    it('never clamps a large multiplier, because the one ceiling is on the product', () => {
        // A second ceiling here would be invisible behind `effectiveClipSpeed`'s
        // and would silently change what a large clip speed times a small player
        // speed comes to.
        expect(checkedPlaybackSpeed(1e6, 'clip speed')).toBe(1e6);
    });

    it('names the layer that was written, so three of them are distinguishable', () => {
        expect(() => checkedPlaybackSpeed(-1, 'player speed')).toThrow(/^player speed must be/u);
        expect(() => checkedPlaybackSpeed(-1, 'clip speed')).toThrow(/^clip speed must be/u);
    });
});

describe('checkedFade', () => {
    it('accepts a zero-length fade, the seam spelling of a cut', () => {
        // The boundary is an explicit fixture rather than something the refusal
        // cases imply by omission: 0 is the one fade length a caller writes to
        // mean "no blend at all", and a `value <= 0` refusal would fail it.
        expect(checkedFade(0)).toBe(0);
    });

    it.each([0.05, 0.2, 1, 30])('accepts the usable fade length %s', (value) => {
        expect(checkedFade(value)).toBe(value);
    });

    it.each([-0.2, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'refuses %s',
        (value) => {
            expect(() => checkedFade(value)).toThrow(RangeError);
        },
    );
});

describe('checkedLoopMode', () => {
    it.each(['once', 'loop'] as const)('accepts the authored mode %s', (mode) => {
        expect(checkedLoopMode(mode)).toBe(mode);
    });

    it.each(['pingpong', 'PingPong', 'Once', '', 'repeat'])(
        'refuses %s, which no backend maps',
        (mode) => {
            // Only reachable from unsound data — `AnimationLoopMode` spells two
            // values — and a fall-through to a default would silently decide
            // whether a clip ever ends.
            expect(() => checkedLoopMode(mode as AnimationLoopMode)).toThrow(RangeError);
        },
    );
});
