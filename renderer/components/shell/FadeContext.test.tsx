// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { easeOut } from '../../utils/curves.js';
import { FadeProvider, useFade } from './FadeContext.js';

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
