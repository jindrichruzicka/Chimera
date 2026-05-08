// renderer/app/main-menu/useQuit.ts
//
// Thin hook that wraps window.__chimera.system.quit() for use in
// MainMenuPage. Isolates the direct bridge access from the component
// and makes the call site testable without touching window globals.
//
// Architecture reference: §4.1 — System / IPC layer; renderer.instructions.md
//
// Rules:
//   - Must NOT import from: electron/main/, simulation/engine/, networking/.
//   - Reads `window.__chimera.system` at call-time via getSystemBridge() so
//     tests can supply a fake global without touching `globalThis`.

import { useCallback } from 'react';
import type { SystemAPI } from '@chimera/electron/preload/api-types.js';

// ── Bridge accessor ───────────────────────────────────────────────────────────

interface ChimeraBridge {
    readonly __chimera?: {
        readonly system?: SystemAPI;
    };
}

const MISSING_BRIDGE_ERROR = 'Chimera system API not available';

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

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a stable callback that quits the application via the preload
 * bridge. Throws if the bridge is unavailable.
 */
export function useQuit(): () => void {
    return useCallback(() => {
        const system = getSystemBridge();
        if (!system) {
            throw new Error(MISSING_BRIDGE_ERROR);
        }
        system.quit();
    }, []);
}
