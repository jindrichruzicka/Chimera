// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FadeControl, FadeSession } from '../shell/FadeContext.js';
import { useLoadingBeat, type LoadingBeat, type LoadingBeatOptions } from './useLoadingBeat.js';

const FADE_MS = 200;
const HOLD_MS = 5_000;

/**
 * A `FadeControl` double that records commands and settles them on the fake
 * clock, so a case can assert both WHAT the beat commanded and WHEN.
 *
 * `opacity` is a live field rather than a constant: the beat reads it to decide
 * whether a darkening leg is owed at all, and the faded lobby→game hop arrives
 * with it already at 1.
 */
function makeCurtain(initialOpacity = 0): FadeControl & {
    readonly calls: string[];
    setOpacity(next: number): void;
} {
    const calls: string[] = [];
    let opacity = initialOpacity;

    const settle = (target: number, durationMs: number): Promise<void> => {
        if (durationMs <= 0) {
            opacity = target;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            globalThis.setTimeout(() => {
                opacity = target;
                resolve();
            }, durationMs);
        });
    };

    const control = {
        phase: 'idle' as const,
        get opacity(): number {
            return opacity;
        },
        setPhase: () => undefined,
        fadeOut: (durationMs = 0): Promise<void> => {
            calls.push('fadeOut');
            return settle(1, durationMs);
        },
        fadeIn: (durationMs = 0): Promise<void> => {
            calls.push('fadeIn');
            return settle(0, durationMs);
        },
        claim: (): FadeSession => ({
            isActive: true,
            fadeOut: (durationMs = 0) => control.fadeOut(durationMs),
            fadeIn: (durationMs = 0) => control.fadeIn(durationMs),
        }),
        calls,
        setOpacity: (next: number): void => {
            opacity = next;
        },
    };
    return control;
}

function baseOptions(overrides: Partial<LoadingBeatOptions> = {}): LoadingBeatOptions {
    return {
        curtain: null,
        active: true,
        declared: true,
        settled: false,
        holdMs: HOLD_MS,
        fadeMs: FADE_MS,
        ...overrides,
    };
}

function renderBeat(
    initial: LoadingBeatOptions,
    options: { reactStrictMode?: boolean } = {},
): ReturnType<typeof renderHook<ReturnType<typeof useLoadingBeat>, LoadingBeatOptions>> {
    return renderHook((props: LoadingBeatOptions) => useLoadingBeat(props), {
        initialProps: initial,
        ...options,
    });
}

/**
 * Advance the fake clock inside `act`, in steps.
 *
 * Stepped rather than one jump on purpose: each leg of the beat arms its timer
 * from the effect that runs after the PREVIOUS leg's state update commits, and
 * a single large advance drains the timer queue without giving React the
 * renders in between — the beat then appears to stall at whichever leg the jump
 * spanned.
 */
async function advance(ms: number): Promise<void> {
    const step = 50;
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
        });
    }
}

/** Let queued microtasks and effects settle without advancing the clock. */
async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

/**
 * Render the beat while recording what it reported on EVERY render.
 *
 * Polling `result.current` at instants cannot see a wrong value that is
 * corrected before the next sample — and a commit is paintable, so a
 * `revealed` frame that lasts one commit is exactly the defect. Recording from
 * inside the render is the only sampling that cannot miss it.
 */
function renderBeatRecording(
    initial: LoadingBeatOptions,
    seen: string[],
): ReturnType<typeof renderHook<LoadingBeat, LoadingBeatOptions>> {
    return renderHook(
        (props: LoadingBeatOptions) => {
            const beat = useLoadingBeat(props);
            seen.push(`${beat.phase}:${String(beat.revealed)}`);
            return beat;
        },
        { initialProps: initial },
    );
}

