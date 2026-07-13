'use client';

/**
 * renderer/components/lobby/PlayerConnectionToastBridge.tsx (§4.30).
 *
 * App-wide listener that turns a host-side opponent presence transition into a
 * "Player disconnected" (`warning`) / "Player reconnected" (`info`) toast. Main
 * pushes `chimera:lobby:player-connection` only for transient drops and
 * reconnects of opponents — never for an intentional leave or a first-time join
 * (the host distinguishes them via the LEAVE control message).
 *
 * Local seats are excluded defensively here too: a player should never see a
 * presence toast about their own seat. Titles are static literals and carry no
 * body — toast content is not derived from game/player/save state (Invariant
 * #74); duration is the severity default. Mounted once in `AppShell`; renders
 * nothing.
 */

import { useEffect, useRef } from 'react';
import type { PlayerConnectionEvent } from '@chimera-engine/simulation/bridge/api-types.js';
import { getLobbyBridge } from '../../app/lobby/useLobbyApi';
import { TOAST_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { useToastStore } from '../../state/toastStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';

export function PlayerConnectionToastBridge(): null {
    // The subscription is one-time (empty deps) so a locale change must not
    // re-subscribe and drop events; read the latest translator through a ref
    // instead. A resolved token is still a static title (Invariant #74).
    const t = useTranslate();
    const tRef = useRef(t);
    tRef.current = t;

    useEffect(() => {
        // Guard: outside Electron (or before preload wiring) there is no bridge.
        const bridge = getLobbyBridge();
        if (bridge === null) {
            return;
        }
        return bridge.lobby.onPlayerConnectionChanged((event: PlayerConnectionEvent) => {
            // Never toast about a local seat (the host emits opponent-only, but
            // exclude local seats per the §4.30 contract).
            const { localPlayerId, localSeatIds } = useLobbyUiStore.getState();
            if (event.playerId === localPlayerId || localSeatIds.includes(event.playerId)) {
                return;
            }
            if (event.status === 'disconnected') {
                useToastStore.getState().push({
                    severity: 'warning',
                    title: tRef.current(TOAST_KEYS.playerDisconnected),
                });
            } else {
                useToastStore
                    .getState()
                    .push({ severity: 'info', title: tRef.current(TOAST_KEYS.playerReconnected) });
            }
        });
    }, []);

    return null;
}
