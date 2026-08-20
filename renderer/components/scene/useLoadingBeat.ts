// renderer/components/scene/useLoadingBeat.ts
//
// The loading beat's presentation sequencer (§4.36): black → the loading cover
// for at least its floor → black → the reveal. One instance per surface; the
// route pages and `SceneRouter` each own their own against the curtain that
// covers them.
//
// It is a sequencer and nothing else. It never reads the preload gate, never
// touches navigation, and sits strictly downstream of `engine:scene_ready` —
// a cosmetic floor ahead of that ack would serialise one client's preference
// onto every seat in the match (Invariant #133).
//
// Timer discipline follows `useMinimumVisibleHold`: `window.setTimeout` held in
// a ref, cancelled in cleanup, remainders computed from a monotonic
// `performance.now()` stamp. Durations arrive as inputs, resolved by callers
// that read the e2e flag. This module reads no environment of its own.

import { useEffect, useRef, useState } from 'react';
import type { FadeControl } from '../shell/FadeContext.js';

/**
 * Where the beat currently is.
 *
 * `darkening` ends when the curtain is OBSERVED opaque, which is what lets one
 * machine serve both surfaces: the route pages command the fade-out themselves,
 * while the scene surface watches the fade-out `useFadeTransition` already owns.
 */
export type LoadingBeatPhase =
    | 'idle'
    | 'darkening'
    | 'covered'
    | 'loading-in'
    | 'loading'
    | 'loading-out'
    | 'revealing'
    | 'revealed'
    | 'suppressed';

export interface LoadingBeatOptions {
    /**
     * The curtain the beat sequences against — the app-level fade for a route,
     * `GameShell`'s inner fade for a scene hop. `null` degrades every leg to an
     * instant cut, which is what an isolated unit render gets.
     */
    readonly curtain: FadeControl | null;
    /** Whether this surface is showing at all. A fall resets the machine. */
    readonly active: boolean;
    /**
     * Whether the cascade resolved a game-declared cover form for this wait.
     * This — not the floor — is what decides whether a beat happens.
     */
    readonly declared: boolean;
    /**
     * Whether the wait is over: the preload gate is ready AND no code-split
     * chunk is still pending. Read as one bit on purpose; the gate's four
     * settle paths, failures included, reveal alike (Invariant #133).
     */
    readonly settled: boolean;
    /** How long the cover holds once fully visible — `resolveLoadingBeatFloorMs`. */
    readonly holdMs: number;
    /** How long each fade leg runs — `screenFadeMs()`. */
    readonly fadeMs: number;
    /**
     * Reveal now and skip the beat: a save-restore parked mid-wait has to
     * surface its abortable dialog, which sits BELOW both curtain and cover.
     * The beat does not replay afterwards — the player has seen the scene by
     * then, and a tips screen over a board they are reading is a regression.
     */
    readonly shortCircuit?: boolean;
    /**
     * Consulted before every curtain command. `true` hands the screen to
     * another owner — a leave in flight, a returning lobby snapshot — and the
     * beat issues nothing further for this activation.
     *
     * A callback rather than a boolean so a ref-latched suppressor is read when
     * the command would fire, not when the render that scheduled it ran.
     */
    readonly isSuppressed?: () => boolean;
    /**
     * Whether this beat commands the fade to black itself. `false` on the scene
     * surface, where `useFadeTransition` owns that fade because the ack awaits
     * it — the beat waits for the curtain to go opaque instead. Defaults `true`.
     */
    readonly ownsDarkening?: boolean;
    /**
     * Whether this beat commands the reveal itself. `false` on the scene
     * surface, where `useFadeTransition` performs that fade because it is the
     * same hook that owes it — the transition earned the reveal, and paying it
     * anywhere else would put two owners on one curtain.
     *
     * The beat still SEQUENCES the reveal either way: `revealing` is entered on
     * the same terms, and `revealed` is what the owner reads to know the cover
     * has finished leaving. Only the `fadeIn` call moves. Defaults `true`.
     */
    readonly ownsReveal?: boolean;
    /**
     * Whether something opaque already covers this surface. An occluded beat
     * skips its cover rather than flooring one nobody can see, which would only
     * extend a black screen.
     */
    readonly occluded?: boolean;
}

