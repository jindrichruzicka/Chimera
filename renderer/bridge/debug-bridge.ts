// renderer/bridge/debug-bridge.ts
//
// Shared accessor for window.__chimeraDebug (the Inspector preload bridge,
// §4.12 — Runtime Debug Layer). Mirrors `system-bridge.ts`.
//
// Rules:
//   - Must NOT import from: electron/main/, simulation/debug/ (type-only
//     contract comes via the preload's debug-api-types re-export root).
//   - Reads `globalThis`, never `window`, so the Next.js static-prerender
//     pass (where `window` is undefined) stays safe.
//   - Accepts an optional `source` parameter so tests can supply a fake
//     global without touching `globalThis`.

import type { ChimeraDebugApi } from '@chimera/electron/preload/debug-api-types.js';

// ── Bridge accessor ───────────────────────────────────────────────────────────

interface ChimeraDebugBridge {
    readonly __chimeraDebug?: ChimeraDebugApi;
}

/**
 * Returns the `ChimeraDebugApi` preload bridge, or `null` when it is not
 * available — i.e. anywhere except the Inspector `BrowserWindow`, which is
 * the only window whose preload exposes it (Invariant #28).
 */
export function getDebugBridge(source: unknown = globalThis): ChimeraDebugApi | null {
    const bridge = source as ChimeraDebugBridge;
    return bridge.__chimeraDebug ?? null;
}
