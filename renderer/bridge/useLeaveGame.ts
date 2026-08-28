'use client';

import { useCallback } from 'react';
import type { LobbyAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import type { LeaveGameOptions } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    SESSION_MODE_QUICK,
    SESSION_MODE_PARAM,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { useGameStore } from '../state/gameStore.js';
import { useLobbyStore } from '../state/lobbyStore.js';
import { useLobbyUiStore } from '../state/lobbyUiStore.js';

/**
 * Role-aware "leave the match" action handed to in-game menu components through
 * `InGameMenuProps.leaveGame`. The menu reaches the engine only through the
 * registry-supplied setter and never opens IPC channels itself (Invariant #80 —
 * registry indirection for the `inGameMenu` slot; the in-game-menu analogue of
 * Invariant #100, which governs game lobby screens). A host leaves through one
 * of two exits — back to the lobby it came from, or out of a lobby-less quick
 * session entirely; a client records its leaving-to-main-menu intent and
 * disconnects.
 */
export type LeaveGame = (options?: LeaveGameOptions) => Promise<void>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isLeaveCapableLobby(value: Readonly<Record<string, unknown>>): boolean {
    return (
        typeof value['leave'] === 'function' &&
        typeof value['returnToLobby'] === 'function' &&
        typeof value['closeSession'] === 'function'
    );
}

// Self-contained bridge resolver mirroring useSendAction's resolveSendAction.
// Intentionally not reusing getLobbyBridge() from useLobbyApi: that helper also
// requires __chimera.system, an unrelated dependency this hook never touches.
function resolveLobbyApi(source: unknown): LobbyAPI | undefined {
    if (!isRecord(source)) {
        return undefined;
    }
    const chimera = source['__chimera'];
    if (!isRecord(chimera)) {
        return undefined;
    }
    const lobby = chimera['lobby'];
    if (!isRecord(lobby) || !isLeaveCapableLobby(lobby)) {
        return undefined;
    }
    return lobby as unknown as LobbyAPI;
}

/**
 * Sibling of {@link useSendAction}: resolves the local player's role from lobby
 * state and routes a leave through the preload lobby bridge. The renderer never
 * opens IPC channels itself — the host path calls `closeSession()` for a
 * quick-started session and `returnToLobby()` otherwise, the client path flags
 * the leaving-to-main-menu intent then calls `leave()`.
 *
 * The host fork reads `engine.sessionMode` off the live snapshot's `setup`
 * (Invariant #101), so it answers the same way after a window reload and after
 * a save restore — a renderer-held launch origin would survive neither. A
 * session with no stamp was born in a lobby, which is why the absent case
 * degrades to the lobby exit.
 */
export function useLeaveGame(source: unknown = globalThis): LeaveGame {
    const hostId = useLobbyStore((state) => state.lobbyState?.info.hostId ?? null);
    const localPlayerId = useLobbyUiStore((state) => state.localPlayerId);
    const isHost = hostId !== null && localPlayerId !== null && hostId === localPlayerId;
    const isQuickSession = useGameStore(
        (state) => state.snapshot?.setup?.gameParams[SESSION_MODE_PARAM] === SESSION_MODE_QUICK,
    );

    return useCallback(
        async (options?: LeaveGameOptions): Promise<void> => {
            const lobby = resolveLobbyApi(source);
            if (lobby === undefined) {
                throw new Error('Chimera lobby API not available');
            }
            if (isHost) {
                if (!isQuickSession) {
                    await lobby.returnToLobby();
                    return;
                }
                // A quick session has no lobby to go back to, so this exit ends
                // it: capture and teardown in ONE call, because a renderer-side
                // "save, then leave" pair would race — a leave that landed
                // first leaves the capture with no session to read.
                await lobby.closeSession({ autosave: options?.autosave ?? true });
                // Raised only once the session is really gone. The teardown
                // broadcasts no lobby-phase snapshot, and the snapshot this route
                // still holds keeps /game's no-session redirect shut — so nothing
                // navigates in the meantime, and a rejected close (a failed
                // capture skips the teardown entirely) leaves the player on the
                // live match rather than on a main menu it never reached.
                useLobbyUiStore.getState().setLeavingToMainMenu(true);
                return;
            }
            // Client disconnect: flag the leaving-to-main-menu intent for routing
            // (which owns navigation and local-context reset) and call the raw
            // bridge leave(). Unlike useLobbyApi().leave(), this deliberately does not
            // clearLocalLobbyContext() — that reset belongs to the routing layer, so
            // this hook stays a pure leave capability.
            useLobbyUiStore.getState().setLeavingToMainMenu(true);
            await lobby.leave();
        },
        [source, isHost, isQuickSession],
    );
}
