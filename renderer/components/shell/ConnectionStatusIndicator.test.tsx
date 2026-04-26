// renderer/components/shell/ConnectionStatusIndicator.test.tsx
// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus } from '@chimera/electron/preload/api-types.js';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';

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
    it('renders connected by default with data-testid and data-status', () => {
        installSystemBridge(
            () => undefined,
            () => undefined,
        );

        render(<ConnectionStatusIndicator />);

        const node = screen.getByTestId('connection-status');
        expect(node.getAttribute('data-status')).toBe('connected');
        expect(node.textContent).toContain('connected');
    });

    it('updates data-status when onConnectionStatus emits', () => {
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
        expect(screen.getByTestId('connection-status').getAttribute('data-status')).toBe(
            'disconnected',
        );

        act(() => {
            listener?.('connecting');
        });
        expect(screen.getByTestId('connection-status').getAttribute('data-status')).toBe(
            'connecting',
        );
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

        const node = screen.getByTestId('connection-status');
        expect(node.className).toContain('connection-status-pill--connected');

        act(() => {
            listener?.('disconnected');
        });
        expect(node.className).toContain('connection-status-pill--disconnected');
    });

    it('unsubscribes from onConnectionStatus on unmount', () => {
        const unsubscribe = vi.fn();
        installSystemBridge(() => undefined, unsubscribe);

        const view = render(<ConnectionStatusIndicator />);
        view.unmount();

        expect(unsubscribe).toHaveBeenCalledOnce();
    });
});
