// electron/preload/apis/replay-api.ts
//
// Implements the `window.__chimera.replay` namespace exposed to the renderer
// (§4.28). Only depends on a narrow `ReplayApiIpcPort` so the factory is
// trivially testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides (invariant #5).
//
// The host-only constraint (§4.28) is enforced in the main-process handlers —
// the preload bridge simply forwards calls and has no opinion about who is
// allowed to issue them. No `GameSnapshot` ever crosses these channels: `list`
// returns projected `ReplayListItem`s, `exportCurrentMatch` returns a path
// string, and the file itself is only loaded when the player route opens it
// (invariant #3 / #71).

import type {
    PlayerSnapshot,
    ReplayAPI,
    ReplayExportIntent,
    ReplayListItem,
    ReplayNavigatePayload,
    ReplayPlaybackInfo,
    Unsubscribe,
} from '../api-types.js';
import type { IpcListener, PushListenerPort } from '../shared/listener.js';
import { subscribePush } from '../shared/listener.js';
import { createPerspectiveReplayApi } from './perspective-replay-api.js';
import {
    ReplayListSchema,
    ReplayPlaybackInfoSchema,
    ReplaySavedPathSchema,
    parseInvokeResponse,
} from '../shared/schemas.js';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.list}. */
export const REPLAY_LIST_CHANNEL = 'chimera:replay:list';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.exportCurrentMatch}. */
export const REPLAY_EXPORT_CURRENT_MATCH_CHANNEL = 'chimera:replay:export-current-match';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.openInPlayer}. */
export const REPLAY_OPEN_IN_PLAYER_CHANNEL = 'chimera:replay:open-in-player';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.delete}. */
export const REPLAY_DELETE_CHANNEL = 'chimera:replay:delete';

/**
 * `ipcRenderer.on` target for {@link ReplayAPI.onNavigate}. Main pushes the
 * replay file path via `webContents.send` when `openInPlayer` is invoked, so
 * the renderer route can switch to the replay player.
 */
export const REPLAY_NAVIGATE_CHANNEL = 'chimera:replay:navigate';

/**
 * `ipcRenderer.on` target for {@link ReplayAPI.onExported}. Main pushes the
 * saved replay path via `webContents.send` after a successful
 * `export-current-match`, so a renderer listener can raise the "Replay saved"
 * toast (§4.30) — the in-match game screen that triggers the export may not
 * reach the renderer toast store (Invariant #96).
 */
export const REPLAY_EXPORTED_CHANNEL = 'chimera:replay:exported';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.openPlayback}. */
export const REPLAY_OPEN_PLAYBACK_CHANNEL = 'chimera:replay:open-playback';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.snapshotAt}. */
export const REPLAY_SNAPSHOT_AT_CHANNEL = 'chimera:replay:snapshot-at';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.snapshotRange}. */
export const REPLAY_SNAPSHOT_RANGE_CHANNEL = 'chimera:replay:snapshot-range';

/** `ipcRenderer.invoke` target for {@link ReplayAPI.closePlayback}. */
export const REPLAY_CLOSE_PLAYBACK_CHANNEL = 'chimera:replay:close-playback';

/**
 * Back-compat alias for {@link IpcListener}. Retained for symmetry with the
 * other namespaces; new code should use {@link IpcListener} directly.
 */
export type ReplayApiListener = IpcListener;

/**
 * Narrow port over `ipcRenderer`. Extends {@link PushListenerPort} for the
 * `chimera:replay:navigate` subscription slice and adds variadic `invoke`
 * (`exportCurrentMatch` takes an optional intent argument, the rest take
 * exactly one or none).
 */
export interface ReplayApiIpcPort extends PushListenerPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Build the `window.__chimera.replay` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 *
 * Note: `delete` is a reserved JavaScript keyword but is valid as an object
 * method name; the preload mirrors the canonical surface verbatim.
 */
