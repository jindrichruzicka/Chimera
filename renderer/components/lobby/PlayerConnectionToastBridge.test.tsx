// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    LobbyAPI,
    PlayerConnectionEvent,
    SystemAPI,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { PlayerConnectionToastBridge } from './PlayerConnectionToastBridge';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useToastStore } from '../../state/toastStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';

// The bridge calls useTranslate(), which throws outside I18nProvider; the inert
// provider resolves engine English so the existing toast-title assertions hold.
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: I18nProvider });

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

    it('resolves the disconnect title through the active-locale translator', () => {
        const { onPlayerConnectionChanged, fire } = captureConnectionListener();
        installLobbyBridge({ onPlayerConnectionChanged });

        baseRender(
            <I18nProvider gameOverride={{ 'engine.toast.playerDisconnected': 'Player dropped' }}>
                <PlayerConnectionToastBridge />
            </I18nProvider>,
        );
        fire({ playerId: OPPONENT, status: 'disconnected' });

        expect(useToastStore.getState().queue[0]!.title).toBe('Player dropped');
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
