// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    LobbyAPI,
    PlayerLeftMatchEvent,
    SystemAPI,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { PlayerLeftToastBridge } from './PlayerLeftToastBridge';
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

/** A no-op-returning `onOpponentLeftMatch` whose registered listener is captured. */
function captureLeftMatchListener(): {
    onOpponentLeftMatch: LobbyAPI['onOpponentLeftMatch'];
    fire: (event: PlayerLeftMatchEvent) => void;
} {
    let listener: ((event: PlayerLeftMatchEvent) => void) | undefined;
    const onOpponentLeftMatch = vi.fn((cb: (event: PlayerLeftMatchEvent) => void) => {
        listener = cb;
        return () => undefined;
    }) as unknown as LobbyAPI['onOpponentLeftMatch'];
    return { onOpponentLeftMatch, fire: (event) => listener?.(event) };
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

describe('PlayerLeftToastBridge', () => {
    it('pushes a warning "{name} left game." toast on an in-match opponent leave', () => {
        const { onOpponentLeftMatch, fire } = captureLeftMatchListener();
        installLobbyBridge({ onOpponentLeftMatch });

        render(<PlayerLeftToastBridge />);
        expect(onOpponentLeftMatch).toHaveBeenCalledOnce();

        fire({ playerId: OPPONENT, displayName: 'Bob' });

        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]!.severity).toBe('warning');
        expect(queue[0]!.title).toBe('Bob left game.');
        expect(queue[0]!.body).toBeUndefined();
    });

    it('interpolates the display name through the active-locale translator', () => {
        const { onOpponentLeftMatch, fire } = captureLeftMatchListener();
        installLobbyBridge({ onOpponentLeftMatch });

        baseRender(
            <I18nProvider gameOverride={{ 'engine.toast.playerLeftGame': '{displayName} bailed' }}>
                <PlayerLeftToastBridge />
            </I18nProvider>,
        );
        fire({ playerId: OPPONENT, displayName: 'Bob' });

        expect(useToastStore.getState().queue[0]!.title).toBe('Bob bailed');
    });

    it('never toasts for a local-seat leave', () => {
        const { onOpponentLeftMatch, fire } = captureLeftMatchListener();
        installLobbyBridge({ onOpponentLeftMatch });
        useLobbyUiStore.getState().setLocalLobbyContext(OPPONENT, [OPPONENT]);

        render(<PlayerLeftToastBridge />);
        fire({ playerId: OPPONENT, displayName: 'Me' });

        expect(useToastStore.getState().queue).toHaveLength(0);
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        installLobbyBridge({ onOpponentLeftMatch: vi.fn(() => unsubscribe) });

        const { unmount } = render(<PlayerLeftToastBridge />);
        expect(unsubscribe).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('renders nothing and no-ops when the bridge is absent', () => {
        const { container } = render(<PlayerLeftToastBridge />);
        expect(container).toBeEmptyDOMElement();
        expect(useToastStore.getState().queue).toHaveLength(0);
    });
});
