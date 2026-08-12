/**
 * renderer/animation/__test-support__/clipBackendContract.ts
 *
 * The {@link ClipBackend} conformance suite: one `describe` block, called from
 * `MeshClipBackend.test.ts` and `SpriteClipBackend.test.ts`, so substitutability
 * is a suite that executes rather than a table someone keeps up to date.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **What the fixture owes the suite.** One clip the backend can play, its exact
 * length, and a way to release whatever the FIXTURE allocated. Every delta below
 * is expressed as a fraction of that length, so a one-second mesh clip and a
 * half-second sprite run take the same code path. The suite calls
 * {@link ClipBackend.dispose} itself before {@link ClipBackendFixture.release},
 * which is the order a caller uses. Whether a backend releases something it did
 * NOT allocate is not a property this suite can see: the fixture's own
 * allocation is never observed here, and the negative control is
 * per-implementation — the sprite one is `releases only what it allocated: the
 * injected geometry survives dispose`, in `SpriteClipBackend.test.ts`.
 *
 * **`stop()` is terminal, and that is what "returns the last sample" pins.** A
 * stopped playback's frozen sample keeps its `phase` and `cycle` and reports
 * `ended: true`. The property is not that the whole record is byte-identical —
 * it is that the PLAYHEAD does not move, which is worth stating because
 * three.js's `AnimationAction.stop()` calls `reset()` and puts `action.time`
 * back to 0. A backend sampling its action after stopping it would report phase
 * 0 for a clip that was halfway through.
 */

import { describe, expect, it } from 'vitest';

