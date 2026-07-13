// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render as baseRender,
    screen,
    within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useToastStore } from '../../state/toastStore';
import { ToastHost } from './ToastHost';

// ToastHost calls useTranslate() for the region aria-label; the inert provider
// resolves engine English so the existing assertions hold.
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: I18nProvider });

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';
const UUID_3 = '00000000-0000-4000-8000-000000000003';

type RandomUuid = () => `${string}-${string}-${string}-${string}-${string}`;
interface MutableMediaQueryList {
    matches: boolean;
    readonly media: string;
    readonly onchange: null;
    readonly addEventListener: ReturnType<typeof vi.fn>;
    readonly removeEventListener: ReturnType<typeof vi.fn>;
    readonly dispatchEvent: ReturnType<typeof vi.fn>;
}

function notifyMediaQueryListener(
    mediaQuery: MutableMediaQueryList,
    listener: EventListenerOrEventListenerObject,
    event: Event,
): void {
    if (typeof listener === 'function') {
        listener.call(mediaQuery, event);
        return;
    }

    listener.handleEvent(event);
}

function installMatchMedia(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => {
            const listeners = new Set<EventListenerOrEventListenerObject>();
            const mediaQuery = {
                matches,
                media: query,
                onchange: null,
                addEventListener: vi.fn(
                    (type: string, listener: EventListenerOrEventListenerObject | null) => {
                        if (type === 'change' && listener !== null) {
                            listeners.add(listener);
                        }
                    },
                ),
                removeEventListener: vi.fn(
                    (type: string, listener: EventListenerOrEventListenerObject | null) => {
                        if (type === 'change' && listener !== null) {
                            listeners.delete(listener);
                        }
                    },
                ),
                dispatchEvent: vi.fn((event: Event) => {
                    if (event.type !== 'change') {
                        return true;
                    }

                    for (const listener of listeners) {
                        notifyMediaQueryListener(mediaQuery, listener, event);
                    }

                    return true;
                }),
            } as MutableMediaQueryList;

            return mediaQuery;
        }),
    });
}

describe('ToastHost', () => {
    let randomUUID: ReturnType<typeof vi.fn<RandomUuid>>;

    beforeEach(() => {
        vi.useFakeTimers();
        randomUUID = vi
            .fn<RandomUuid>()
            .mockReturnValueOnce(UUID_1)
            .mockReturnValueOnce(UUID_2)
            .mockReturnValueOnce(UUID_3);
        vi.stubGlobal('crypto', { randomUUID });
        vi.spyOn(performance, 'now').mockReturnValue(0);
        installMatchMedia(false);
        useToastStore.getState().dismissAll();
    });

    afterEach(() => {
        useToastStore.getState().dismissAll();
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders toasts in stack order with newest on the bottom', () => {
        render(<ToastHost />);

        act(() => {
            useToastStore.getState().push({ severity: 'info', title: 'Oldest toast' });
            useToastStore.getState().push({ severity: 'success', title: 'Newest toast' });
        });

        const toasts = screen.getAllByRole('status');
        expect(toasts.map((toast) => within(toast).getByTestId('toast-title').textContent)).toEqual(
            ['Oldest toast', 'Newest toast'],
        );
        expect(toasts[1]?.getAttribute('data-toast-id')).toBe(UUID_2);
    });

    it('resolves the notifications region aria-label through the active-locale translator', () => {
        baseRender(
            <I18nProvider gameOverride={{ 'engine.toast.hostAriaLabel': 'Alerts' }}>
                <ToastHost />
            </I18nProvider>,
        );

        expect(screen.getByTestId('toast-host').getAttribute('aria-label')).toBe('Alerts');
    });

    it('auto-dismisses each toast after its resolved duration', () => {
        render(<ToastHost />);

        act(() => {
            useToastStore
                .getState()
                .push({ severity: 'warning', title: 'Auto dismissed', durationMs: 500 });
        });

        expect(screen.getByText('Auto dismissed')).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(499);
        });
        expect(screen.getByText('Auto dismissed')).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(screen.queryByText('Auto dismissed')).toBeNull();
    });

    it('renders optional body text and action button', () => {
        const onClick = vi.fn();
        render(<ToastHost />);

        act(() => {
            useToastStore.getState().push({
                severity: 'success',
                title: 'Replay saved',
                body: 'Saved to the replay folder.',
                action: { label: 'Open folder', onClick },
            });
        });

        expect(screen.getByText('Replay saved')).toBeTruthy();
        expect(screen.getByText('Saved to the replay folder.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));

        expect(onClick).toHaveBeenCalledOnce();
    });

    it('marks the host as reduced-motion when the media query matches', () => {
        installMatchMedia(true);

        render(<ToastHost />);

        const host = screen.getByTestId('toast-host');
        expect(host.getAttribute('data-reduced-motion')).toBe('true');
    });

    it('updates the reduced-motion marker when the media query changes', () => {
        render(<ToastHost />);

        const host = screen.getByTestId('toast-host');
        expect(host.getAttribute('data-reduced-motion')).toBe('false');

        const matchMedia = window.matchMedia as unknown as {
            readonly mock: {
                readonly results: readonly {
                    readonly value: MutableMediaQueryList;
                }[];
            };
        };
        const mediaQuery = matchMedia.mock.results[0]?.value;
        if (!mediaQuery) {
            throw new Error('Expected ToastHost to subscribe to the reduced-motion media query.');
        }

        mediaQuery.matches = true;
        act(() => {
            mediaQuery.dispatchEvent(new Event('change'));
        });

        expect(host.getAttribute('data-reduced-motion')).toBe('true');
    });

    it('clears all active timers on unmount to prevent leaks', () => {
        const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
        const { unmount } = render(<ToastHost />);

        act(() => {
            useToastStore
                .getState()
                .push({ severity: 'info', title: 'Pending toast', durationMs: 5_000 });
        });

        clearTimeoutSpy.mockClear();

        unmount();

        expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    });
});
