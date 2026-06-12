// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TickEntry } from '@chimera/electron/preload/debug-api-types.js';
import {
    createDebugApiMock,
    makeTickEntry,
    type DebugApiMock,
} from '../../components/debug/__test-support__/DebugApiStubs';
import DebugInspectorPage from './page';

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimeraDebug');
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

const TICKS: readonly TickEntry[] = [
    makeTickEntry({ tick: 1, inRingBuffer: false, actionType: 'engine:end_turn' }),
    makeTickEntry({ tick: 2, inRingBuffer: true }),
];

function installPageBridge(): DebugApiMock {
    const api = createDebugApiMock({ listTicks: vi.fn(() => Promise.resolve(TICKS)) });
    Object.defineProperty(window, '__chimeraDebug', { configurable: true, value: api });
    return api;
}

describe('DebugInspectorPage', () => {
    it('shows an unavailable state and no tabs when the bridge is missing', () => {
        render(<DebugInspectorPage />);

        expect(screen.getByText(/Inspector bridge unavailable/)).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('renders the three Inspector tabs and mounts every panel up front', async () => {
        const api = installPageBridge();
        render(<DebugInspectorPage />);

        expect(screen.getByRole('tablist', { name: 'Inspector panels' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Snapshot' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Action Log' })).toBeInTheDocument();

        // Tabs keep all panels mounted (hidden, not unmounted), so every
        // panel's initial fetch fires on page mount.
        await waitFor(() => {
            expect(api.listTicks).toHaveBeenCalledOnce();
            expect(api.getActionLog).toHaveBeenCalledOnce();
        });
    });

    it('reveals the Action Log panel when its tab is activated', async () => {
        const user = userEvent.setup();
        installPageBridge();
        render(<DebugInspectorPage />);

        expect(screen.getByTestId('action-log-panel')).not.toBeVisible();

        await user.click(screen.getByRole('tab', { name: 'Action Log' }));

        expect(screen.getByTestId('action-log-panel')).toBeVisible();
        expect(screen.getByTestId('timeline-panel')).not.toBeVisible();
    });

    it('defaults the shared selection to the newest loaded tick', async () => {
        const api = installPageBridge();
        render(<DebugInspectorPage />);

        await waitFor(() => {
            expect(api.getSnapshot).toHaveBeenCalledWith(2);
        });
    });

    it('shares a tick selected in the Timeline with the Snapshot panel and pauses live mode', async () => {
        const user = userEvent.setup();
        const api = installPageBridge();
        render(<DebugInspectorPage />);

        await waitFor(() => {
            expect(screen.getByTestId('timeline-tick-1')).toBeInTheDocument();
        });
        await user.click(screen.getByTestId('timeline-tick-1'));

        await waitFor(() => {
            expect(api.getSnapshot).toHaveBeenCalledWith(1);
        });
        expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('never touches the game bridge (invariant #28)', () => {
        Object.defineProperty(window, '__chimera', {
            configurable: true,
            get(): never {
                throw new Error('debug page must not read window.__chimera');
            },
        });
        installPageBridge();

        render(<DebugInspectorPage />);

        expect(screen.getByRole('tablist', { name: 'Inspector panels' })).toBeInTheDocument();
    });
});
