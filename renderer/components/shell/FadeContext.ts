'use client';

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { linear, type EasingFn } from '../../utils/curves.js';

export type FadePhase = 'idle' | 'fade-out' | 'hold' | 'fade-in';

/**
 * One owner's handle on a {@link FadeControl}, taken through
 * {@link FadeControl.claim}.
 *
 * Starting a fade cancels the one in flight and RESOLVES its promise early, so
 * two owners writing the same provider can strand each other: a stale write
 * lands after an exit fade and repaints the screen the exit blacked, or an
 * exit's `await` returns mid-ramp and navigates over a half-faded screen. A
 * session bounds that by ownership rather than by each caller remembering to
 * check the others — the newest claim owns the provider, and every older
 * session goes inert.
 */
export interface FadeSession {
    /** Whether this session still owns the provider — `false` once superseded. */
    readonly isActive: boolean;
    /** Fade to black, or resolve without touching opacity once superseded. */
    fadeOut(durationMs?: number): Promise<void>;
    /** Fade to transparent, or resolve without touching opacity once superseded. */
    fadeIn(durationMs?: number): Promise<void>;
}

export interface FadeControl {
    readonly phase: FadePhase;
    readonly opacity: number;
    setPhase(phase: FadePhase): void;
    fadeOut(durationMs?: number): Promise<void>;
    fadeIn(durationMs?: number): Promise<void>;
    /**
     * Take ownership of this provider, superseding whatever session held it.
     *
     * `owner` is a label for debugging only — claims are ordered, not keyed, so
     * two claims under the same label still supersede one another.
     *
     * The bare {@link FadeControl.fadeOut} / {@link FadeControl.fadeIn} pair is
     * deliberately left driving the provider directly and is never gated by a
     * claim: most callers own the screen for one navigation and have nothing to
     * coordinate.
     */
    claim(owner: string): FadeSession;
}

export const FadeContext = createContext<FadeControl | null>(null);

export interface FadeProviderProps {
    readonly children: ReactNode;
    /**
     * Opacity the overlay starts at, 0 (transparent) to 1 (black). Defaults to
     * 0 so the in-game fade keeps its current behaviour; the app-level screen
     * fade can start black instead.
     */
    readonly initialOpacity?: number;
    /**
     * Easing curve applied to the fade progress. Defaults to {@link linear} so
     * the existing in-game scene fade is unchanged; the app-level screen fade
     * passes an eased curve (see {@link EasingFn}).
     */
    readonly easing?: EasingFn;
}

const FRAME_INTERVAL_MS = 16;

/**
 * How long past its nominal duration a fade may wait on animation frames
 * before the watchdog completes it anyway.
 *
 * The frame callback is this animation's CLOCK — opacity advances one fixed
 * step per DELIVERED frame — so a window whose frames stop being serviced stops
 * the clock with the promise pending.
 * `useFadeTransition` awaits that promise before acknowledging a scene
 * transition, and the host releases the barrier only when EVERY player has
 * acknowledged — so one starved window's fade would hold the scene hop for
 * the whole match. The watchdog bounds the promise in wall-clock time by
 * snapping the fade to its endpoint.
 *
 * 250 ms: a whole fade survives down to roughly half frame rate before the
 * watchdog beats its last frame, and the grace stays small against the 5 s
 * scene-preload budget that sits downstream of the same await.
 */
export const FADE_WATCHDOG_GRACE_MS = 250;
type AnimationFrameCallback = (time: number) => void;
type AnimationFrameHandle = number | ReturnType<typeof setTimeout>;

interface AnimationFrameGlobal {
    readonly requestAnimationFrame?: (callback: AnimationFrameCallback) => AnimationFrameHandle;
    readonly cancelAnimationFrame?: (frameId: AnimationFrameHandle) => void;
}

const animationFrameGlobal = globalThis as typeof globalThis & AnimationFrameGlobal;

