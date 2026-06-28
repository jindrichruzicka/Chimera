// electron/main/network-diagnostics.ts
//
// Builds the `NetworkDiagnostics` snapshot for the Debug Inspector's NAT /
// port-forward guidance (§6, §11) — the host's non-internal IPv4 addresses and
// the active hosted port.
//
// Design notes:
//  - No direct `import from 'electron'` or `'node:os'` — both the interface
//    list and the host port are injected via narrow ports, so the module is
//    trivially unit-testable and the composition root owns the live wiring.
//  - `NetworkDiagnostics` is imported `type`-only from `simulation/debug`, so
//    this module carries zero runtime coupling to the debug graph (Invariant
//    #31); it is itself loaded only under `IS_DEBUG_MODE` (Invariant #27).

import type { NetworkDiagnostics } from '@chimera-engine/simulation/debug/DebugProtocol.js';

// ─── Narrow port types ─────────────────────────────────────────────────────────

/**
 * Minimal interface entry. Mirrors the fields of `os.NetworkInterfaceInfo`
 * that the builder actually reads, so tests can inject plain stubs without a
 * dependency on Node's `os` typings (whose `family` representation has drifted
 * across releases).
 */
export interface NetworkInterfaceEntry {
    readonly address: string;
    /** `'IPv4' | 'IPv6'` — only IPv4 entries are surfaced. */
    readonly family: string;
    readonly internal: boolean;
}

/** Injected facts needed to build a {@link NetworkDiagnostics} snapshot. */
export interface NetworkDiagnosticsOptions {
    /** `os.networkInterfaces` — keyed by interface name; entries may be absent. */
    readonly networkInterfaces: () => NodeJS.Dict<readonly NetworkInterfaceEntry[]>;
    /** Active hosted port, or `null` when not hosting (e.g. `LobbyManager.getHostPort`). */
    readonly getHostPort: () => number | null;
}

// ─── buildNetworkDiagnostics ────────────────────────────────────────────────────

/**
 * Pure builder — flattens the injected interface map to the host's non-internal
 * IPv4 addresses and reads the active hosted port. No side effects.
 */
export function buildNetworkDiagnostics(options: NetworkDiagnosticsOptions): NetworkDiagnostics {
    const { networkInterfaces, getHostPort } = options;

    const localAddresses = Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => entry.internal === false && entry.family === 'IPv4')
        .map((entry) => entry.address);

    const hostPort = getHostPort();

    return {
        localAddresses,
        hostPort,
        isHosting: hostPort !== null,
    };
}
