// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FadeProvider } from '../shell/FadeContext';
import { ScreenFadeOverlay } from '../shell/ScreenFadeOverlay';
import { LogoVideoScreen as LogoVideoScreenFromBarrel } from './index';
import { LOGO_VIDEO_DEFAULT_DURATION_MS, LogoVideoScreen } from './LogoVideoScreen';

const VIDEO_SRC = '/chimera_logo.mp4';

let playMock: ReturnType<typeof vi.spyOn>;
let onDone: ReturnType<typeof vi.fn>;

beforeEach(() => {
    onDone = vi.fn();
    // jsdom does not implement HTMLMediaElement.play(); the spy silences the
    // "Not implemented" virtual-console error and stands in for the autoplay
    // promise the component consumes.
    playMock = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('LogoVideoScreen', () => {
    it('renders a full-window unmuted inline-autoplay video with the given src', () => {
        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        const video = screen.getByTestId('logo-video');
        expect(screen.getByTestId('logo-video-screen')).toBeInTheDocument();
        expect(video).toHaveAttribute('src', VIDEO_SRC);
        expect(video).toHaveAttribute('autoplay');
        expect(video).toHaveAttribute('playsinline');
        expect((video as HTMLVideoElement).muted).toBe(false);
    });

    it('starts playback imperatively exactly once on mount', () => {
        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        expect(playMock).toHaveBeenCalledTimes(1);
    });

    it('calls onDone exactly once when the video ends', async () => {
        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        fireEvent.ended(screen.getByTestId('logo-video'));
        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

        fireEvent.ended(screen.getByTestId('logo-video'));
        await act(async () => {});
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('does not skip when the user clicks — only key presses skip', async () => {
        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        fireEvent.click(window);
        // Give any pending fade-out a chance to settle before asserting.
        await act(async () => {});
        expect(onDone).not.toHaveBeenCalled();
    });

    it('calls onDone exactly once when the user presses a key to skip', async () => {
        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

        fireEvent.keyDown(window, { key: 'Enter' });
        await act(async () => {});
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('calls onDone exactly once when the video errors (bad asset never bricks boot)', async () => {
        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        fireEvent.error(screen.getByTestId('logo-video'));
        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

        fireEvent.error(screen.getByTestId('logo-video'));
        await act(async () => {});
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('calls onDone exactly once when autoplay is rejected', async () => {
        playMock.mockRejectedValueOnce(new DOMException('autoplay blocked', 'NotAllowedError'));

        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    });

    it('is exported through the components/ui barrel (invariant #96)', () => {
        expect(LogoVideoScreenFromBarrel).toBe(LogoVideoScreen);
    });
});

describe('LogoVideoScreen — watchdog timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls onDone exactly once when the given duration elapses', async () => {
        render(<LogoVideoScreen src={VIDEO_SRC} durationMs={3000} onDone={onDone} />);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(2999);
        });
        expect(onDone).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(onDone).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('defaults the watchdog to LOGO_VIDEO_DEFAULT_DURATION_MS', async () => {
        render(<LogoVideoScreen src={VIDEO_SRC} onDone={onDone} />);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOGO_VIDEO_DEFAULT_DURATION_MS - 1);
        });
        expect(onDone).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('collapses competing triggers into a single onDone', async () => {
        render(<LogoVideoScreen src={VIDEO_SRC} durationMs={3000} onDone={onDone} />);

        fireEvent.ended(screen.getByTestId('logo-video'));
        fireEvent.keyDown(window, { key: 'Enter' });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000);
        });

        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

describe('LogoVideoScreen — app-level screen fade', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            return globalThis.setTimeout(() => {
                callback(Date.now());
            }, 16) as unknown as number;
        });
        vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
            globalThis.clearTimeout(frameId);
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    function renderWithFade(onDoneFn: () => void): void {
        render(
            <FadeProvider>
                <LogoVideoScreen src={VIDEO_SRC} durationMs={60_000} onDone={onDoneFn} />
                <ScreenFadeOverlay />
            </FadeProvider>,
        );
    }

    it('snaps black pre-paint and eases in to reveal the video', async () => {
        renderWithFade(onDone);

        // The useLayoutEffect snapped the overlay fully black before any fade-in
        // frame ran — the video never flashes before the fade.
        expect(screen.getByTestId('screen-fade-overlay').style.opacity).toBe('1');

        // The logo fade-in runs at the slow duration (screenFadeMs('slow') =
        // 400ms); advance past it to reach the fully-revealed state.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(800);
        });

        expect(screen.getByTestId('screen-fade-overlay').style.opacity).toBe('0');
    });

    it('on skip fades back to black and only then calls onDone', async () => {
        renderWithFade(onDone);
        // Let the slow (400ms) fade-in complete first.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(800);
        });

        fireEvent.keyDown(window, { key: 'Enter' });
        // The exit is asynchronous: the fade-out must complete before onDone.
        expect(onDone).not.toHaveBeenCalled();

        // Mid-fade (screenFadeMs('slow') = 400ms) the exit is still pending.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(onDone).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(800);
        });

        expect(screen.getByTestId('screen-fade-overlay').style.opacity).toBe('1');
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});
