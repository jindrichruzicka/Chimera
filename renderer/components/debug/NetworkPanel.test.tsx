// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NetworkDiagnostics } from '@chimera-engine/simulation/bridge/debug-api-types.js';
import { createDebugApiMock, makeNetworkDiagnostics } from './__test-support__/DebugApiStubs';
import { NetworkPanel } from './NetworkPanel';

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
});

/** Install a clipboard spy; jsdom leaves `navigator.clipboard` undefined. */
function stubClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    return writeText;
}

describe('NetworkPanel', () => {
    it('shows a loading indicator while the diagnostics are pending', () => {
        const api = createDebugApiMock({
            getNetworkDiagnostics: vi.fn(() => new Promise<NetworkDiagnostics>(() => {})),
        });
        render(<NetworkPanel api={api} />);

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('shows an alert when getNetworkDiagnostics rejects', async () => {
        const api = createDebugApiMock({
            getNetworkDiagnostics: vi.fn(() => Promise.reject(new Error('bridge unavailable'))),
        });
        render(<NetworkPanel api={api} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('bridge unavailable');
        });
    });

    it('renders the hosting badge, port, and joinable addresses while hosting', async () => {
        const api = createDebugApiMock({
            getNetworkDiagnostics: vi.fn(() =>
                Promise.resolve(
                    makeNetworkDiagnostics({
                        localAddresses: ['192.168.1.42'],
                        hostPort: 7777,
                    }),
                ),
            ),
        });
        render(<NetworkPanel api={api} />);

        expect(await screen.findByText('Hosting')).toBeInTheDocument();
        expect(screen.getByTestId('host-port')).toHaveTextContent('7777');
        expect(screen.getByText('192.168.1.42:7777')).toBeInTheDocument();
    });

    it('copies the joinable endpoint to the clipboard', async () => {
        const writeText = stubClipboard();
        const api = createDebugApiMock({
            getNetworkDiagnostics: vi.fn(() =>
                Promise.resolve(
                    makeNetworkDiagnostics({ localAddresses: ['192.168.1.42'], hostPort: 7777 }),
                ),
            ),
        });
        render(<NetworkPanel api={api} />);

        const copyButton = await screen.findByRole('button', { name: 'Copy 192.168.1.42:7777' });
        fireEvent.click(copyButton);

        expect(writeText).toHaveBeenCalledWith('192.168.1.42:7777');
    });

    it('shows the not-hosting empty state with no port', async () => {
        const api = createDebugApiMock({
            getNetworkDiagnostics: vi.fn(() => Promise.resolve(makeNetworkDiagnostics())),
        });
        render(<NetworkPanel api={api} />);

        expect(await screen.findByText('Not hosting')).toBeInTheDocument();
        expect(
            screen.getByText('Not hosting — start a lobby to get a join address.'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('host-port')).not.toBeInTheDocument();
        expect(screen.getByText('No non-internal IPv4 interfaces found.')).toBeInTheDocument();
    });

    it('expands the static port-forward guide on demand', async () => {
        const api = createDebugApiMock({
            getNetworkDiagnostics: vi.fn(() =>
                Promise.resolve(
                    makeNetworkDiagnostics({ localAddresses: ['10.0.0.5'], hostPort: 9000 }),
                ),
            ),
        });
        render(<NetworkPanel api={api} />);

        const toggle = await screen.findByRole('button', { name: /port-forwarding guide/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('port-forward-guide')).not.toBeInTheDocument();

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('port-forward-guide')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
    });
});
