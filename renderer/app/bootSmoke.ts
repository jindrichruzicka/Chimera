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
//
// The logger port carries a severity (§4.27, Invariant #67): success is an
// `info` the page adapter leaves on the unforwarded `console.log`, while both
// failure paths are a `warn` the adapter routes to the forwarded
// `console.warn` — a broken bridge in a packaged build (blank window) then
// lands in the log file, not only a devtools console nobody has open. This
// module stays DOM-free and bridge-free: the routing decision lives here (it
// knows success from failure), the transport lives in the page.

import type { ChimeraAPI } from '@chimera-engine/simulation/bridge/api-types.js';

/** Narrow slice of `ChimeraAPI` needed by the boot smoke. */
export type BootSmokeBridge = Pick<ChimeraAPI, 'system'>;

/**
 * Structured logger port. `info` is the healthy round-trip (unforwarded in
 * production); `warn` is a bridge failure the caller forwards to the log file.
 */
export type BootSmokeLogger = (level: 'info' | 'warn', message: string, detail?: unknown) => void;

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
        logger('warn', '[chimera] preload bridge unavailable');
        return;
    }
    try {
        const info = await bridge.system.platform();
        logger('info', '[chimera] preload bridge live', info);
    } catch (error) {
        logger('warn', '[chimera] preload bridge platform() failed', error);
    }
}
