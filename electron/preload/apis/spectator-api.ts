// Implements the `window.__chimera.spectate` namespace exposed to the renderer
// (§4.1 / §4.3 — Spectator Mode). Only depends on a narrow
// `SpectatorApiIpcPort` so the factory is trivially testable without spinning
// up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides (Invariant #5).

import type { PlayerId, SpectatorAPI } from '../api-types.js';

// ─── Channel constants ────────────────────────────────────────────────────────

/** `ipcRenderer.send` target for {@link SpectatorAPI.setFollowedTarget} (fire-and-forget). */
export const SPECTATE_SET_TARGET_CHANNEL = 'chimera:spectate:set-target';

// ─── Port interface ───────────────────────────────────────────────────────────

/**
 * Narrow slice of `ipcRenderer` required by the spectate namespace — only the
 * fire-and-forget `send` (there are no invoke round-trips or push channels).
 */
export interface SpectatorApiIpcPort {
    send(channel: string, ...args: unknown[]): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build the `window.__chimera.spectate` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph. Implements {@link SpectatorAPI}.
 */
export function createSpectatorApi(ipc: SpectatorApiIpcPort): SpectatorAPI {
    return {
        setFollowedTarget(targetPlayerId: PlayerId): void {
            ipc.send(SPECTATE_SET_TARGET_CHANNEL, { targetPlayerId });
        },
    };
}