beforeEach(() => {
    // The hold's remainder is computed from a monotonic performance.now()
    // stamp, so the clock the stamp reads must advance with the timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useLoadingBeat', () => {
    it('runs the whole beat on a gate that settled before the first frame', async () => {
        // The defect the feature exists for, as one case: on fast hardware the
        // load is done before anything could be shown. A beat conditioned on
        // the wait still being live — F90's arming condition, or any
        // re-introduction of it — shows nothing here.
        const curtain = makeCurtain(1);
        const { result } = renderBeat(baseOptions({ curtain, settled: true }));

        await flush();
        expect(result.current.coverMounted).toBe(true);
        expect(result.current.revealed).toBe(false);

        await advance(FADE_MS);
        expect(result.current.phase).toBe('loading');

        // Margin past the last leg: the assertion is that the beat completes,
        // not that it lands on one particular tick.
        await advance(HOLD_MS + FADE_MS * 2 + 100);
        expect(result.current.phase).toBe('revealed');
        expect(result.current.revealed).toBe(true);
        expect(result.current.coverMounted).toBe(false);
    });

    it('holds the cover for the floor measured from full visibility, not from mount', async () => {
        // `shown` is the arming stamp, and the fade-in that precedes it is not
        // reading time. Stamping at mount would end the beat a whole fade
        // early — the player gets less than the floor to read the screen.
        const curtain = makeCurtain(1);
        const { result } = renderBeat(baseOptions({ curtain, settled: true }));

        await advance(FADE_MS);
        expect(result.current.phase).toBe('loading');

        await advance(HOLD_MS - 1);
        expect(result.current.phase).toBe('loading');

        await advance(1);
        expect(result.current.phase).toBe('loading-out');
    });

    it('waits for the gate when the load outlives the floor', async () => {
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: false, holdMs: 100 }),
        );

        await advance(FADE_MS + 100 + 50);
        expect(result.current.phase).toBe('loading');

        rerender(baseOptions({ curtain, settled: true, holdMs: 100 }));
        await flush();
        expect(result.current.phase).toBe('loading-out');
    });

    it('adds no release path of its own — an unsettled gate never reveals', async () => {
        // The multiplayer-adjacent guarantee: the beat defers a reveal, it does
        // not manufacture one. A timer that revealed without the gate would
        // show an empty scene.
        const curtain = makeCurtain(1);
        const { result } = renderBeat(baseOptions({ curtain, settled: false, holdMs: 10 }));

        await advance(60_000);

        expect(result.current.phase).toBe('loading');
        expect(result.current.revealed).toBe(false);
    });

    it('commands the curtain in the order black → cover → black → reveal', async () => {
        // The four legs, asserted as the command sequence rather than as
        // phases: a beat that revealed without darkening first would flash the
        // scene between the cover and the reveal.
        const curtain = makeCurtain(0);
        renderBeat(baseOptions({ curtain, settled: true, holdMs: 0, fadeMs: 0 }));

        await advance(50);

        expect(curtain.calls).toEqual(['fadeOut', 'fadeIn']);
    });

    it('skips the darkening leg when the curtain is already opaque', async () => {
        // The lobby→game hop: GameStoreBootstrap faded to black before
        // navigating, so a second fadeOut is a command with nothing to do.
        const curtain = makeCurtain(1);
        renderBeat(baseOptions({ curtain, settled: true, holdMs: 0, fadeMs: 0 }));

        await advance(50);

        expect(curtain.calls).toEqual(['fadeIn']);
    });

    it('reveals without mounting a cover when the cascade resolves no form', async () => {
        // A game that declared nothing keeps today's behaviour: black until
        // the gate settles, then one reveal.
        const curtain = makeCurtain(1);
        const { result } = renderBeat(
            baseOptions({ curtain, declared: false, settled: true, fadeMs: 0 }),
        );

        await advance(50);

        expect(result.current.coverMounted).toBe(false);
        expect(result.current.revealed).toBe(true);
        expect(curtain.calls).toEqual(['fadeIn']);
    });

    it('withholds the reveal of an undeclared beat until the gate settles', async () => {
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, declared: false, settled: false, fadeMs: 0 }),
        );

        await advance(50);
        expect(result.current.revealed).toBe(false);

        rerender(baseOptions({ curtain, declared: false, settled: true, fadeMs: 0 }));
        await flush();

        expect(result.current.revealed).toBe(true);
    });

    it('still mounts its cover when every duration is zero, arming no timer', async () => {
        // The e2e collapse. Nothing waits — no spec pays for a cosmetic timer —
        // but the cover still MOUNTS, which is the structure the recorded
        // reveal timeline reads once the durations are gone. Parked on an
        // unsettled gate, because with a settled one the whole beat completes
        // inside the first commit chain, which is the collapse working.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: false, holdMs: 0, fadeMs: 0 }),
        );

        await flush();
        expect(result.current.phase).toBe('loading');
        expect(result.current.coverMounted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);

        rerender(baseOptions({ curtain, settled: true, holdMs: 0, fadeMs: 0 }));
        await flush();

        expect(result.current.phase).toBe('revealed');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never moves a phase backwards', async () => {
        // Guards the whole machine against a re-entrant input flip: `settled`
        // going false again mid-beat (a manager rebuild) must not re-cover a
        // screen the player is already looking at.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: true, holdMs: 0, fadeMs: 0 }),
        );

        await advance(50);
        expect(result.current.phase).toBe('revealed');

        rerender(baseOptions({ curtain, settled: false, holdMs: 0, fadeMs: 0 }));
        await advance(50);

        expect(result.current.phase).toBe('revealed');
        expect(result.current.coverMounted).toBe(false);
    });

    it.each([
        ['darkening', { settled: false, fadeMs: FADE_MS, curtainOpacity: 0 }],
        ['covered', { settled: false, fadeMs: FADE_MS, curtainOpacity: 1 }],
        ['loading', { settled: false, fadeMs: 0, curtainOpacity: 1 }],
    ])('reveals on shortCircuit raised during %s', async (_phase, setup) => {
        // The check sits ahead of the phase switch, so it has to hold wherever
        // the beat happens to be — an abortable restore dialog cannot wait for
        // a leg to finish before it becomes reachable.
        const curtain = makeCurtain(setup.curtainOpacity);
        const options = (shortCircuit: boolean): LoadingBeatOptions =>
            baseOptions({ curtain, settled: setup.settled, fadeMs: setup.fadeMs, shortCircuit });

        const { result, rerender } = renderBeat(options(false));
        await flush();
        expect(result.current.revealed).toBe(false);

        rerender(options(true));
        await advance(FADE_MS * 2);

        expect(result.current.revealed).toBe(true);
        expect(result.current.coverMounted).toBe(false);
    });

    it('reveals immediately on shortCircuit and mounts no cover over the modal', async () => {
        // A save-restore parked mid-beat has to surface its abortable dialog,
        // which sits BELOW both the curtain and the cover.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(baseOptions({ curtain, settled: false }));

        await advance(FADE_MS);
        expect(result.current.coverMounted).toBe(true);

        rerender(baseOptions({ curtain, settled: false, shortCircuit: true }));
        await advance(FADE_MS);

        expect(result.current.revealed).toBe(true);
        expect(result.current.coverMounted).toBe(false);
    });

    it('does not replay the beat after a shortCircuit that ends unsettled', async () => {
        // The player has already seen the scene by then; a second tips screen
        // over a board they were reading is a regression, not a beat.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: false, shortCircuit: true }),
        );

        await advance(FADE_MS * 2);
        expect(result.current.revealed).toBe(true);

        rerender(baseOptions({ curtain, settled: false, shortCircuit: false }));
        await advance(HOLD_MS + FADE_MS * 3);

        expect(result.current.coverMounted).toBe(false);
    });

    it('issues no curtain command once suppressed', async () => {
        // A leave owns the screen from the moment it starts. The beat's next
        // leg would repaint what the leave blacked, and its `await` would
        // return mid-ramp.
        const curtain = makeCurtain(1);
        let suppressed = false;
        const options = (settled: boolean): LoadingBeatOptions =>
            baseOptions({
                curtain,
                settled,
                holdMs: 0,
                fadeMs: 0,
                isSuppressed: () => suppressed,
            });

        // Parked mid-beat on an unsettled gate, so the reveal is still owed
        // when the leave takes the screen — a beat already finished would pass
        // this without the suppressor doing anything.
        const { result, rerender } = renderBeat(options(false));
        await flush();
        expect(result.current.phase).toBe('loading');

        suppressed = true;
        rerender(options(true));
        await advance(50);

        expect(curtain.calls).not.toContain('fadeIn');
        expect(result.current.revealed).toBe(false);
    });

    it('mounts no cover while occluded', async () => {
        // A second beat under a route beat that has not revealed would floor a
        // cover nobody can see, which is the black-screen extension F90's
        // arming condition existed to prevent.
        //
        // Parked on an UNSETTLED gate on purpose: with a settled one the beat
        // runs to completion inside the first commit chain, so a final-state
        // read finds `coverMounted` false whether the cover was skipped or
        // merely already dropped — and the occlusion conjunct goes unmeasured.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: false, occluded: true, fadeMs: 0, holdMs: 0 }),
        );

        await advance(50);
        expect(result.current.coverMounted).toBe(false);
        expect(result.current.phase).toBe('covered');

        // The control: the same beat with nothing over it does cover.
        rerender(baseOptions({ curtain, settled: false, occluded: false, fadeMs: 0, holdMs: 0 }));
        await flush();
        expect(result.current.coverMounted).toBe(true);
    });

    it('never reports revealed once a leave takes the screen mid-reveal', async () => {
        // The reveal's fade resolves on its own promise and cannot be recalled,
        // so every phase the machine reports is asserted, not just the last
        // one: a stale resolution that lands and is corrected a commit later
        // still paints one frame of the scene over a screen the leave blacked.
        const curtain = makeCurtain(1);
        let suppressed = false;
        const seen: string[] = [];
        const options = (): LoadingBeatOptions =>
            baseOptions({
                curtain,
                declared: false,
                settled: true,
                fadeMs: FADE_MS,
                isSuppressed: () => suppressed,
            });

        const { result, rerender } = renderBeatRecording(options(), seen);
        await flush();
        expect(result.current.phase).toBe('revealing');

        suppressed = true;
        rerender(options());
        await advance(FADE_MS * 4);

        expect(result.current.phase).toBe('suppressed');
        expect(seen).not.toContain('revealed:true');
    });

    it('never reports revealed once the surface goes inactive mid-reveal', async () => {
        // The other owner of the same hazard, and the one the command effect
        // cannot correct: it returns at the inactive check before it reaches
        // the suppression check, so only the cleanup keeps the stale
        // resolution off an unmounted surface.
        const curtain = makeCurtain(1);
        const seen: string[] = [];

        const { result, rerender } = renderBeatRecording(
            baseOptions({ curtain, declared: false, settled: true, fadeMs: FADE_MS }),
            seen,
        );
        await flush();
        expect(result.current.phase).toBe('revealing');

        rerender(
            baseOptions({
                curtain,
                active: false,
                declared: false,
                settled: true,
                fadeMs: FADE_MS,
            }),
        );
        await advance(FADE_MS * 4);

        expect(result.current.phase).toBe('idle');
        expect(seen).not.toContain('revealed:true');
    });

    it('stays suppressed when the suppressor clears before the reveal fade lands', async () => {
        // The interleaving nothing else corrects: with the suppressor already
        // cleared, neither effect will move the machine off `revealed` if a
        // stale resolution puts it there — the beat ends revealed for good on a
        // screen it does not own. A zero-duration fixture cannot see this,
        // because there is no fade left in flight to land.
        const curtain = makeCurtain(1);
        let suppressed = false;
        const options = (): LoadingBeatOptions =>
            baseOptions({
                curtain,
                declared: false,
                settled: true,
                fadeMs: FADE_MS,
                isSuppressed: () => suppressed,
            });

        const { result, rerender } = renderBeat(options());
        await flush();
        expect(result.current.phase).toBe('revealing');

        suppressed = true;
        rerender(options());
        await flush();
        expect(result.current.phase).toBe('suppressed');

        // The leave finished and dropped its latch, while the beat's own fade
        // is still in flight.
        suppressed = false;
        rerender(options());
        await advance(FADE_MS * 3);

        expect(result.current.phase).toBe('suppressed');
        expect(result.current.revealed).toBe(false);
    });

    it('gives a re-activated beat its cover fade-in leg again', async () => {
        // The leg stamps are keyed on phase identity, which repeats across
        // activations. Left standing, the second activation measures its
        // fade-in against the first one's clock, finds it long expired, and
        // stamps the floor in the same commit that mounts the cover — the
        // mount-stamped hold this beat exists to avoid.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: false, fadeMs: FADE_MS }),
        );

        await flush();
        expect(result.current.phase).toBe('loading-in');

        rerender(baseOptions({ curtain, active: false, settled: false, fadeMs: FADE_MS }));
        await advance(1_000);
        expect(result.current.phase).toBe('idle');

        rerender(baseOptions({ curtain, settled: false, fadeMs: FADE_MS }));
        await flush();

        expect(result.current.phase).toBe('loading-in');

        // And it is a whole leg, not a remnant: a reset that left the stamp
        // partly spent would satisfy the assertion above and still cut the
        // fade-in short.
        await advance(FADE_MS - 50);
        expect(result.current.phase).toBe('loading-in');

        await advance(100);
        expect(result.current.phase).toBe('loading');
    });

    it('issues no command when the suppressor latches between the render and the flush', async () => {
        // The interleaving the ref read exists for, and the only one that
        // reaches it: the render computed `false`, so the condition effect will
        // let the beat proceed, and the latch flips before the command effect
        // runs. A beat that trusted the rendered value alone fades a screen a
        // leave has already taken.
        //
        // The flip rides an effect declared BEFORE the hook, because React runs
        // effects in declaration order — that is what lands it between the two.
        const curtain = makeCurtain(0);
        let latched = false;

        function Harness(): LoadingBeat {
            React.useEffect(() => {
                latched = true;
            });
            return useLoadingBeat(
                baseOptions({
                    curtain,
                    settled: true,
                    fadeMs: FADE_MS,
                    isSuppressed: () => latched,
                }),
            );
        }

        const { result } = renderHook(() => Harness());
        await advance(FADE_MS * 2);

        expect(curtain.calls).toEqual([]);
        expect(result.current.phase).toBe('suppressed');
    });

    it('leaves the reveal phase when the suppressor latches on the reveal render itself', async () => {
        // The command effect declines the command AND moves the phase. Only
        // the move is measured here: the render that entered `revealing`
        // computed `suppressed` as false, so the condition effect will not
        // revisit it, and no later render is coming. A guard that only
        // declined would park the beat at `revealing` reporting `revealed`
        // for good — on a fully opaque curtain, with no fade ever issued.
        const curtain = makeCurtain(1);
        let latched = false;
        const phaseSeen = { current: 'idle' as string };
        const latchedDuring: string[] = [];

        function Harness(): LoadingBeat {
            // Declared before the hook, so it runs before the command effect
            // and after the render that reported the phase below.
            React.useEffect(() => {
                if (phaseSeen.current === 'revealing') {
                    latched = true;
                    latchedDuring.push(phaseSeen.current);
                }
            });
            const beat = useLoadingBeat(
                baseOptions({
                    curtain,
                    declared: false,
                    settled: true,
                    fadeMs: FADE_MS,
                    isSuppressed: () => latched,
                }),
            );
            phaseSeen.current = beat.phase;
            return beat;
        }

        const { result } = renderHook(() => Harness());
        await advance(FADE_MS * 4);

        // Positive first: a beat suppressed back at `idle` would satisfy both
        // negatives below without ever reaching the phase under test, which is
        // how a harness like this goes quietly vacuous.
        expect(latchedDuring).toEqual(['revealing']);
        expect(result.current.phase).not.toBe('revealing');
        expect(curtain.calls).toEqual([]);
    });

    it('stops a beat parked mid-wait the moment the suppressor latches', async () => {
        // Suppression has to be an input the machine watches, not a check it
        // reaches by luck. Nothing else changes here — the gate is still
        // unsettled and the cover is still up — so a beat that only re-read
        // the predicate when some other input moved would keep covering a
        // screen a leave is navigating away from.
        const curtain = makeCurtain(1);
        let suppressed = false;
        const options = (): LoadingBeatOptions =>
            baseOptions({
                curtain,
                settled: false,
                fadeMs: 0,
                isSuppressed: () => suppressed,
            });

        const { result, rerender } = renderBeat(options());
        await flush();
        expect(result.current.phase).toBe('loading');

        suppressed = true;
        rerender(options());
        await flush();

        expect(result.current.phase).toBe('suppressed');
        expect(result.current.coverMounted).toBe(false);
    });

    it('finishes a fade leg on time when an input changes underneath it', async () => {
        // Each leg is stamped once on entry. The condition effect re-runs on
        // every input change and cancels its timer as it goes, so a leg that
        // re-armed its full duration would grow by whatever churned beneath
        // it — and `settled` arriving during the cover's fade-in is the
        // ordinary case, not an exotic one.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: false, holdMs: 0, fadeMs: FADE_MS }),
        );

        await advance(FADE_MS / 2);
        expect(result.current.phase).toBe('loading-in');

        // Half way through the fade-in, the gate settles.
        rerender(baseOptions({ curtain, settled: true, holdMs: 0, fadeMs: FADE_MS }));
        await advance(FADE_MS / 2 + 20);

        // The leg ended on its own clock rather than restarting.
        expect(result.current.phase).not.toBe('loading-in');
    });

    it('releases nothing further once suppressed, even if the suppressor clears', async () => {
        // Terminal for the activation: the screen belongs to whoever took it,
        // and a beat that resumed would fade back in over their navigation.
        const curtain = makeCurtain(1);
        let suppressed = true;
        const options = (): LoadingBeatOptions =>
            baseOptions({
                curtain,
                declared: false,
                settled: true,
                fadeMs: 0,
                isSuppressed: () => suppressed,
            });

        const { result, rerender } = renderBeat(options());
        await flush();
        expect(result.current.phase).toBe('suppressed');

        suppressed = false;
        rerender(options());
        await advance(50);

        expect(result.current.phase).toBe('suppressed');
        expect(result.current.revealed).toBe(false);

        // Not even a restore short-circuit reopens it. That check runs ahead of
        // the phase switch, so `suppressed` staying terminal is what stops a
        // beat resuming onto a screen its owner has navigated away from.
        rerender(
            baseOptions({ curtain, declared: false, settled: true, fadeMs: 0, shortCircuit: true }),
        );
        await advance(50);

        expect(result.current.phase).toBe('suppressed');
    });

    it('reports the cover mounted and visible through the hold, and mounted while it leaves', async () => {
        // The output contract, sampled at each phase it distinguishes rather
        // than at the terminals. `coverVisible` falling one leg before
        // `coverMounted` is what gives the cover a fade-out to run: a
        // projection that dropped both together would pop it off the screen.
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: false, holdMs: 0, fadeMs: FADE_MS }),
        );

        await advance(FADE_MS);
        expect(result.current.phase).toBe('loading');
        expect(result.current.coverMounted).toBe(true);
        expect(result.current.coverVisible).toBe(true);
        expect(result.current.revealed).toBe(false);

        rerender(baseOptions({ curtain, settled: true, holdMs: 0, fadeMs: FADE_MS }));
        await flush();
        expect(result.current.phase).toBe('loading-out');
        expect(result.current.coverMounted).toBe(true);
        expect(result.current.coverVisible).toBe(false);
        expect(result.current.revealed).toBe(false);

        await advance(FADE_MS + 50);
        expect(result.current.coverMounted).toBe(false);
    });

    it('reveals from the render that enters the reveal, one commit before the fade starts', async () => {
        // What the HUD-mount seam hangs off: the HUD has to mount under full
        // black, so `revealed` must be true for the render that commits BEFORE
        // the closing fade-in — not only once that fade has finished. A
        // projection keyed on the terminal phase alone would mount the HUD
        // mid-ramp, in front of the player.
        const curtain = makeCurtain(1);
        const { result } = renderBeat(
            baseOptions({ curtain, declared: false, settled: true, fadeMs: FADE_MS }),
        );

        await flush();

        expect(result.current.phase).toBe('revealing');
        expect(result.current.revealed).toBe(true);
        expect(curtain.opacity).toBe(1);
    });

    it('runs against no curtain at all, which is what an isolated render gets', async () => {
        // Every other case supplies a double. Without this one the null arms —
        // the opaque-by-default read and the reveal that advances with no fade
        // to await — are never executed.
        const { result } = renderBeat(
            baseOptions({ curtain: null, settled: true, holdMs: 0, fadeMs: 0 }),
        );

        await advance(50);

        expect(result.current.phase).toBe('revealed');
        expect(result.current.revealed).toBe(true);
    });

    it('waits for an externally driven curtain when it does not own the darkening', async () => {
        // The scene surface: `useFadeTransition` owns the fade-out because the
        // ack awaits it. The beat observes rather than commands, so the ack
        // path keeps its timing.
        const curtain = makeCurtain(0);
        const { result, rerender } = renderBeat(
            baseOptions({ curtain, settled: true, ownsDarkening: false, fadeMs: 0, holdMs: 0 }),
        );

        await advance(50);
        expect(curtain.calls).not.toContain('fadeOut');
        // The leg has not ended: asserting only that no cover is up would pass
        // for a beat that had already run past one, since every duration here
        // is zero. What must be true is that NOTHING has been revealed yet —
        // the screen is still mid-fade and the scene is not the player's to see.
        expect(result.current.phase).toBe('darkening');
        expect(result.current.revealed).toBe(false);

        curtain.setOpacity(1);
        rerender(
            baseOptions({ curtain, settled: true, ownsDarkening: false, fadeMs: 0, holdMs: 0 }),
        );
        await advance(50);

        expect(result.current.revealed).toBe(true);
    });

    it('cancels its pending timer when the surface goes inactive', async () => {
        const curtain = makeCurtain(1);
        const { result, rerender } = renderBeat(baseOptions({ curtain, settled: true }));

        await advance(FADE_MS);
        expect(result.current.phase).toBe('loading');

        rerender(baseOptions({ curtain, active: false, settled: true }));
        await flush();

        expect(vi.getTimerCount()).toBe(0);
        expect(result.current.phase).toBe('idle');
        expect(result.current.coverMounted).toBe(false);
    });

    it('cancels its pending timer on unmount', async () => {
        const curtain = makeCurtain(1);
        const { unmount } = renderBeat(baseOptions({ curtain, settled: true }));

        await advance(FADE_MS);
        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('survives StrictMode’s simulated effect remount', async () => {
        // The F83 mountedRef lesson: a latch re-armed only in cleanup stays
        // dead for the rest of the mount, and `pnpm dev` runs StrictMode.
        const curtain = makeCurtain(1);
        const { result } = renderBeat(baseOptions({ curtain, settled: true, holdMs: 0 }), {
            reactStrictMode: true,
        });

        await advance(FADE_MS * 3 + 100);

        expect(result.current.phase).toBe('revealed');
    });

    it('behaves identically under the e2e flag, so it adds no collapse point', async () => {
        // Invariant #133's collapse derivation depends on the flag having the
        // readers it already has. Every deliberate delay reaches the beat as an
        // input resolved by a caller, so re-importing the module under the flag
        // must change nothing — a module-level capture or an inline read would
        // show up here as a beat that behaves differently in the e2e build.
        //
        // Re-imported after the stub rather than reusing the top-level import,
        // because a module-level capture happens at import time and a stub set
        // afterwards can never reach it.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        vi.resetModules();
        const flagged = await import('./useLoadingBeat.js');

        const curtain = makeCurtain(1);
        const { result } = renderHook(
            (props: LoadingBeatOptions) => flagged.useLoadingBeat(props),
            { initialProps: baseOptions({ curtain, settled: true, holdMs: HOLD_MS }) },
        );

        // The hook takes two durations, so both are sampled where a collapse
        // and a non-collapse differ. Inside the fade-in leg first: a module
        // that zeroed only its fades is already past this.
        await advance(FADE_MS / 2);
        expect(result.current.phase).toBe('loading-in');

        // Then past the fade with the gate already settled: a module that
        // zeroed only its floor is revealed by here.
        await advance(FADE_MS + 500);
        expect(result.current.phase).toBe('loading');
        expect(result.current.coverMounted).toBe(true);
        expect(result.current.revealed).toBe(false);

        // The samples above cover the two durations the beat SCHEDULES on.
        // They cannot cover a read applied to a duration it merely COMMANDS —
        // a collapsed fade passed to the curtain leaves every phase timing
        // honest — and "somewhere a module reads env" has no finite set of
        // behaviours to enumerate. So the structural assertion stays alongside
        // them rather than being replaced by them.
        const { existsSync, readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const source = [
            'renderer/components/scene/useLoadingBeat.ts',
            'components/scene/useLoadingBeat.ts',
        ]
            .map((relative) => join(process.cwd(), relative))
            .filter((absolute) => existsSync(absolute))
            .map((absolute) => readFileSync(absolute, 'utf8'))[0];
        expect(source, 'useLoadingBeat.ts not found from the test cwd').toContain(
            'export function useLoadingBeat',
        );
        expect(source).not.toContain('process.env');

        vi.unstubAllEnvs();
    });
});
