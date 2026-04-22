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
} from './api-types.js';
import type { IpcListener, PushListenerPort } from './listener.js';
import { subscribePush, subscribeValidatedPush } from './listener.js';
import { ActionRejectionSchema } from './schemas.js';

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
 * Back-compat alias for {@link IpcListener}. Retained so test files that
 * imported `GameApiListener` continue to compile. New code should use
 * {@link IpcListener} directly.
 */
export type GameApiListener = IpcListener;

/**
 * Narrow port over `ipcRenderer`. Extends {@link PushListenerPort} for the
 * on/removeListener slice and adds `invoke` / `send` for the round-trip
 * and fire-and-forget channels the game namespace uses.
 */
export interface GameApiIpcPort extends PushListenerPort {
    invoke(channel: string, arg?: unknown): Promise<unknown>;
    send(channel: string, payload?: unknown): void;
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
        // invariant 1: main never sends a full GameSnapshot on this channel;
        // the `subscribePush` cast is the same trust boundary the namespace
        // declared before the shared helper existed.
        onSnapshot: (cb: (snapshot: PlayerSnapshot) => void): Unsubscribe =>
            subscribePush<PlayerSnapshot>(ipc, GAME_SNAPSHOT_CHANNEL, cb),
        // Schema-validated because a malformed REJECT would otherwise
        // propagate as garbage into the renderer error boundary — the
        // channel-name-aware `PreloadIpcValidationError` thrown by
        // `subscribeValidatedPush` pins the drift to this exact channel.
        onActionRejected: (cb: (rejection: ActionRejection) => void): Unsubscribe =>
            subscribeValidatedPush<ActionRejection>(
                ipc,
                GAME_ACTION_REJECTED_CHANNEL,
                ActionRejectionSchema,
                cb,
            ),
        switchActiveSeat: async (playerId: PlayerId): Promise<void> => {
            await ipc.invoke(GAME_SWITCH_SEAT_CHANNEL, playerId);
        },
    };
}
