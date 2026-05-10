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

export type FadePhase = 'idle' | 'fade-out' | 'hold' | 'fade-in';

export interface FadeControl {
    readonly phase: FadePhase;
    readonly opacity: number;
    setPhase(phase: FadePhase): void;
    fadeOut(durationMs?: number): Promise<void>;
    fadeIn(durationMs?: number): Promise<void>;
}

export const FadeContext = createContext<FadeControl | null>(null);

export interface FadeProviderProps {
    readonly children: ReactNode;
}

const FRAME_INTERVAL_MS = 16;
type AnimationFrameCallback = (time: number) => void;
type AnimationFrameHandle = number | ReturnType<typeof setTimeout>;

interface AnimationFrameGlobal {
    readonly requestAnimationFrame?: (callback: AnimationFrameCallback) => AnimationFrameHandle;
    readonly cancelAnimationFrame?: (frameId: AnimationFrameHandle) => void;
}

const animationFrameGlobal = globalThis as typeof globalThis & AnimationFrameGlobal;

export function FadeProvider({ children }: FadeProviderProps): React.ReactElement {
    const [phase, setPhase] = useState<FadePhase>('idle');
    const [opacity, setOpacity] = useState(0);
    const opacityRef = useRef(opacity);
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
                    const nextOpacity = startOpacity + (targetOpacity - startOpacity) * progress;
                    setOpacity(nextOpacity);

                    if (progress >= 1) {
                        if (activeAnimationRef.current === controller) {
                            activeAnimationRef.current = null;
                        }
                        finish(targetOpacity);
                        return;
                    }

                    frameId = requestFrame(step);
                };

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

    const value = useMemo<FadeControl>(
        () => ({ phase, opacity, setPhase, fadeOut, fadeIn }),
        [fadeIn, fadeOut, opacity, phase],
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
