// electron/preload/apis/chat-api.ts
//
// Implements the `window.__chimera.chat` namespace exposed to the renderer
// (§4.29 — Chat System). Only depends on a narrow `ChatApiIpcPort` so the
// factory is trivially testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and the
// main-process handler module imports these same constants to guarantee the
// channel strings match on both sides (Invariant #5).

import type {
    ChatAPI,
    ChatMessage,
    ChatScope,
    PlayerId,
    RelayResult,
    Unsubscribe,
} from '../api-types.js';
import type { PushListenerPort } from '../shared/listener.js';
import { subscribeValidatedPush } from '../shared/listener.js';
import {
    ChatMessageListSchema,
    ChatMessageSchema,
    RelayResultSchema,
    parseInvokeResponse,
} from '../shared/schemas.js';

// ─── Channel constants ────────────────────────────────────────────────────────

/** `ipcRenderer.invoke` target for {@link ChatAPI.send}. Resolves a `RelayResult`. */
export const CHAT_SEND_CHANNEL = 'chimera:chat:send';

/** `ipcRenderer.invoke` target for {@link ChatAPI.history}. */
export const CHAT_HISTORY_CHANNEL = 'chimera:chat:history';

/** `ipcRenderer.send` target for {@link ChatAPI.mute} (fire-and-forget). */
export const CHAT_MUTE_CHANNEL = 'chimera:chat:mute';

/** `ipcRenderer.send` target for {@link ChatAPI.unmute} (fire-and-forget). */
export const CHAT_UNMUTE_CHANNEL = 'chimera:chat:unmute';

/**
 * `ipcRenderer.on` target for {@link ChatAPI.onMessage}. Main pushes a relayed
 * {@link ChatMessage} via `webContents.send` whenever the local player is a
 * recipient of an accepted chat message.
 */
export const CHAT_MESSAGE_CHANNEL = 'chimera:chat:message';

// ─── Port interface ───────────────────────────────────────────────────────────

/**
 * Narrow slice of `ipcRenderer` required by the chat namespace. Extends
 * {@link PushListenerPort} for the on/removeListener slice (`onMessage`), adds
 * `invoke` (`send`, `history`) and `send` (fire-and-forget `mute` / `unmute`).
 */
export interface ChatApiIpcPort extends PushListenerPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build the `window.__chimera.chat` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph. Implements {@link ChatAPI} per §4.29.
 */
export function createChatApi(ipc: ChatApiIpcPort): ChatAPI {
    return {
        send(body: string, scope: ChatScope): Promise<RelayResult> {
            return ipc
                .invoke(CHAT_SEND_CHANNEL, { body, scope })
                .then((value) => parseInvokeResponse(RelayResultSchema, CHAT_SEND_CHANNEL, value));
        },

        onMessage(cb: (message: ChatMessage) => void): Unsubscribe {
            return subscribeValidatedPush<ChatMessage>(
                ipc,
                CHAT_MESSAGE_CHANNEL,
                ChatMessageSchema,
                cb,
            );
        },

        history(maxEntries?: number): Promise<readonly ChatMessage[]> {
            return ipc
                .invoke(CHAT_HISTORY_CHANNEL, { maxEntries })
                .then((value) =>
                    parseInvokeResponse(ChatMessageListSchema, CHAT_HISTORY_CHANNEL, value),
                );
        },

        mute(playerId: PlayerId): void {
            ipc.send(CHAT_MUTE_CHANNEL, { playerId });
        },

        unmute(playerId: PlayerId): void {
            ipc.send(CHAT_UNMUTE_CHANNEL, { playerId });
        },
    };
}
