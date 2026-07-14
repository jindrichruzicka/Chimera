// electron/preload/apis/perspective-replay-api.ts
//
// Implements the `window.__chimera.replay.perspective` sub-namespace exposed to
// the renderer (§4.28, ADR F44b). The privacy-preserving counterpart to the
// deterministic `replay-api.ts`: perspective replays store one seat's already
// fog-filtered `PlayerSnapshot` frames for a single locked `viewerId`.
//
// Channel names live here (not in `shared/`) for the same reason as the
// deterministic surface: they are an internal preload↔main protocol detail, and
// the main-process handler module imports these same constants so the channel
// strings match on both sides (invariant #5).
//
// `openInPlayer` reuses the shared `chimera:replay:navigate` push owned by
// `replay-api.ts`, so this surface has no `onNavigate` of its own — the renderer
// subscribes through the deterministic `replay.onNavigate` for both. No
// `GameSnapshot` ever crosses these channels: `list` returns path strings,
// `exportCurrent` a path string, and every snapshot is an already-projected
// `PlayerSnapshot` (invariant #3 / #98).

import type {
    PerspectiveReplayAPI,
    PerspectiveReplayListItem,
    PerspectiveReplayPlaybackInfo,
    PlayerSnapshot,
} from '../api-types.js';
import {
    PerspectiveReplayListSchema,
    PerspectiveReplayPlaybackInfoSchema,
    ReplaySavedPathSchema,
    parseInvokeResponse,
} from '../shared/schemas.js';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.list}. */
export const PERSPECTIVE_REPLAY_LIST_CHANNEL = 'chimera:replay:perspective:list';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.exportCurrent}. */
export const PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL =
    'chimera:replay:perspective:export-current';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.openInPlayer}. */
export const PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL =
    'chimera:replay:perspective:open-in-player';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.delete}. */
export const PERSPECTIVE_REPLAY_DELETE_CHANNEL = 'chimera:replay:perspective:delete';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.openPlayback}. */
export const PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL = 'chimera:replay:perspective:open-playback';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.snapshotAt}. */
export const PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL = 'chimera:replay:perspective:snapshot-at';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.snapshotRange}. */
export const PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL =
    'chimera:replay:perspective:snapshot-range';

/** `ipcRenderer.invoke` target for {@link PerspectiveReplayAPI.closePlayback}. */
export const PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL =
    'chimera:replay:perspective:close-playback';

/**
 * Narrow port over `ipcRenderer`. The perspective surface only invokes (it
 * reuses the deterministic `chimera:replay:navigate` subscription), so — unlike
 * {@link import('./replay-api.js').ReplayApiIpcPort} — it needs no push slice.
 */
export interface PerspectiveReplayApiIpcPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Build the `window.__chimera.replay.perspective` sub-namespace. The caller
 * supplies the `ipcRenderer` port so the factory has no hidden dependency on the
 * Electron module graph.
 *
 * Note: `delete` is a reserved JavaScript keyword but is valid as an object
 * method name; the preload mirrors the canonical surface verbatim.
 */
export function createPerspectiveReplayApi(ipc: PerspectiveReplayApiIpcPort): PerspectiveReplayAPI {
    return {
        list: (gameId: string): Promise<PerspectiveReplayListItem[]> =>
            ipc.invoke(PERSPECTIVE_REPLAY_LIST_CHANNEL, gameId).then(
                (value) =>
                    // The declared contract is `Promise<PerspectiveReplayListItem[]>`
                    // (mutable array) whereas the schema returns the `readonly` view.
                    // The parsed array is a freshly-created copy no other caller
                    // holds, so the cast is sound — mirrors `replay-api.ts`'s `list`.
                    parseInvokeResponse(
                        PerspectiveReplayListSchema,
                        PERSPECTIVE_REPLAY_LIST_CHANNEL,
                        value,
                    ) as PerspectiveReplayListItem[],
            ),
        // `name` (the user-entered replay name from the save dialog) is carried
        // only when supplied; main fail-safe-defaults an absent/malformed payload
        // to an unnamed export.
        exportCurrent: (name?: string): Promise<string> =>
            ipc
                .invoke(PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL, {
                    ...(name !== undefined ? { name } : {}),
                })
                .then((value) =>
                    parseInvokeResponse(
                        ReplaySavedPathSchema,
                        PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
                        value,
                    ),
                ),
        // `saveable` defaults here so the wire always carries a concrete boolean;
        // main also fail-safe-defaults to `false` (mirrors `replay-api.ts`).
        openInPlayer: async (path: string, saveable = false): Promise<void> => {
            await ipc.invoke(PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL, path, saveable);
        },
        delete: async (path: string): Promise<void> => {
            await ipc.invoke(PERSPECTIVE_REPLAY_DELETE_CHANNEL, path);
        },
        openPlayback: (path: string): Promise<PerspectiveReplayPlaybackInfo> =>
            ipc
                .invoke(PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL, path)
                .then((value) =>
                    parseInvokeResponse(
                        PerspectiveReplayPlaybackInfoSchema,
                        PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
                        value,
                    ),
                ),
        // The returned value is a stored PlayerSnapshot already projected by main;
        // no structural re-validation, mirroring `replay.snapshotAt` (invariant
        // #3: a full GameSnapshot can never reach this channel).
        snapshotAt: (tick: number): Promise<PlayerSnapshot> =>
            ipc
                .invoke(PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL, tick)
                .then((value) => value as PlayerSnapshot),
        // Like `snapshotAt`, every element is a stored PlayerSnapshot (invariant
        // #3); the range is passed as one `{from, to}` payload validated by
        // `ReplaySnapshotRangeSchema` on the main side.
        snapshotRange: (from: number, to: number): Promise<PlayerSnapshot[]> =>
            ipc
                .invoke(PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL, { from, to })
                .then((value) => value as PlayerSnapshot[]),
        closePlayback: async (): Promise<void> => {
            await ipc.invoke(PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL);
        },
    };
}
