// electron/preload/game-api.ts
//
// Implements the `window.__chimera.game` namespace exposed to the renderer
// (§4.1). Only depends on a narrow `GameApiIpcPort` so the factory is
// trivially testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides (invariant 5).
//
// Invariant 1: `GameSnapshot` never crosses any IPC boundary. This module
// deliberately imports only `PlayerSnapshot` — the projected-for-viewer type.
// There is no import of `GameSnapshot` anywhere in this file.
//
// Invariant 4: The renderer reads state; it never writes state directly.
// `sendAction` is the only write path the renderer has.

import type {
    ActionRejection,
    EngineAction,
    GameAPI,
    PlayerId,
    PlayerSnapshot,
    Unsubscribe,
} from './api.js';
import { ActionRejectionSchema, parseInvokeResponse } from './schemas.js';

/** `ipcRenderer.send` target for {@link GameAPI.sendAction}. */
export const GAME_SEND_ACTION_CHANNEL = 'chimera:game:send-action';

/**
 * `ipcRenderer.on` target for {@link GameAPI.onSnapshot}. Main pushes a
 * projected {@link PlayerSnapshot} for the active viewer via
 * `webContents.send` on this channel.
 */
export const GAME_SNAPSHOT_CHANNEL = 'chimera:game:snapshot';

/**
 * `ipcRenderer.on` target for {@link GameAPI.onActionRejected}. Main pushes
 * a typed {@link ActionRejection} via `event.sender.send` whenever an
 * action submitted through {@link GAME_SEND_ACTION_CHANNEL} is refused —
 * today at the IPC boundary (envelope validation), and once F03–F15 land,
 * at Stage 3 of the ActionPipeline.
 *
 * Wire-shape analogue of the §4.3 WebSocket `ServerMessage` REJECT frame.
 */
export const GAME_ACTION_REJECTED_CHANNEL = 'chimera:game:action-rejected';

/** `ipcRenderer.invoke` target for {@link GameAPI.switchActiveSeat}. */
export const GAME_SWITCH_SEAT_CHANNEL = 'chimera:game:switch-seat';

/**
 * Shape of an `ipcRenderer` listener. Electron's real signature is
 * `(event: IpcRendererEvent, ...args: unknown[]) => void`; we keep it
 * permissively typed here so a test stub can invoke it with any payload.
 */
export type GameApiListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow port over `ipcRenderer`. Exposing only the four methods the game
 * namespace uses keeps the API surface auditable and lets unit tests inject a
 * pure in-memory stub instead of mocking the real Electron module.
 */
export interface GameApiIpcPort {
    invoke(channel: string, arg?: unknown): Promise<unknown>;
    send(channel: string, payload?: unknown): void;
    on(channel: string, listener: GameApiListener): void;
    removeListener(channel: string, listener: GameApiListener): void;
}

/**
 * Build the `window.__chimera.game` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 */
export function createGameApi(ipc: GameApiIpcPort): GameAPI {
    return {
        sendAction: (action: EngineAction): void => {
            ipc.send(GAME_SEND_ACTION_CHANNEL, action);
        },
        onSnapshot: (cb: (snapshot: PlayerSnapshot) => void): Unsubscribe => {
            const listener: GameApiListener = (_event, ...args) => {
                // Main emits via `webContents.send(channel, snapshot)`; the
                // first positional argument (after the Electron event) is the
                // payload. Coerce via the declared PlayerSnapshot type —
                // invariant 1 guarantees main never sends a full GameSnapshot.
                cb(args[0] as PlayerSnapshot);
            };
            ipc.on(GAME_SNAPSHOT_CHANNEL, listener);
            return () => {
                ipc.removeListener(GAME_SNAPSHOT_CHANNEL, listener);
            };
        },
        onActionRejected: (cb: (rejection: ActionRejection) => void): Unsubscribe => {
            const listener: GameApiListener = (_event, ...args) => {
                // Validate the inbound REJECT push before invoking the
                // callback. A malformed push means main drifted from the
                // declared wire shape — throwing `PreloadIpcValidationError`
                // surfaces the drift with the channel name attached rather
                // than letting garbage reach the renderer's error boundary.
                const rejection = parseInvokeResponse(
                    ActionRejectionSchema,
                    GAME_ACTION_REJECTED_CHANNEL,
                    args[0],
                );
                cb(rejection);
            };
            ipc.on(GAME_ACTION_REJECTED_CHANNEL, listener);
            return () => {
                ipc.removeListener(GAME_ACTION_REJECTED_CHANNEL, listener);
            };
        },
        switchActiveSeat: async (playerId: PlayerId): Promise<void> => {
            await ipc.invoke(GAME_SWITCH_SEAT_CHANNEL, playerId);
        },
    };
}