export interface LoadingBeat {
    readonly phase: LoadingBeatPhase;
    /** Whether the scene and its HUD may be shown. */
    readonly revealed: boolean;
    /** Whether the cover element should be in the tree. */
    readonly coverMounted: boolean;
    /** Whether the mounted cover should be driven toward full opacity. */
    readonly coverVisible: boolean;
}

/** A curtain at full opacity — or absent, which a unit render treats the same. */
function isOpaque(curtain: FadeControl | null): boolean {
    return curtain === null || curtain.opacity >= 1;
}

export function useLoadingBeat(options: LoadingBeatOptions): LoadingBeat {
    const {
        curtain,
        active,
        declared,
        settled,
        holdMs,
        fadeMs,
        shortCircuit = false,
        isSuppressed,
        ownsDarkening = true,
        ownsReveal = true,
        occluded = false,
    } = options;

    const [phase, setPhase] = useState<LoadingBeatPhase>('idle');

    const timerRef = useRef<number | null>(null);
    const stampRef = useRef<number | null>(null);
    const legPhaseRef = useRef<LoadingBeatPhase | null>(null);
    const legStartRef = useRef(0);

    // Written in render so a command fired later in the same commit reads the
    // value this render was given, not the one the last effect closed over.
    // The suppressor above all: it is a ref-latched predicate whose whole point
    // is to be current when the command runs.
    const curtainRef = useRef(curtain);
    curtainRef.current = curtain;
    const suppressedRef = useRef(isSuppressed);
    suppressedRef.current = isSuppressed;
    const fadeMsRef = useRef(fadeMs);
    fadeMsRef.current = fadeMs;
    const ownsDarkeningRef = useRef(ownsDarkening);
    ownsDarkeningRef.current = ownsDarkening;
    const ownsRevealRef = useRef(ownsReveal);
    ownsRevealRef.current = ownsReveal;

    // A number, not the control: `FadeControl` re-memoises on every animation
    // frame, so depending on the object would re-run the effects below through
    // the whole fade — and re-issue the command that fade IS.
    const curtainOpacity = curtain?.opacity ?? 1;

    // Read in render so suppression is a DEPENDENCY and not merely a check that
    // happens to be reached: a leave latched in a ref changes no other input
    // this machine watches, so a predicate consulted only inside the effects
    // would go unnoticed until something unrelated re-ran them. Effect A still
    // re-reads through the ref at command time, which is the reading that
    // actually keeps a command off a screen another owner has taken.
    const suppressed = isSuppressed?.() === true;

    const clearTimer = (): void => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    /**
     * What is left of the current leg's `durationMs`.
     *
     * The condition effect re-runs on any input change and cancels its timer as
     * it goes, so a leg that re-armed the full duration each time would grow by
     * whatever churned underneath it — `settled` arriving during the cover's
     * fade-in is the ordinary case. The stamp is keyed on phase identity, so it
     * survives a re-run but not a change of leg; the deactivation branch below
     * clears it, since a phase identity that repeats across activations is not
     * the same leg.
     */
    const legRemainderMs = (durationMs: number): number => {
        if (legPhaseRef.current !== phase) {
            legPhaseRef.current = phase;
            legStartRef.current = performance.now();
            return durationMs;
        }
        return durationMs - (performance.now() - legStartRef.current);
    };

    // Commands. Deps are the phase and the activation ALONE, so this runs once
    // per phase entry and a curtain re-render cannot re-issue a fade.
    useEffect(() => {
        if (!active) {
            return;
        }
        // Re-read through the ref rather than trusting the render's value: a
        // latch can flip between the render that computed it and this flush,
        // and the command below is the thing that must not reach a screen
        // another owner has taken. Moving the phase as well as declining the
        // command is what keeps the machine from parking mid-leg until some
        // unrelated render happens to re-run the effect below.
        if (suppressedRef.current?.() === true) {
            setPhase('suppressed');
            return;
        }

        let cancelled = false;

        if (phase === 'darkening') {
            const control = curtainRef.current;
            if (ownsDarkeningRef.current && control !== null && control.opacity < 1) {
                void control.fadeOut(fadeMsRef.current);
            }
            return;
        }

        if (phase === 'revealing') {
            const control = curtainRef.current;
            // Sequenced here, commanded elsewhere. The owner learns the cover
            // has finished leaving from `revealed`, so the phase still has to
            // ARRIVE — parking on `revealing` would leave a curtain nobody
            // lifts, which is the same black screen by another route.
            if (control === null || !ownsRevealRef.current) {
                setPhase('revealed');
                return;
            }
            // The fade resolves on its own promise and cannot be recalled, so
            // the cleanup below is what stops it landing. Anything that takes
            // the screen — a suppression, or the surface going inactive — moves
            // the phase or the activation, and both re-run this effect, whose
            // cleanup runs first. Without it a stale resolution paints
            // `revealed` over a screen its new owner has blacked, and when the
            // suppressor has since cleared, nothing ever corrects it.
            void control.fadeIn(fadeMsRef.current).then(() => {
                if (!cancelled) {
                    setPhase('revealed');
                }
            });
        }

        return () => {
            cancelled = true;
        };
    }, [phase, active]);

    // Conditions and timers. Safe to re-run on any input change: every branch
    // either advances the phase or arms one timer it also cancels.
    useEffect(() => {
        if (!active) {
            clearTimer();
            stampRef.current = null;
            // The leg stamp goes with them. It is keyed on phase identity, so
            // a re-activation that lands on the same phase would otherwise
            // measure its leg from the PREVIOUS activation's clock, find it
            // long expired, and skip the leg entirely. Clearing the key is
            // enough — the next read re-stamps the start before using it.
            legPhaseRef.current = null;
            setPhase('idle');
            return;
        }

        if (phase === 'revealed' || phase === 'suppressed') {
            return;
        }

        // Each phase below advances to exactly one successor and both terminal
        // phases return above, so no ordering guard is needed here.
        const advance = setPhase;

        if (suppressed) {
            advance('suppressed');
            return;
        }

        if (shortCircuit) {
            // Straight to the reveal, and the terminal return above is what
            // keeps it there: when the wait ends still unsettled the beat does
            // not replay, because the player has already seen the scene.
            advance('revealing');
            return;
        }

        switch (phase) {
            case 'idle':
                advance('darkening');
                return;

            case 'darkening':
                // Ends on the OBSERVED curtain, whoever commanded it.
                if (isOpaque(curtainRef.current)) {
                    advance('covered');
                }
                return;

            case 'covered':
                if (declared && !occluded) {
                    advance('loading-in');
                } else if (settled) {
                    advance('revealing');
                }
                return;

            case 'loading-in': {
                // The floor is measured from FULL visibility: stamping at mount
                // would spend a whole fade of it on a cover still ramping up.
                const stampAndHold = (): void => {
                    stampRef.current = performance.now();
                    advance('loading');
                };
                const remaining = legRemainderMs(fadeMs);
                if (remaining <= 0) {
                    stampAndHold();
                    return;
                }
                timerRef.current = window.setTimeout(() => {
                    timerRef.current = null;
                    stampAndHold();
                }, remaining);
                break;
            }

            case 'loading': {
                // The gate is the only thing that ends the wait; the floor only
                // ever adds to it. Nothing here reveals on its own.
                if (!settled) {
                    return;
                }
                const stamp = stampRef.current ?? performance.now();
                const remainder = holdMs - (performance.now() - stamp);
                if (remainder <= 0) {
                    advance('loading-out');
                    return;
                }
                timerRef.current = window.setTimeout(() => {
                    timerRef.current = null;
                    advance('loading-out');
                }, remainder);
                break;
            }

            case 'loading-out': {
                const remaining = legRemainderMs(fadeMs);
                if (remaining <= 0) {
                    advance('revealing');
                    return;
                }
                timerRef.current = window.setTimeout(() => {
                    timerRef.current = null;
                    advance('revealing');
                }, remaining);
                break;
            }

            default:
                return;
        }

        return () => {
            clearTimer();
        };
    }, [
        active,
        phase,
        declared,
        settled,
        holdMs,
        fadeMs,
        shortCircuit,
        occluded,
        curtainOpacity,
        suppressed,
    ]);

    useEffect(() => {
        return () => {
            clearTimer();
        };
    }, []);

    const covering = phase === 'loading-in' || phase === 'loading' || phase === 'loading-out';

    return {
        phase,
        revealed: phase === 'revealing' || phase === 'revealed',
        coverMounted: covering,
        coverVisible: phase === 'loading-in' || phase === 'loading',
    };
}
