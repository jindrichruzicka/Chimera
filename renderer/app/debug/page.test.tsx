// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    ActionHistoryEntry,
    TickEntry,
} from '@chimera-engine/simulation/bridge/debug-api-types.js';
import {
    createDebugApiMock,
    makeActionHistoryEntry,
    makePerfStats,
    makeSnapshotDiff,
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

// Newest tickApplied (5) deliberately differs from the newest listTicks tick
// (2), so the seeding tests can prove the selection comes from the Action
// Log backfill rather than the Diff View's listTicks call.
const LOG_ENTRIES: readonly ActionHistoryEntry[] = [
    makeActionHistoryEntry({ tickApplied: 1, turnNumber: 1, type: 'engine:end_turn' }),
    makeActionHistoryEntry({ tickApplied: 5, turnNumber: 2, type: 'game:move' }),
];

function installPageBridge(): DebugApiMock {
    const api = createDebugApiMock({
        listTicks: vi.fn(() => Promise.resolve(TICKS)),
        getActionLog: vi.fn(() => Promise.resolve(LOG_ENTRIES)),
        diff: vi.fn((fromTick: number, toTick: number) =>
            Promise.resolve(makeSnapshotDiff(fromTick, toTick)),
        ),
        getPerfStats: vi.fn(() => Promise.resolve(makePerfStats())),
    });
    Object.defineProperty(window, '__chimeraDebug', { configurable: true, value: api });
    return api;
}

describe('DebugInspectorPage', () => {
    it('shows an unavailable state and no tabs when the bridge is missing', () => {
        render(<DebugInspectorPage />);

        expect(screen.getByText(/Inspector bridge unavailable/)).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('renders no window caption above the tabs', () => {
        installPageBridge();
        render(<DebugInspectorPage />);

        expect(screen.queryByRole('heading', { name: 'Debug Inspector' })).not.toBeInTheDocument();
    });

    it('renders the five Inspector tabs and mounts every panel up front', async () => {
        const api = installPageBridge();
        render(<DebugInspectorPage />);

        expect(screen.getByRole('tablist', { name: 'Inspector panels' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Timeline' })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Snapshot' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Action Log' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Diff' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Performance' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Network' })).toBeInTheDocument();

        // Tabs keep all panels mounted (hidden, not unmounted), so every
        // panel's initial fetch fires on page mount. Diff View owns the only
        // listTicks call.
        await waitFor(() => {
            expect(api.listTicks).toHaveBeenCalledTimes(1);
            expect(api.getActionLog).toHaveBeenCalledOnce();
            expect(api.getPerfStats).toHaveBeenCalledOnce();
            expect(api.getNetworkDiagnostics).toHaveBeenCalledOnce();
        });
    });

    it('shows the Action Log panel by default', () => {
        installPageBridge();
        render(<DebugInspectorPage />);

        expect(screen.getByTestId('action-log-panel')).toBeVisible();
    });

    it('renders no translation-token toggle (token mode moved to the global F4 hotkey)', () => {
        installPageBridge();
        render(<DebugInspectorPage />);

        expect(
            screen.queryByRole('switch', { name: 'Show translation tokens' }),
        ).not.toBeInTheDocument();
    });

    it('reveals the Performance panel when its tab is activated', async () => {
        const user = userEvent.setup();
        installPageBridge();
        render(<DebugInspectorPage />);

        expect(screen.getByTestId('performance-panel')).not.toBeVisible();

        await user.click(screen.getByRole('tab', { name: 'Performance' }));

        expect(screen.getByTestId('performance-panel')).toBeVisible();
        expect(screen.getByTestId('action-log-panel')).not.toBeVisible();
    });

    it('reveals the Network panel when its tab is activated', async () => {
        const user = userEvent.setup();
        installPageBridge();
        render(<DebugInspectorPage />);

        expect(screen.getByTestId('network-panel')).not.toBeVisible();

        await user.click(screen.getByRole('tab', { name: 'Network' }));

        expect(screen.getByTestId('network-panel')).toBeVisible();
        expect(screen.getByTestId('action-log-panel')).not.toBeVisible();
    });

    it('defaults the shared selection to the state after the newest logged action', async () => {
        const api = installPageBridge();
        render(<DebugInspectorPage />);

        // The log records pre-action ticks; the newest action (tickApplied 5)
        // produced the state at tick 6, which is the newest resolvable tick.
        await waitFor(() => {
            expect(api.getSnapshot).toHaveBeenCalledWith(6);
        });
    });

    it('shares a tick double-clicked in the Action Log with the Snapshot panel', async () => {
        const user = userEvent.setup();
        const api = installPageBridge();
        render(<DebugInspectorPage />);

        await waitFor(() => {
            expect(screen.getByTestId('action-row-1')).toBeInTheDocument();
        });
        await user.dblClick(screen.getByTestId('action-row-1'));

        await waitFor(() => {
            expect(api.getSnapshot).toHaveBeenCalledWith(1);
        });
        expect(screen.getByTestId('snapshot-panel')).toBeVisible();
        expect(screen.getByTestId('action-log-panel')).not.toBeVisible();
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
