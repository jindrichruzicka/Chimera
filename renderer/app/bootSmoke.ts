// Minimal boot-time smoke helper: calls `window.__chimera.system.platform()`
// and forwards the result to the supplied logger. Lives outside the React
// shell page so the behaviour can be unit-tested without a DOM runtime — the
// page itself is a thin client component that wires this helper into a
// `useEffect`.
//
// This is the §12 "Electron boots, preload bridge wired" boot-smoke check.
// When the preload bridge is live the logger records the host platform; when
// it is missing or fails the logger records the failure, which surfaces a
// broken bridge immediately in devtools.

import type { ChimeraAPI } from '@chimera-engine/simulation/bridge/api-types.js';

/** Narrow slice of `ChimeraAPI` needed by the boot smoke. */
export type BootSmokeBridge = Pick<ChimeraAPI, 'system'>;

/** Structured logger port. Production callers wrap `console.log`. */
export type BootSmokeLogger = (message: string, detail?: unknown) => void;

/**
 * Probe the preload bridge by invoking `system.platform()`. Success and
 * failure are both logged so the renderer developer sees *something* on
 * every boot — a silent no-op would hide a broken bridge.
 */
export async function logPlatformOnBoot(
    bridge: BootSmokeBridge | undefined,
    logger: BootSmokeLogger,
): Promise<void> {
    if (!bridge) {
        logger('[chimera] preload bridge unavailable');
        return;
    }
    try {
        const info = await bridge.system.platform();
        logger('[chimera] preload bridge live', info);
    } catch (error) {
        logger('[chimera] preload bridge platform() failed', error);
    }
}
