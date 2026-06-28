'use client';

/**
 * renderer/components/lobby/PlayerLeftToastBridge.tsx (§4.30).
 *
 * App-wide listener that turns a host-side *intentional* opponent leave during
 * an active match into a "{displayName} left game." (`warning`) toast. Main
 * pushes `chimera:lobby:player-left` only when an opponent deliberately leaves
 * while a match is in progress — the in-battle counterpart to
 * `PlayerConnectionToastBridge`, which stays silent for intentional leaves and
 * fires only for transient drops/reconnects (#687).
 *
 * Local seats are excluded defensively: a player never sees a leave toast about
 * their own seat. `displayName` is lobby-scoped cosmetic data (Invariant #59) —
 * never derived from `GameSnapshot`/`PlayerSnapshot`/`SaveFile` (Invariant #74);
 * duration is the severity default. Mounted once in `AppShell`; renders nothing.
 */

import { useEffect } from 'react';
import type { PlayerLeftMatchEvent } from '@chimera-engine/simulation/bridge/api-types.js';
import { getLobbyBridge } from '../../app/lobby/useLobbyApi';
import { useToastStore } from '../../state/toastStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';

export function PlayerLeftToastBridge(): null {
    useEffect(() => {
        // Guard: outside Electron (or before preload wiring) there is no bridge.
        const bridge = getLobbyBridge();
        if (bridge === null) {
            return;
        }
        return bridge.lobby.onOpponentLeftMatch((event: PlayerLeftMatchEvent) => {
            // Never toast about a local seat (the host emits opponent-only, but
            // exclude local seats per the §4.30 contract).
            const { localPlayerId, localSeatIds } = useLobbyUiStore.getState();
            if (event.playerId === localPlayerId || localSeatIds.includes(event.playerId)) {
                return;
            }
            useToastStore
                .getState()
                .push({ severity: 'warning', title: `${event.displayName} left game.` });
        });
    }, []);

    return null;
}
