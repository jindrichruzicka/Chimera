// renderer/bridge/system-bridge.ts
//
// Shared accessor for window.__chimera.system (SystemAPI preload bridge slice).
//
// Architecture reference: §4.1 — System / IPC layer; renderer.instructions.md
//
// Rules:
//   - Must NOT import from: electron/main/, simulation/engine/, networking/.
//   - Accepts an optional `source` parameter so tests can supply a fake global
//     without touching `globalThis`.

import type { SystemAPI } from '@chimera/electron/preload/api-types.js';

// ── Bridge accessor ───────────────────────────────────────────────────────────

interface ChimeraBridge {
    readonly __chimera?: {
        readonly system?: SystemAPI;
    };
}

/**
 * Returns the `SystemAPI` slice of the preload bridge, or `null` when the
 * bridge is not available (e.g. in a non-Electron context or before wiring).
 *
 * Accepts an optional `source` parameter so tests can supply a fake global
 * without touching `globalThis`.
 */
export function getSystemBridge(source: unknown = globalThis): SystemAPI | null {
    const bridge = source as ChimeraBridge;
    return bridge.__chimera?.system ?? null;
}
