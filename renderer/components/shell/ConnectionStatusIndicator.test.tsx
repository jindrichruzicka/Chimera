// renderer/components/shell/ConnectionStatusIndicator.test.tsx
// @vitest-environment jsdom

import { act, cleanup, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus } from '@chimera-engine/simulation/bridge/api-types.js';
import { I18nProvider } from '../../i18n/I18nProvider';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';

// The indicator calls useTranslate() for its status aria-label; the inert
// provider resolves engine English so the existing aria-label assertions hold.
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: I18nProvider });

type StatusListener = (status: ConnectionStatus) => void;

function installSystemBridge(
    onSubscribe: (listener: StatusListener) => void,
    unsubscribe: () => void,
): void {
    const system = {
        onConnectionStatus: (cb: StatusListener): (() => void) => {
            onSubscribe(cb);
            return unsubscribe;
        },
    };

    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system,
        },
    });
}

afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    cleanup();
    vi.restoreAllMocks();
});

describe('ConnectionStatusIndicator', () => {
    it('renders connected by default as a small unlabeled circle', () => {
        installSystemBridge(
            () => undefined,
            () => undefined,
        );

        render(<ConnectionStatusIndicator />);

        const indicator = screen.getByTestId('connection-status');
        const style = indicator.getAttribute('style') ?? '';

        expect(indicator.getAttribute('data-status')).toBe('connected');
        expect(indicator.getAttribute('aria-label')).toBe('Connection status: connected');
        expect(indicator.textContent).toBe('');
        expect(indicator.className).toContain('connection-status-indicator--connected');
        expect(style).toContain('width: calc(var(--ch-space-sm) + var(--ch-space-xs))');
        expect(style).toContain('height: calc(var(--ch-space-sm) + var(--ch-space-xs))');
        expect(style).toContain('border-radius: var(--ch-radius-pill)');
        expect(style).toContain('background-color: var(--ch-color-success)');
        expect(style).toContain('opacity: var(--ch-opacity-disabled)');
    });

    it('resolves the status aria-label through the active-locale translator', () => {
        installSystemBridge(
            () => undefined,
            () => undefined,
        );

        baseRender(
            <I18nProvider gameOverride={{ 'engine.connection.statusAriaLabel': 'Link: {status}' }}>
                <ConnectionStatusIndicator />
            </I18nProvider>,
        );

        expect(screen.getByTestId('connection-status').getAttribute('aria-label')).toBe(
            'Link: connected',
        );
    });

    it('updates status metadata and color when onConnectionStatus emits', () => {
        let listener: StatusListener | null = null;
        installSystemBridge(
            (cb) => {
                listener = cb;
            },
            () => undefined,
        );

        render(<ConnectionStatusIndicator />);
        act(() => {
            listener?.('disconnected');
        });
        const indicator = screen.getByTestId('connection-status');
        expect(indicator.getAttribute('data-status')).toBe('disconnected');
        expect(indicator.getAttribute('aria-label')).toBe('Connection status: disconnected');
        expect(indicator.getAttribute('style')).toContain(
            'background-color: var(--ch-color-transparent)',
        );
        expect(indicator.getAttribute('style')).toContain('opacity: 0');

        act(() => {
            listener?.('connecting');
        });
        expect(indicator.getAttribute('data-status')).toBe('connecting');
        expect(indicator.getAttribute('aria-label')).toBe('Connection status: connecting');
        expect(indicator.getAttribute('style')).toContain(
            'background-color: var(--ch-color-warning-border)',
        );
        expect(indicator.getAttribute('style')).toContain('opacity: var(--ch-opacity-disabled)');

        act(() => {
            listener?.('error');
        });
        expect(indicator.getAttribute('data-status')).toBe('error');
        expect(indicator.getAttribute('aria-label')).toBe('Connection status: error');
        expect(indicator.getAttribute('style')).toContain(
            'background-color: var(--ch-color-error)',
        );
        expect(indicator.getAttribute('style')).toContain('opacity: var(--ch-opacity-disabled)');
    });

    it('applies a status-specific class for styling hooks', () => {
        let listener: StatusListener | null = null;
        installSystemBridge(
            (cb) => {
                listener = cb;
            },
            () => undefined,
        );

        render(<ConnectionStatusIndicator />);

        const indicator = screen.getByTestId('connection-status');
        expect(indicator.className).toContain('connection-status-indicator--connected');

        act(() => {
            listener?.('disconnected');
        });
        expect(indicator.className).toContain('connection-status-indicator--disconnected');
    });

    it('unsubscribes from onConnectionStatus on unmount', () => {
        const unsubscribe = vi.fn();
        installSystemBridge(() => undefined, unsubscribe);

        const view = render(<ConnectionStatusIndicator />);
        view.unmount();

        expect(unsubscribe).toHaveBeenCalledOnce();
    });
});