export function createReplayApi(ipc: ReplayApiIpcPort): ReplayAPI {
    return {
        list: (gameId: string): Promise<ReplayListItem[]> =>
            ipc.invoke(REPLAY_LIST_CHANNEL, gameId).then(
                (value) =>
                    // The declared contract is `Promise<ReplayListItem[]>` (mutable
                    // array) whereas the schema returns `readonly ReplayListItem[]`.
                    // Casting here is safe: the parsed array is a freshly-created
                    // copy that no other caller holds a reference to.
                    parseInvokeResponse(
                        ReplayListSchema,
                        REPLAY_LIST_CHANNEL,
                        value,
                    ) as ReplayListItem[],
            ),
        // Resolve the default here so the wire always carries a concrete intent
        // (`'save' | 'view'`); main also fail-safe-defaults, giving defence in
        // depth against an omitted argument.
        exportCurrentMatch: (intent: ReplayExportIntent = 'save'): Promise<string> =>
            ipc
                .invoke(REPLAY_EXPORT_CURRENT_MATCH_CHANNEL, intent)
                .then((value) =>
                    parseInvokeResponse(
                        ReplaySavedPathSchema,
                        REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
                        value,
                    ),
                ),
        // `saveable` defaults here so the wire always carries a concrete boolean;
        // main also fail-safe-defaults to `false`, giving defence in depth against
        // an omitted argument.
        openInPlayer: async (path: string, saveable = false): Promise<void> => {
            await ipc.invoke(REPLAY_OPEN_IN_PLAYER_CHANNEL, path, saveable);
        },
        delete: async (path: string): Promise<void> => {
            await ipc.invoke(REPLAY_DELETE_CHANNEL, path);
        },
        onNavigate: (listener: (payload: ReplayNavigatePayload) => void): Unsubscribe =>
            subscribePush<ReplayNavigatePayload>(ipc, REPLAY_NAVIGATE_CHANNEL, listener),
        onExported: (listener: (path: string) => void): Unsubscribe =>
            subscribePush<string>(ipc, REPLAY_EXPORTED_CHANNEL, listener),
        openPlayback: (path: string): Promise<ReplayPlaybackInfo> =>
            ipc
                .invoke(REPLAY_OPEN_PLAYBACK_CHANNEL, path)
                .then((value) =>
                    parseInvokeResponse(
                        ReplayPlaybackInfoSchema,
                        REPLAY_OPEN_PLAYBACK_CHANNEL,
                        value,
                    ),
                ),
        // The returned value is a PlayerSnapshot already projected by main; no
        // structural re-validation here, mirroring `game.getCurrentSnapshot`
        // (invariant #3: main is the sole producer; a full GameSnapshot can
        // never reach this channel).
        snapshotAt: (tick: number): Promise<PlayerSnapshot> =>
            ipc.invoke(REPLAY_SNAPSHOT_AT_CHANNEL, tick).then((value) => value as PlayerSnapshot),
        // Like `snapshotAt`, every element is a PlayerSnapshot already projected
        // by main (invariant #3); the range is passed as a single `{from, to}`
        // payload validated by `ReplaySnapshotRangeSchema` on the main side.
        snapshotRange: (from: number, to: number): Promise<PlayerSnapshot[]> =>
            ipc
                .invoke(REPLAY_SNAPSHOT_RANGE_CHANNEL, { from, to })
                .then((value) => value as PlayerSnapshot[]),
        closePlayback: async (): Promise<void> => {
            await ipc.invoke(REPLAY_CLOSE_PLAYBACK_CHANNEL);
        },
        // The perspective sub-namespace (§4.28, ADR F44b). Built from the same
        // `ipcRenderer` port and hung off `.perspective`, so
        // `window.__chimera.replay.perspective.*` is exposed without disturbing
        // the deterministic surface above. `ReplayApiIpcPort` structurally
        // satisfies the narrower `PerspectiveReplayApiIpcPort` (both `invoke`).
        perspective: createPerspectiveReplayApi(ipc),
    };
}
