// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { easeOut } from '../../utils/curves.js';
import { FADE_WATCHDOG_GRACE_MS, FadeProvider, useFade } from './FadeContext.js';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
        return globalThis.setTimeout(() => {
            callback(Date.now());
        }, 16) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
        globalThis.clearTimeout(frameId);
    });
});

describe('FadeContext', () => {
    it('throws a descriptive error when used outside its provider', () => {
        function Consumer(): React.ReactElement {
            useFade();
            return <div />;
        }

        expect(() => render(<Consumer />)).toThrow('useFade() must be used inside <FadeProvider>.');
    });

    it('drives fadeOut and fadeIn phases through time-based opacity animation', async () => {
        vi.useFakeTimers();

        function Consumer(): React.ReactElement {
            const fade = useFade();
            return (
                <div>
                    <output data-testid="fade-phase">{fade.phase}</output>
                    <output data-testid="fade-opacity">{fade.opacity}</output>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeOut(100);
                        }}
                    >
                        Fade out
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeIn(100);
                        }}
                    >
                        Fade in
                    </button>
                </div>
            );
        }

        render(
            <FadeProvider>
                <Consumer />
            </FadeProvider>,
        );

        fireEvent.click(screen.getByText('Fade out'));
        expect(screen.getByTestId('fade-phase').textContent).toBe('fade-out');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50);
        });
        const midwayOpacity = Number(screen.getByTestId('fade-opacity').textContent);
        expect(midwayOpacity).toBeGreaterThan(0);
        expect(midwayOpacity).toBeLessThan(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(62);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('hold');
        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');

        fireEvent.click(screen.getByText('Fade in'));
        expect(screen.getByTestId('fade-phase').textContent).toBe('fade-in');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(112);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('idle');
        expect(screen.getByTestId('fade-opacity').textContent).toBe('0');
    });

    it('starts at the provided initialOpacity (start black for the app-level fade)', () => {
        function Consumer(): React.ReactElement {
            const fade = useFade();
            return <output data-testid="fade-opacity">{fade.opacity}</output>;
        }

        render(
            <FadeProvider initialOpacity={1}>
                <Consumer />
            </FadeProvider>,
        );

        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');
    });

    // The frame callback is the animation's CLOCK: opacity advances one fixed
    // step per DELIVERED requestAnimationFrame. `useFadeTransition` awaits the
    // returned promise before dispatching `engine:scene_ready`, so a window
    // whose frames stop being serviced — occluded on a loaded machine — would
    // otherwise hold the multiplayer scene barrier for EVERY player, not just
    // its own. The watchdog bounds the promise in wall-clock time: the fade
    // snaps to its endpoint and resolves at duration + grace.
    it('resolves a fade whose window is delivered no animation frames, at the watchdog', async () => {
        vi.useFakeTimers();
        // rAF EXISTS but is never serviced — the starved-window case. The
        // absent-API case is separately covered by requestFrame's setTimeout
        // fallback, which this stub must not fall into.
        vi.stubGlobal('requestAnimationFrame', (): number => 1);
        vi.stubGlobal('cancelAnimationFrame', (): void => undefined);

        function Consumer(): React.ReactElement {
            const fade = useFade();
            return (
                <div>
                    <output data-testid="fade-phase">{fade.phase}</output>
                    <output data-testid="fade-opacity">{fade.opacity}</output>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeOut(100);
                        }}
                    >
                        Fade out
                    </button>
                </div>
            );
        }

        render(
            <FadeProvider>
                <Consumer />
            </FadeProvider>,
        );

        fireEvent.click(screen.getByText('Fade out'));
        expect(screen.getByTestId('fade-phase').textContent).toBe('fade-out');

        // One tick short of duration + grace: the watchdog must not fire early,
        // or a merely SLOW fade would be cut short.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100 + FADE_WATCHDOG_GRACE_MS - 1);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('fade-out');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('hold');
        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');
    });

    it("a superseded fade's watchdog is cleared, not left to fire into the replacement", async () => {
        vi.useFakeTimers();

        function Consumer(): React.ReactElement {
            const fade = useFade();
            return (
                <div>
                    <output data-testid="fade-phase">{fade.phase}</output>
                    <output data-testid="fade-opacity">{fade.opacity}</output>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeOut(100);
                        }}
                    >
                        Fade out
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeIn(100);
                        }}
                    >
                        Fade in
                    </button>
                </div>
            );
        }

        render(
            <FadeProvider>
                <Consumer />
            </FadeProvider>,
        );

        // Start the fade-out, supersede it mid-flight, let the fade-in settle.
        fireEvent.click(screen.getByText('Fade out'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(48);
        });
        fireEvent.click(screen.getByText('Fade in'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(112);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('idle');
        expect(screen.getByTestId('fade-opacity').textContent).toBe('0');

        // Cross the superseded fade-out's watchdog moment. An uncleared
        // watchdog would snap the settled overlay back to opaque 'hold'.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300 + FADE_WATCHDOG_GRACE_MS);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('idle');
        expect(screen.getByTestId('fade-opacity').textContent).toBe('0');
    });

    // The killer for "natural completion does not clear the watchdog" — a
    // same-animation assertion after completion is vacuous (the watchdog would
    // re-apply the values the last frame already set), so the leak is made
    // visible through the NEXT animation: the completed fade-out's stale
    // watchdog would snap the in-flight fade-in to opaque 'hold'.
    it("a naturally completed fade's watchdog does not fire into the next fade", async () => {
        vi.useFakeTimers();

        function Consumer(): React.ReactElement {
            const fade = useFade();
            return (
                <div>
                    <output data-testid="fade-phase">{fade.phase}</output>
                    <output data-testid="fade-opacity">{fade.opacity}</output>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeOut(100);
                        }}
                    >
                        Fade out
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeIn(1000);
                        }}
                    >
                        Fade in
                    </button>
                </div>
            );
        }

        render(
            <FadeProvider>
                <Consumer />
            </FadeProvider>,
        );

        // Complete the fade-out NATURALLY (frames flowing), then start a slow
        // fade-in and cross t = 100 + grace, the completed fade's watchdog
        // moment.
        fireEvent.click(screen.getByText('Fade out'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(112);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('hold');

        fireEvent.click(screen.getByText('Fade in'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(FADE_WATCHDOG_GRACE_MS);
        });
        expect(screen.getByTestId('fade-phase').textContent).toBe('fade-in');
        expect(screen.getByTestId('fade-opacity').textContent).not.toBe('1');
    });

    // The 0 ms branch is synchronous BY CONTRACT — the menu's instant
    // fadeOut(0) → fadeIn same-tick sequence depends on it — so it must arm
    // nothing: a leaked watchdog would fire grace-ms into the following fade
    // and snap the menu back to black.
    it('arms no watchdog for a zero-duration fade', () => {
        vi.useFakeTimers();

        function Consumer(): React.ReactElement {
            const fade = useFade();
            return (
                <div>
                    <output data-testid="fade-phase">{fade.phase}</output>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeOut(0);
                        }}
                    >
                        Fade out
                    </button>
                </div>
            );
        }

        render(
            <FadeProvider>
                <Consumer />
            </FadeProvider>,
        );

        fireEvent.click(screen.getByText('Fade out'));
        expect(screen.getByTestId('fade-phase').textContent).toBe('hold');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('unmounting mid-fade clears the watchdog with the animation', async () => {
        vi.useFakeTimers();
        // Starved frames: the watchdog is then the ONLY pending timer, so the
        // count below reads it and nothing else.
        vi.stubGlobal('requestAnimationFrame', (): number => 1);
        vi.stubGlobal('cancelAnimationFrame', (): void => undefined);

        function Consumer(): React.ReactElement {
            const fade = useFade();
            return (
                <button
                    type="button"
                    onClick={() => {
                        void fade.fadeOut(100);
                    }}
                >
                    Fade out
                </button>
            );
        }

        const { unmount } = render(
            <FadeProvider>
                <Consumer />
            </FadeProvider>,
        );

        fireEvent.click(screen.getByText('Fade out'));
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('applies the easing curve during the animation while landing exactly on the endpoint', async () => {
        vi.useFakeTimers();

        function Consumer(): React.ReactElement {
            const fade = useFade();
            return (
                <div>
                    <output data-testid="fade-opacity">{fade.opacity}</output>
                    <button
                        type="button"
                        onClick={() => {
                            void fade.fadeOut(100);
                        }}
                    >
                        Fade out
                    </button>
                </div>
            );
        }

        render(
            <FadeProvider easing={easeOut}>
                <Consumer />
            </FadeProvider>,
        );

        fireEvent.click(screen.getByText('Fade out'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(48);
        });
        // Near the start, easeOut accelerates faster than linear: at ~progress
        // 0.48 a linear fade sits at ~0.48 opacity, easeOut sits well above it.
        const easedOpacity = Number(screen.getByTestId('fade-opacity').textContent);
        expect(easedOpacity).toBeGreaterThan(0.6);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(64);
        });
        // The completion still snaps to the exact target — no easing rounding drift.
        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');
    });
});
