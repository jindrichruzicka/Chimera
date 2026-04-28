// electron/preload/apis/profile-api.ts
//
// Implements the `window.__chimera.profile` namespace exposed to the
// renderer (§4.1, §4.24). Only depends on a narrow `ProfileApiIpcPort` so
// the factory is trivially testable without spinning up Electron.
//
// Channel names live here (not in `shared/`) because they are an internal
// preload↔main protocol detail: renderer code never references them, and
// the main-process handler module imports these same constants to guarantee
// the channel strings match on both sides (Invariant #5).

import type {
    EngineProfile,
    LocalProfileSlot,
    PlayerProfile,
    PlayerId,
    ProfileAPI,
    Unsubscribe,
} from '../api-types.js';
import type { PushListenerPort } from '../shared/listener.js';
import { subscribePush } from '../shared/listener.js';
import {
    LobbyDirectorySchema,
    LocalProfileSlotListSchema,
    PlayerProfileSchema,
    parseInvokeResponse,
} from '../shared/schemas.js';

// ─── Channel constants ────────────────────────────────────────────────────────

/** `ipcRenderer.invoke` target for {@link ProfileAPI.getLocalProfile}. */
export const PROFILE_GET_LOCAL_CHANNEL = 'chimera:profile:get-local';

/** `ipcRenderer.invoke` target for {@link ProfileAPI.updateLocal}. */
export const PROFILE_UPDATE_LOCAL_CHANNEL = 'chimera:profile:update-local';

/** `ipcRenderer.invoke` target for {@link ProfileAPI.getLobbyDirectory}. */
export const PROFILE_GET_LOBBY_DIRECTORY_CHANNEL = 'chimera:profile:get-lobby-directory';

/**
 * `ipcRenderer.on` target for {@link ProfileAPI.onDirectoryChanged}.
 * Main pushes a `Record<PlayerId, PlayerProfile>` via `webContents.send`
 * whenever the lobby directory changes (player joins/leaves/updates profile).
 */
export const PROFILE_DIRECTORY_CHANGED_CHANNEL = 'chimera:profile:directory-changed';

/** `ipcRenderer.invoke` target for {@link ProfileAPI.listLocalSlots}. */
export const PROFILE_LIST_LOCAL_SLOTS_CHANNEL = 'chimera:profile:list-local-slots';

/** `ipcRenderer.invoke` target for {@link ProfileAPI.switchLocalSlot}. */
export const PROFILE_SWITCH_SLOT_CHANNEL = 'chimera:profile:switch-slot';

// ─── Port interface ───────────────────────────────────────────────────────────

/**
 * Narrow slice of `ipcRenderer` required by the profile namespace.
 * Extends {@link PushListenerPort} for the on/removeListener slice and adds
 * `invoke`. The profile namespace uses only invoke-style round-trips for
 * mutations and queries; the directory-changed push uses the listener port.
 */
export interface ProfileApiIpcPort extends PushListenerPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build the `window.__chimera.profile` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 *
 * Implements {@link ProfileAPI} per §4.1 / §4.24.
 */
export function createProfileApi(ipc: ProfileApiIpcPort): ProfileAPI {
    return {
        getLocalProfile(): Promise<PlayerProfile> {
            return ipc
                .invoke(PROFILE_GET_LOCAL_CHANNEL)
                .then((value) =>
                    parseInvokeResponse(PlayerProfileSchema, PROFILE_GET_LOCAL_CHANNEL, value),
                );
        },

        updateLocal(patch: Partial<EngineProfile>): Promise<void> {
            return ipc.invoke(PROFILE_UPDATE_LOCAL_CHANNEL, patch).then(() => undefined);
        },

        getLobbyDirectory(): Promise<Readonly<Record<PlayerId, PlayerProfile>>> {
            return ipc
                .invoke(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL)
                .then((value) =>
                    parseInvokeResponse(
                        LobbyDirectorySchema,
                        PROFILE_GET_LOBBY_DIRECTORY_CHANNEL,
                        value,
                    ),
                );
        },

        onDirectoryChanged(
            listener: (directory: Readonly<Record<PlayerId, PlayerProfile>>) => void,
        ): Unsubscribe {
            return subscribePush<Readonly<Record<PlayerId, PlayerProfile>>>(
                ipc,
                PROFILE_DIRECTORY_CHANGED_CHANNEL,
                listener,
            );
        },

        listLocalSlots(): Promise<readonly LocalProfileSlot[]> {
            return ipc
                .invoke(PROFILE_LIST_LOCAL_SLOTS_CHANNEL)
                .then((value) =>
                    parseInvokeResponse(
                        LocalProfileSlotListSchema,
                        PROFILE_LIST_LOCAL_SLOTS_CHANNEL,
                        value,
                    ),
                );
        },

        switchLocalSlot(localProfileId: string): Promise<void> {
            return ipc
                .invoke(PROFILE_SWITCH_SLOT_CHANNEL, { localProfileId })
                .then(() => undefined);
        },
    };
}
