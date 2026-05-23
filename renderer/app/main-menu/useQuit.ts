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
import { getSystemBridge } from '../../bridge/system-bridge';

export { getSystemBridge };

const MISSING_BRIDGE_ERROR = 'Chimera system API not available';

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