import type {
    AnimationClipName,
    AnimationLoopMode,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { supportsBlending } from '../ClipBackend.js';
import type {
    ClipBackend,
    ClipPlayOptions,
    ClipPlayback,
    SupportsClipBlending,
} from '../ClipBackend.js';

/** Everything the suite needs to drive one implementation. */
export interface ClipBackendFixture {
    /** The implementation under test, with nothing playing yet. */
    readonly backend: ClipBackend;
    /** A clip {@link ClipBackend.play} accepts in both loop modes. */
    readonly clipName: AnimationClipName;
    /** That clip's exact length, as {@link ClipBackend.getDurationSeconds} reports it. */
    readonly durationSeconds: number;
    /**
     * Whether this implementation blends. Declared by the fixture rather than
     * read off the backend, so the claim below is two-sided: one implementation
     * says `true` and the other says `false`, and a `supportsBlending` that
     * always answered one of them fails on the other side.
     */
    readonly blends: boolean;
    /**
     * Release what the FIXTURE allocated — a geometry, a root, a mixer. Runs
     * after the backend's own `dispose`, never instead of it.
     */
    release(): void;
}

/**
 * Deltas no backend may integrate. `0` is in here as well as in its own property
 * because the ignore path and the no-op path are the same line of code in both
 * implementations, and only one of the two names it.
 */
const IGNORED_DELTAS: readonly number[] = [
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.25,
    -1e9,
];

/**
 * Run the {@link ClipBackend} contract against `createFixture`.
 *
 * @param name           Names the `describe` block, so a failure says which
 *                       implementation broke the contract.
 * @param createFixture  Called once per case: every property starts from a
 *                       backend with nothing playing.
 */
export function describeClipBackend(name: string, createFixture: () => ClipBackendFixture): void {
    /** Run `assert` against a fresh fixture, disposing in the caller's order. */
    function withFixture(assert: (fixture: ClipBackendFixture) => void): void {
        const fixture = createFixture();
        try {
            assert(fixture);
        } finally {
            fixture.backend.dispose();
            fixture.release();
        }
    }

    /** `play`, refusing to continue on `null` — a fixture clip must be playable. */
    function started(
        fixture: ClipBackendFixture,
        options: ClipPlayOptions,
    ): [ClipPlayback, ClipBackendFixture] {
        const playback = fixture.backend.play(fixture.clipName, options);
        if (playback === null) {
            throw new Error(`fixture clip '${fixture.clipName}' is not playable on this backend`);
        }
        return [playback, fixture];
    }

    describe(`${name} satisfies the ClipBackend contract`, () => {
        it('agrees with supportsBlending about whether it can blend', () => {
            withFixture((fixture) => {
                // Both sides in one claim: the guard's answer and the presence of
                // a CALLABLE `crossfadeTo` must move together, so neither a
                // backend that grew one without declaring it nor a guard that
                // answered a constant survives across the two implementations.
                expect(supportsBlending(fixture.backend)).toBe(fixture.blends);
                expect(typeof (fixture.backend as Partial<SupportsClipBlending>).crossfadeTo).toBe(
                    fixture.blends ? 'function' : 'undefined',
                );
            });
        });

        it('answers its own clip and refuses one it does not have', () => {
            withFixture((fixture) => {
                expect(fixture.backend.getDurationSeconds(fixture.clipName)).toBe(
                    fixture.durationSeconds,
                );
                expect(fixture.backend.getDurationSeconds('no-such-clip')).toBeNull();
                expect(fixture.backend.play('no-such-clip')).toBeNull();
            });
        });

        it('ignores zero, non-finite and negative deltas instead of integrating them', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                fixture.backend.advance(fixture.durationSeconds * 0.4);
                const before = playback.sample();

                for (const delta of IGNORED_DELTAS) {
                    fixture.backend.advance(delta);
                    expect(playback.sample(), `after advance(${delta})`).toEqual(before);
                }
            });
        });

        it('keeps phase inside [0, 1] for every advance in a mixed sequence', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                const unit = fixture.durationSeconds;
                const deltas = [
                    0,
                    Number.NaN,
                    unit * 0.3,
                    -unit,
                    Number.POSITIVE_INFINITY,
                    unit * 0.9,
                    unit * 2.5,
                    unit * 1e-6,
                    unit,
                ];

                for (const delta of deltas) {
                    fixture.backend.advance(delta);
                    const { phase } = playback.sample();
                    expect(phase, `after advance(${delta})`).toBeGreaterThanOrEqual(0);
                    expect(phase, `after advance(${delta})`).toBeLessThanOrEqual(1);
                }
            });
        });

        it('never decreases cycle while a looping clip wraps', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                const cycles: number[] = [playback.sample().cycle];

                for (let step = 0; step < 8; step += 1) {
                    fixture.backend.advance(fixture.durationSeconds * 0.4);
                    cycles.push(playback.sample().cycle);
                }

                for (let index = 1; index < cycles.length; index += 1) {
                    expect(cycles[index], `step ${index}`).toBeGreaterThanOrEqual(
                        cycles[index - 1] ?? 0,
                    );
                }
                // The positive control: without it a backend that never counts a
                // wrap at all would satisfy "never decreases" vacuously.
                expect(cycles[cycles.length - 1] ?? 0).toBeGreaterThan(0);
            });
        });

        it('counts the wrap when a step of exactly one clip length lands back where it started', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });

                // The input Rule STEP-BOUNDED produces: `boundedStepSeconds`
                // clamps a step to exactly one clip length, and a playhead that
                // wrapped a whole cycle reports the phase it started from. A
                // backend reading the wrap out of a phase DECREASE alone is blind
                // at this one input, and the scheduler seated on it then sweeps
                // nothing — every mark in the clip is dropped for that frame.
                fixture.backend.advance(fixture.durationSeconds);

                const sample = playback.sample();
                expect(sample.cycle).toBe(1);
                expect(sample.phase).toBeCloseTo(0, 6);
                expect(sample.ended).toBe(false);
            });
        });

        it('counts every cycle a single oversized step crossed', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });

                fixture.backend.advance(fixture.durationSeconds * 2.5);

                const sample = playback.sample();
                expect(sample.cycle).toBe(2);
                expect(sample.phase).toBeCloseTo(0.5, 6);
            });
        });

        it('never reverts ended once it is true', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'once' });
                fixture.backend.advance(fixture.durationSeconds * 1.5);
                expect(playback.sample().ended).toBe(true);

                for (const delta of [0, fixture.durationSeconds, Number.NaN, -1]) {
                    fixture.backend.advance(delta);
                    expect(playback.sample().ended, `after advance(${delta})`).toBe(true);
                }
                playback.setSpeed(0);
                fixture.backend.advance(fixture.durationSeconds);
                expect(playback.sample().ended).toBe(true);
            });
        });

        it('treats advance(0) as a no-op', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                fixture.backend.advance(fixture.durationSeconds * 0.37);
                const before = playback.sample();

                fixture.backend.advance(0);
                fixture.backend.advance(0);

                expect(playback.sample()).toEqual(before);
            });
        });

        it('reports phase 1 and ended for a non-looping clip advanced far past its end', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'once' });

                fixture.backend.advance(fixture.durationSeconds * 4);
                fixture.backend.advance(fixture.durationSeconds * 100);

                const sample = playback.sample();
                expect(sample.phase).toBe(1);
                expect(sample.ended).toBe(true);
            });
        });

        it('keeps the last playhead after stop rather than resetting it', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                fixture.backend.advance(fixture.durationSeconds * 0.5);
                const last = playback.sample();

                playback.stop();
                const stopped = playback.sample();
                expect(stopped.phase).toBe(last.phase);
                expect(stopped.cycle).toBe(last.cycle);
                expect(stopped.ended).toBe(true);

                // Nothing moves it afterwards, and stopping again changes nothing.
                fixture.backend.advance(fixture.durationSeconds);
                expect(playback.sample()).toEqual(stopped);
                playback.stop();
                expect(playback.sample()).toEqual(stopped);
            });
        });

        it('freezes a held playback where it was and leaves it there', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                fixture.backend.advance(fixture.durationSeconds * 0.5);
                const last = playback.sample();

                playback.hold();

                // Terminal in exactly the way `stop` is — what differs is on
                // screen, which is per-implementation and asserted there.
                const held = playback.sample();
                expect(held.phase).toBe(last.phase);
                expect(held.cycle).toBe(last.cycle);
                expect(held.ended).toBe(true);

                fixture.backend.advance(fixture.durationSeconds);
                expect(playback.sample()).toEqual(held);
                playback.hold();
                expect(playback.sample()).toEqual(held);
                // A hold is still releasable, and releasing it moves nothing.
                playback.stop();
                expect(playback.sample()).toEqual(held);
            });
        });

        it('disposes twice without throwing and stays disposed', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                fixture.backend.advance(fixture.durationSeconds * 0.25);

                fixture.backend.dispose();
                const afterDispose = playback.sample();
                fixture.backend.dispose();

                // Terminal, not merely stable: disposing the backend released the
                // playback, and a handle that kept answering `ended: false` would
                // read as a clip still in flight on a backend that is gone.
                expect(afterDispose.ended).toBe(true);
                expect(playback.sample()).toEqual(afterDispose);
                fixture.backend.advance(fixture.durationSeconds);
                expect(playback.sample()).toEqual(afterDispose);
                expect(fixture.backend.play(fixture.clipName)).toBeNull();
            });
        });

        it('refuses a negative speed and freezes the playhead at zero', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });

                expect(() => {
                    playback.setSpeed(-1);
                }).toThrow(RangeError);

                playback.setSpeed(0);
                const frozen = playback.sample();
                fixture.backend.advance(fixture.durationSeconds * 0.75);
                expect(playback.sample()).toEqual(frozen);

                // And the freeze is a speed, not a terminal state: it thaws.
                playback.setSpeed(1);
                fixture.backend.advance(fixture.durationSeconds * 0.25);
                expect(playback.sample().phase).toBeGreaterThan(frozen.phase);
            });
        });

        it('refuses a loop mode it has no mapping for', () => {
            withFixture((fixture) => {
                // `AnimationLoopMode` spells only 'once' and 'loop', so this can
                // only arrive from unsound data — and a backend that fell through
                // to a default would decide silently whether a clip ever ends.
                expect(() =>
                    fixture.backend.play(fixture.clipName, {
                        loop: 'pingpong' as AnimationLoopMode,
                    }),
                ).toThrow(RangeError);
            });
        });

        it('still refuses a negative speed after the playback was released', () => {
            withFixture((fixture) => {
                const [playback] = started(fixture, { loop: 'loop' });
                fixture.backend.advance(fixture.durationSeconds * 0.5);
                const terminal = playback.sample();
                playback.stop();

                // A sign error is refused wherever it is written, not only while
                // the handle still drives something.
                expect(() => {
                    playback.setSpeed(-1);
                }).toThrow(RangeError);
                // And an accepted speed still changes nothing for a released handle.
                playback.setSpeed(4);
                fixture.backend.advance(fixture.durationSeconds);
                expect(playback.sample()).toEqual({ ...terminal, ended: true });
            });
        });
    });
}

