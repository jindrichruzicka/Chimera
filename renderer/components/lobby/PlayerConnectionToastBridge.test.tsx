// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    LobbyAPI,
    PlayerConnectionEvent,
    SystemAPI,
} from '@chimera/simulation/bridge/api-types.js';
import { playerId } from '@chimera/simulation/bridge/api-types.js';
import { PlayerConnectionToastBridge } from './PlayerConnectionToastBridge';
import { useToastStore } from '../../state/toastStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';

const noopSystem = {
    onConnectionStatus: vi.fn(() => () => undefined),
} as unknown as SystemAPI;

function installLobbyBridge(lobby: Partial<LobbyAPI>): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { lobby, system: noopSystem },
    });
}

function captureConnectionListener(): {
    onPlayerConnectionChanged: LobbyAPI['onPlayerConnectionChanged'];
    fire: (event: PlayerConnectionEvent) => void;
} {
    let listener: ((event: PlayerConnectionEvent) => void) | undefined;
    const onPlayerConnectionChanged = vi.fn((cb: (event: PlayerConnectionEvent) => void) => {
        listener = cb;
        return () => undefined;
    }) as unknown as LobbyAPI['onPlayerConnectionChanged'];
    return { onPlayerConnectionChanged, fire: (event) => listener?.(event) };
}

const OPPONENT = playerId('opponent-1');

beforeEach(() => {
    useToastStore.getState().dismissAll();
    useLobbyUiStore.getState().clearLocalLobbyContext();
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('PlayerConnectionToastBridge', () => {
    it('pushes a warning "Player disconnected" toast on a disconnect transition', () => {
        const { onPlayerConnectionChanged, fire } = captureConnectionListener();
        installLobbyBridge({ onPlayerConnectionChanged });

        render(<PlayerConnectionToastBridge />);
        expect(onPlayerConnectionChanged).toHaveBeenCalledOnce();

        fire({ playerId: OPPONENT, status: 'disconnected' });

        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]!.severity).toBe('warning');
        expect(queue[0]!.title).toBe('Player disconnected');
        expect(queue[0]!.body).toBeUndefined();
    });

    it('pushes an info "Player reconnected" toast on a reconnect transition', () => {
        const { onPlayerConnectionChanged, fire } = captureConnectionListener();
        installLobbyBridge({ onPlayerConnectionChanged });

        render(<PlayerConnectionToastBridge />);
        fire({ playerId: OPPONENT, status: 'reconnected' });

        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]!.severity).toBe('info');
        expect(queue[0]!.title).toBe('Player reconnected');
    });

    it('never toasts for a local-seat transition', () => {
        const { onPlayerConnectionChanged, fire } = captureConnectionListener();
        installLobbyBridge({ onPlayerConnectionChanged });
        useLobbyUiStore.getState().setLocalLobbyContext(OPPONENT, [OPPONENT]);

        render(<PlayerConnectionToastBridge />);
        fire({ playerId: OPPONENT, status: 'disconnected' });

        expect(useToastStore.getState().queue).toHaveLength(0);
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        installLobbyBridge({ onPlayerConnectionChanged: vi.fn(() => unsubscribe) });

        const { unmount } = render(<PlayerConnectionToastBridge />);
        expect(unsubscribe).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('renders nothing and no-ops when the bridge is absent', () => {
        const { container } = render(<PlayerConnectionToastBridge />);
        expect(container).toBeEmptyDOMElement();
        expect(useToastStore.getState().queue).toHaveLength(0);
    });
});
