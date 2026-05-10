'use client';

import { useEffect } from 'react';
import { useLobbyStore } from '../state/lobbyStore';
import { bootstrapLobbyStore } from '../state/lobbyStoreBootstrap';
import { getLobbyBridge } from './lobby/useLobbyApi';

export function LobbyStoreBootstrap(): null {
    useEffect(() => {
        const bridge = getLobbyBridge();
        if (bridge === null) {
            useLobbyStore.getState().markInitialStateLoaded();
            return () => undefined;
        }

        return bootstrapLobbyStore(bridge.lobby, bridge.system);
    }, []);

    return null;
}