/** What the blending arm needs on top of {@link ClipBackendFixture}. */
export interface BlendingClipBackendFixture extends ClipBackendFixture {
    /** The implementation under test, narrowed. */
    readonly backend: SupportsClipBlending;
    /**
     * A SECOND clip the backend can play, whose contribution is invisible to
     * {@link BlendingClipBackendFixture.posedValue}. Two clips driving the same
     * output would make every assertion below read one number for two
     * contributions, and "the outgoing clip is gone" would be unstateable.
     */
    readonly otherClipName: AnimationClipName;
    /**
     * What the backend is posing from {@link ClipBackendFixture.clipName} right
     * now, as one number — a bound node's coordinate, a written `uv`. Read
     * before anything is played, it is the resting value every case compares
     * against.
     */
    posedValue(): number;
}

/**
 * Run the {@link SupportsClipBlending} contract against `createFixture`.
 *
 * Separate from {@link describeClipBackend} because blending is the capability
 * the two backends do NOT share: a sprite atlas has nothing to interpolate, and
 * folding these cases into the base suite would make the shared contract
 * unsatisfiable by half its implementations.
 *
 * The load-bearing property is the one no unit test of a single method states:
 * a crossfaded-out playback is TERMINAL and still POSING at the same time — its
 * handle answers a frozen sample while its contribution is still on screen — and
 * `stop()` is what ends the second half.
 */