export function FadeProvider({
    children,
    initialOpacity = 0,
    easing = linear,
}: FadeProviderProps): React.ReactElement {
    const [phase, setPhase] = useState<FadePhase>('idle');
    const [opacity, setOpacity] = useState(initialOpacity);
    const opacityRef = useRef(opacity);
    const easingRef = useRef(easing);

    useEffect(() => {
        easingRef.current = easing;
    }, [easing]);
    const activeAnimationRef = useRef<{ cancel: () => void } | null>(null);

    useEffect(() => {
        opacityRef.current = opacity;
    }, [opacity]);

    useEffect(() => {
        return () => {
            activeAnimationRef.current?.cancel();
            activeAnimationRef.current = null;
        };
    }, []);

    const animateOpacity = useCallback(
        (
            targetOpacity: number,
            durationMs: number,
            phaseDuringAnimation: FadePhase,
            phaseAfterAnimation: FadePhase,
        ): Promise<void> => {
            activeAnimationRef.current?.cancel();
            setPhase(phaseDuringAnimation);

            if (durationMs <= 0) {
                setOpacity(targetOpacity);
                // Keep the ref in lock-step with the commanded opacity so a fade
                // started in the SAME tick (e.g. the menu's instant fadeOut(0)
                // immediately followed by fadeIn) reads the right startOpacity
                // instead of the lagging effect-synced value.
                opacityRef.current = targetOpacity;
                setPhase(phaseAfterAnimation);
                return Promise.resolve();
            }

            const startOpacity = opacityRef.current;

            return new Promise((resolve) => {
                let cancelled = false;
                let frameId: AnimationFrameHandle = 0;
                let elapsedMs = 0;

                const finish = (nextOpacity: number): void => {
                    setOpacity(nextOpacity);
                    opacityRef.current = nextOpacity;
                    setPhase(phaseAfterAnimation);
                    resolve();
                };

                const controller = {
                    cancel: () => {
                        if (cancelled) {
                            return;
                        }
                        cancelled = true;
                        cancelFrame(frameId);
                        clearTimeout(watchdogId);
                        resolve();
                    },
                };
                activeAnimationRef.current = controller;

                const step = (_timestamp: number): void => {
                    if (cancelled) {
                        return;
                    }
                    elapsedMs += FRAME_INTERVAL_MS;
                    const progress = Math.min(1, elapsedMs / durationMs);
                    const eased = easingRef.current(progress);
                    const nextOpacity = startOpacity + (targetOpacity - startOpacity) * eased;
                    setOpacity(nextOpacity);
                    opacityRef.current = nextOpacity;

                    if (progress >= 1) {
                        clearTimeout(watchdogId);
                        if (activeAnimationRef.current === controller) {
                            activeAnimationRef.current = null;
                        }
                        finish(targetOpacity);
                        return;
                    }

                    frameId = requestFrame(step);
                };

                // The frames above are this animation's clock, and a window
                // that stops being handed frames stops the clock with the
                // promise pending — while a caller like the scene barrier is
                // awaiting it on behalf of every player in the match. Fired,
                // the watchdog snaps to the endpoint through the same
                // `finish` a delivered last frame would reach. It is CLEARED
                // by the last frame and by `cancel()`; a cleared timer never
                // fires, and that is the only thing keeping a superseded
                // fade's watchdog out of its replacement — the body
                // deliberately re-checks nothing.
                const watchdogId = globalThis.setTimeout(() => {
                    cancelled = true;
                    cancelFrame(frameId);
                    if (activeAnimationRef.current === controller) {
                        activeAnimationRef.current = null;
                    }
                    finish(targetOpacity);
                }, durationMs + FADE_WATCHDOG_GRACE_MS);

                frameId = requestFrame(step);
            });
        },
        [],
    );

    const fadeOut = useCallback(
        async (durationMs = 300): Promise<void> => {
            await animateOpacity(1, durationMs, 'fade-out', 'hold');
        },
        [animateOpacity],
    );

    const fadeIn = useCallback(
        async (durationMs = 300): Promise<void> => {
            await animateOpacity(0, durationMs, 'fade-in', 'idle');
        },
        [animateOpacity],
    );

    // Monotonic claim counter. A session compares the token it captured against
    // this ref at CALL time rather than at claim time, so a session claimed
    // before its first fade still goes inert the moment a later owner claims.
    const claimTokenRef = useRef(0);

    const claim = useCallback(
        (owner: string): FadeSession => {
            claimTokenRef.current += 1;
            const token = claimTokenRef.current;
            const owns = (): boolean => claimTokenRef.current === token;

            return {
                get isActive(): boolean {
                    return owns();
                },
                fadeOut: async (durationMs?: number): Promise<void> => {
                    if (!owns()) {
                        // Resolve rather than reject or hang: a superseded
                        // owner is mid-`await` on its own sequence and has to
                        // be able to unwind. `owner` names it in a debugger.
                        void owner;
                        return;
                    }
                    await fadeOut(durationMs);
                },
                fadeIn: async (durationMs?: number): Promise<void> => {
                    if (!owns()) {
                        void owner;
                        return;
                    }
                    await fadeIn(durationMs);
                },
            };
        },
        [fadeIn, fadeOut],
    );

    const value = useMemo<FadeControl>(
        () => ({ phase, opacity, setPhase, fadeOut, fadeIn, claim }),
        [claim, fadeIn, fadeOut, opacity, phase],
    );

    return React.createElement(FadeContext.Provider, { value }, children);
}

export function useFade(): FadeControl {
    const ctx = useContext(FadeContext);
    if (ctx === null) {
        throw new Error('useFade() must be used inside <FadeProvider>.');
    }
    return ctx;
}

/**
 * Like {@link useFade} but returns `null` instead of throwing when no
 * `<FadeProvider>` is above. Screen-level consumers (the route pages and the
 * navigation bootstrap) use this so they degrade to no-fade / instant
 * navigation when rendered in isolation (e.g. unit tests) — the real app always
 * mounts the app-level provider in `AppShell`.
 */
export function useOptionalFade(): FadeControl | null {
    return useContext(FadeContext);
}

function requestFrame(callback: AnimationFrameCallback): AnimationFrameHandle {
    if (typeof animationFrameGlobal.requestAnimationFrame === 'function') {
        return animationFrameGlobal.requestAnimationFrame(callback);
    }

    return globalThis.setTimeout(() => {
        callback(0);
    }, FRAME_INTERVAL_MS);
}

function cancelFrame(frameId: AnimationFrameHandle): void {
    if (typeof animationFrameGlobal.cancelAnimationFrame === 'function') {
        animationFrameGlobal.cancelAnimationFrame(frameId);
        return;
    }

    globalThis.clearTimeout(frameId);
}
