// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { easeOut } from '../../utils/curves.js';
import { FADE_WATCHDOG_GRACE_MS, FadeProvider, useFade, type FadeControl } from './FadeContext.js';

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
    // whose frames stop being serviced would otherwise hold the multiplayer
    // scene barrier for EVERY player, not just its own. The watchdog bounds the
    // promise in wall-clock time: the fade snaps to its endpoint and resolves
    // at duration + grace.
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

describe('FadeControl.claim', () => {
    /**
     * Renders one provider and hands the live `FadeControl` back through a ref,
     * so a test can claim sessions in the order a real interleaving would
     * rather than through a component tree built per case.
     */
    function renderControl(): { current: FadeControl | null } {
        const ref: { current: FadeControl | null } = { current: null };

        function Probe(): React.ReactElement {
            const fade = useFade();
            ref.current = fade;
            return <output data-testid="fade-opacity">{fade.opacity}</output>;
        }

        render(
            <FadeProvider>
                <Probe />
            </FadeProvider>,
        );
        return ref;
    }

    it('drives the provider from the active session', async () => {
        // The positive control: without it, a claim() that returned inert
        // no-ops from birth would satisfy every suppression case below.
        vi.useFakeTimers();
        const control = renderControl();

        const session = control.current?.claim('beat');
        await act(async () => {
            await session?.fadeOut(0);
        });

        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');
    });

    it('makes a superseded session inert without touching opacity', async () => {
        // The stuck-screen hazard in one case: the beat still holds a session
        // and issues its reveal fade-in AFTER a leave has claimed the
        // provider. The reveal must not repaint the screen the leave blacked.
        vi.useFakeTimers();
        const control = renderControl();

        const beat = control.current?.claim('beat');
        const leave = control.current?.claim('leave');
        await act(async () => {
            await leave?.fadeOut(0);
        });
        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');

        await act(async () => {
            await beat?.fadeIn(0);
        });

        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');
    });

    it('resolves a superseded session’s fade instead of hanging its caller', async () => {
        // A sequencer awaits its own legs. An inert call that never settled
        // would park the beat mid-phase forever rather than let it unwind.
        vi.useFakeTimers();
        const control = renderControl();

        const beat = control.current?.claim('beat');
        control.current?.claim('leave');

        let settled = false;
        await act(async () => {
            await beat?.fadeIn(0).then(() => {
                settled = true;
            });
        });

        expect(settled).toBe(true);
    });

    it('reports which session owns the provider', () => {
        // The signal a sequencer reads to stop issuing commands at all,
        // rather than issuing commands that are silently dropped.
        const control = renderControl();

        const beat = control.current?.claim('beat');
        expect(beat?.isActive).toBe(true);

        control.current?.claim('leave');
        expect(beat?.isActive).toBe(false);
    });

    it('preempts an in-flight fade without stranding its promise', async () => {
        // The cancel-resolves-early trap this API exists to contain: the
        // superseded fade must settle (so its awaiter unwinds) while the new
        // owner, not the old one, decides where the screen ends up.
        vi.useFakeTimers();
        const control = renderControl();

        const beat = control.current?.claim('beat');
        let beatFadeSettled = false;
        act(() => {
            void beat?.fadeOut(320).then(() => {
                beatFadeSettled = true;
            });
        });

        const leave = control.current?.claim('leave');
        await act(async () => {
            await leave?.fadeIn(0);
        });

        expect(beatFadeSettled).toBe(true);
        expect(screen.getByTestId('fade-opacity').textContent).toBe('0');
    });

    it('leaves the unclaimed fadeOut/fadeIn pair driving the provider directly', async () => {
        // Every existing caller fades without claiming anything. A claim that
        // locked the provider against them would break the lobby hop, the
        // menu reveal and the error boundary in one edit.
        vi.useFakeTimers();
        const control = renderControl();

        control.current?.claim('beat');
        await act(async () => {
            await control.current?.fadeOut(0);
        });

        expect(screen.getByTestId('fade-opacity').textContent).toBe('1');
    });
});