export function describeBlendingClipBackend(
    name: string,
    createFixture: () => BlendingClipBackendFixture,
): void {
    function withFixture(assert: (fixture: BlendingClipBackendFixture) => void): void {
        const fixture = createFixture();
        try {
            assert(fixture);
        } finally {
            fixture.backend.dispose();
            fixture.release();
        }
    }

    describe(`${name} satisfies the SupportsClipBlending contract`, () => {
        it('refuses a fade that is not a usable length, whatever clip it names', () => {
            withFixture((fixture) => {
                for (const fade of [-0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
                    expect(() => fixture.backend.crossfadeTo(fixture.clipName, fade)).toThrow(
                        RangeError,
                    );
                    // Refused BEFORE the fail-soft guard: an absent clip must not
                    // turn a caller's sign error into a `null`.
                    expect(() => fixture.backend.crossfadeTo('no-such-clip', fade)).toThrow(
                        RangeError,
                    );
                }
                expect(fixture.backend.crossfadeTo('no-such-clip', 0.2)).toBeNull();
            });
        });

        it('accepts a zero-length fade and cuts on it', () => {
            withFixture((fixture) => {
                const resting = fixture.posedValue();
                const outgoing = fixture.backend.play(fixture.clipName, { loop: 'loop' });
                if (outgoing === null) {
                    throw new Error(`fixture clip '${fixture.clipName}' is not playable`);
                }
                fixture.backend.advance(fixture.durationSeconds * 0.4);
                expect(fixture.posedValue()).not.toBe(resting);

                expect(fixture.backend.crossfadeTo(fixture.otherClipName, 0)).not.toBeNull();

                // Nothing of the outgoing clip is left: not a weight-0 action
                // still holding its binding, which is what a degenerate fade
                // produces, but a released one.
                expect(fixture.posedValue()).toBe(resting);
                expect(outgoing.sample().ended).toBe(true);
            });
        });

        it('keeps a crossfaded-out playback posing while its handle reports terminal', () => {
            withFixture((fixture) => {
                const resting = fixture.posedValue();
                const outgoing = fixture.backend.play(fixture.clipName, { loop: 'loop' });
                if (outgoing === null) {
                    throw new Error(`fixture clip '${fixture.clipName}' is not playable`);
                }
                fixture.backend.advance(fixture.durationSeconds * 0.4);
                const last = outgoing.sample();

                fixture.backend.crossfadeTo(fixture.otherClipName, fixture.durationSeconds, {
                    loop: 'loop',
                });

                // Terminal: the playhead is frozen where the blend started and
                // `ended` is latched, however far the backend is advanced.
                expect(outgoing.sample()).toEqual({ ...last, ended: true });
                fixture.backend.advance(fixture.durationSeconds * 0.1);
                expect(outgoing.sample()).toEqual({ ...last, ended: true });
                // …and still posing, which is the half a frozen sample hides.
                expect(fixture.posedValue()).not.toBe(resting);

                // `stop()` on a frozen handle is what cancels a blend. Without it
                // the action poses at a falling weight with no verb to end it.
                outgoing.stop();
                expect(fixture.posedValue()).toBe(resting);
                fixture.backend.advance(fixture.durationSeconds * 0.1);
                expect(fixture.posedValue()).toBe(resting);
            });
        });

        it('fades nothing out when the request names the clip already in flight', () => {
            const step = 0.25;
            const blended = createFixture();
            const plain = createFixture();
            try {
                for (const fixture of [blended, plain]) {
                    if (fixture.backend.play(fixture.clipName, { loop: 'loop' }) === null) {
                        throw new Error(`fixture clip '${fixture.clipName}' is not playable`);
                    }
                }
                blended.backend.crossfadeTo(blended.clipName, blended.durationSeconds, {
                    loop: 'loop',
                });

                // The same clip is not something to blend away from: a fade-out
                // of the action the request just took over would leave it
                // invisible, and a fade-IN would dissolve it out of the rest
                // pose. Either shows up as a pose the plain `play` does not have.
                blended.backend.advance(blended.durationSeconds * step);
                plain.backend.advance(plain.durationSeconds * step);
                expect(blended.posedValue()).toBe(plain.posedValue());
            } finally {
                for (const fixture of [blended, plain]) {
                    fixture.backend.dispose();
                    fixture.release();
                }
            }
        });

        it('leaves nothing posing once it is disposed', () => {
            withFixture((fixture) => {
                const resting = fixture.posedValue();
                fixture.backend.play(fixture.clipName, { loop: 'loop' });
                fixture.backend.advance(fixture.durationSeconds * 0.4);
                fixture.backend.crossfadeTo(fixture.otherClipName, fixture.durationSeconds, {
                    loop: 'loop',
                });

                fixture.backend.dispose();

                expect(fixture.posedValue()).toBe(resting);
            });
        });
    });
}
