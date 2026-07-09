// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useExitPresence } from './useExitPresence';

/**
 * jsdom computes no CSS, so exit-animation timings are simulated by mapping
 * elements (via data-testid) to animation duration/delay pairs; unmapped
 * elements fall through to the real getComputedStyle.
 */
interface AnimationTiming {
    readonly duration: string;
    readonly delay: string;
}

function mockAnimationTimings(timingsByTestId: Record<string, AnimationTiming>): void {
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
        const testId = element instanceof HTMLElement ? element.dataset['testid'] : undefined;
        const timing = testId === undefined ? undefined : timingsByTestId[testId];
        const style = realGetComputedStyle(element, pseudo);
        if (timing === undefined) return style;
        return new Proxy(style, {
            get(target, property) {
                if (property === 'animationDuration') return timing.duration;
                if (property === 'animationDelay') return timing.delay;
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
    });
}

function Host({ open }: { readonly open: boolean }): React.ReactElement | null {
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { mounted, closing } = useExitPresence(open, [overlayRef, panelRef]);

    if (!mounted) return null;

    return (
        <div data-closing={closing} data-testid="overlay" ref={overlayRef}>
            <div data-testid="panel" ref={panelRef}>
                <div data-testid="child" />
            </div>
        </div>
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('useExitPresence', () => {
    it('is unmounted while closed from the start', () => {
        render(<Host open={false} />);

        expect(screen.queryByTestId('overlay')).not.toBeInTheDocument();
    });

    it('mounts in the open (non-closing) state when open', () => {
        render(<Host open />);

        expect(screen.getByTestId('overlay')).toBeInTheDocument();
        expect(screen.getByTestId('overlay')).toHaveAttribute('data-closing', 'false');
    });

    it('unmounts synchronously when no exit animation is detectable (jsdom, reduced motion)', () => {
        const { rerender } = render(<Host open />);

        rerender(<Host open={false} />);

        expect(screen.queryByTestId('overlay')).not.toBeInTheDocument();
    });

    it('stays mounted in the closing state until every animated element finishes', () => {
        mockAnimationTimings({
            overlay: { duration: '0.12s', delay: '0s' },
            panel: { duration: '120ms', delay: '0s' },
        });
        const { rerender } = render(<Host open />);

        rerender(<Host open={false} />);

        expect(screen.getByTestId('overlay')).toHaveAttribute('data-closing', 'true');

        fireEvent.animationEnd(screen.getByTestId('overlay'));
        expect(screen.getByTestId('overlay')).toBeInTheDocument();

        fireEvent.animationEnd(screen.getByTestId('panel'));
        expect(screen.queryByTestId('overlay')).not.toBeInTheDocument();
    });

    it('waits only for elements with a non-zero exit animation', () => {
        mockAnimationTimings({
            overlay: { duration: '0s', delay: '0s' },
            panel: { duration: '0.25s', delay: '0s' },
        });
        const { rerender } = render(<Host open />);

        rerender(<Host open={false} />);
        fireEvent.animationEnd(screen.getByTestId('panel'));

        expect(screen.queryByTestId('overlay')).not.toBeInTheDocument();
    });

    it('ignores animationend events bubbling up from descendants', () => {
        mockAnimationTimings({ panel: { duration: '0.25s', delay: '0s' } });
        const { rerender } = render(<Host open />);

        rerender(<Host open={false} />);
        fireEvent.animationEnd(screen.getByTestId('child'));

        expect(screen.getByTestId('overlay')).toBeInTheDocument();
    });

    it('force-unmounts via the safety timer when animationend never arrives', () => {
        vi.useFakeTimers();
        mockAnimationTimings({ panel: { duration: '0.2s', delay: '50ms' } });
        const { rerender } = render(<Host open />);

        rerender(<Host open={false} />);
        expect(screen.getByTestId('overlay')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(screen.queryByTestId('overlay')).not.toBeInTheDocument();
    });

    it('returns to the open state when reopened mid-close and cancels the pending unmount', () => {
        vi.useFakeTimers();
        mockAnimationTimings({ panel: { duration: '0.2s', delay: '0s' } });
        const { rerender } = render(<Host open />);

        rerender(<Host open={false} />);
        expect(screen.getByTestId('overlay')).toHaveAttribute('data-closing', 'true');

        rerender(<Host open />);
        expect(screen.getByTestId('overlay')).toHaveAttribute('data-closing', 'false');

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(screen.getByTestId('overlay')).toBeInTheDocument();
    });

    it('cancels timers when the host unmounts mid-close', () => {
        vi.useFakeTimers();
        mockAnimationTimings({ panel: { duration: '0.2s', delay: '0s' } });
        const { rerender, unmount } = render(<Host open />);

        rerender(<Host open={false} />);
        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});
