// electron/main/network-diagnostics.test.ts
//
// Unit tests for buildNetworkDiagnostics().
// Tests cover:
//   - filtering: internal interfaces and IPv6 families are dropped
//   - hostPort null vs populated, with isHosting following it
//   - empty interfaces → empty localAddresses
//   - multiple interfaces flattened into a single address list
//
// Follows TDD red-first; no Electron/`os` import — uses injected narrow ports.

import { describe, expect, it } from 'vitest';
import {
    buildNetworkDiagnostics,
    type NetworkDiagnosticsOptions,
    type NetworkInterfaceEntry,
} from './network-diagnostics.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function entry(opts: Partial<NetworkInterfaceEntry> = {}): NetworkInterfaceEntry {
    return {
        address: opts.address ?? '192.168.0.10',
        family: opts.family ?? 'IPv4',
        internal: opts.internal ?? false,
    };
}

function makeOptions(
    overrides: Partial<NetworkDiagnosticsOptions> = {},
): NetworkDiagnosticsOptions {
    return {
        networkInterfaces: () => ({ en0: [entry()] }),
        getHostPort: () => null,
        ...overrides,
    };
}

// ─── Address filtering ─────────────────────────────────────────────────────────

describe('buildNetworkDiagnostics — address filtering', () => {
    it('keeps non-internal IPv4 addresses', () => {
        const result = buildNetworkDiagnostics(
            makeOptions({
                networkInterfaces: () => ({ en0: [entry({ address: '10.0.0.5' })] }),
            }),
        );
        expect(result.localAddresses).toEqual(['10.0.0.5']);
    });

    it('drops loopback / internal interfaces', () => {
        const result = buildNetworkDiagnostics(
            makeOptions({
                networkInterfaces: () => ({
                    lo0: [entry({ address: '127.0.0.1', internal: true })],
                    en0: [entry({ address: '10.0.0.5' })],
                }),
            }),
        );
        expect(result.localAddresses).toEqual(['10.0.0.5']);
    });

    it('drops IPv6 families', () => {
        const result = buildNetworkDiagnostics(
            makeOptions({
                networkInterfaces: () => ({
                    en0: [
                        entry({ address: 'fe80::1', family: 'IPv6' }),
                        entry({ address: '10.0.0.5', family: 'IPv4' }),
                    ],
                }),
            }),
        );
        expect(result.localAddresses).toEqual(['10.0.0.5']);
    });

    it('flattens addresses across multiple interfaces', () => {
        const result = buildNetworkDiagnostics(
            makeOptions({
                networkInterfaces: () => ({
                    en0: [entry({ address: '10.0.0.5' })],
                    en1: [entry({ address: '192.168.1.20' })],
                }),
            }),
        );
        expect(result.localAddresses).toEqual(['10.0.0.5', '192.168.1.20']);
    });

    it('returns an empty list when there are no interfaces', () => {
        const result = buildNetworkDiagnostics(makeOptions({ networkInterfaces: () => ({}) }));
        expect(result.localAddresses).toEqual([]);
    });

    it('tolerates undefined interface entries (os.networkInterfaces dict gaps)', () => {
        const result = buildNetworkDiagnostics(
            makeOptions({
                networkInterfaces: () => ({
                    en0: undefined,
                    en1: [entry({ address: '10.0.0.5' })],
                }),
            }),
        );
        expect(result.localAddresses).toEqual(['10.0.0.5']);
    });
});

// ─── Host port / hosting flag ───────────────────────────────────────────────────

describe('buildNetworkDiagnostics — host port', () => {
    it('reports the host port and isHosting when hosting', () => {
        const result = buildNetworkDiagnostics(makeOptions({ getHostPort: () => 51234 }));
        expect(result.hostPort).toBe(51234);
        expect(result.isHosting).toBe(true);
    });

    it('reports null port and isHosting false when not hosting', () => {
        const result = buildNetworkDiagnostics(makeOptions({ getHostPort: () => null }));
        expect(result.hostPort).toBeNull();
        expect(result.isHosting).toBe(false);
    });
});
