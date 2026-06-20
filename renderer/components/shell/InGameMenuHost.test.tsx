// @vitest-environment jsdom
/**
 * renderer/components/shell/InGameMenuHost.test.tsx
 *
 * RTL tests for the Escape-toggled in-game menu host (F55 · §4.33–§4.34).
 *
 * The host consumes the `engine:toggle-menu` input action, owns renderer-local
 * open state, registers the Escape-stack base layer while open, and renders the
 * game's `inGameMenu` override / the engine default / nothing per the three
 * registry states. Leave routing is delegated to `useLeaveGame` (host vs client).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playerId } from '@chimera/electron/preload/api-types.js';
import type { LobbyState } from '@chimera/simulation/foundation/messages-schemas.js';
import type { InGameMenuProps } from '@chimera/simulation/foundation/game-screen-contract.js';

import type { InputActionId, InputEvent } from '../../input/InputAction.js';
import type { InputManager } from '../../input/InputManager.js';
import { InputManagerContext } from '../../input/InputManagerContext.js';
import { useLobbyStore } from '../../state/lobbyStore.js';
import { useLobbyUiStore } from '../../state/lobbyUiStore.js';
import { EscapeStackProvider, useEscapeLayer } from './EscapeStack.js';
import { InGameMenuHost } from './InGameMenuHost.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(actionId: InputActionId): InputEvent {
    return { actionId, code: 'Escape', modifiers: [], repeat: false, pressed: true, timestamp: 0 };
}

function makeLobbyState(hostId: string): LobbyState {
    return {
        info: { sessionId: 'session-1', hostId: playerId(hostId), gameId: 'tactics' },
        players: [],
    };
}

/**
 * Minimal `InputManager` double. `triggerAction` dispatches an action directly
 * (deterministic toggle path). `start()` mirrors the real manager's window-level
 * bubble-phase keydown→`engine:toggle-menu` dispatch so the EscapeStack's
 * capture-phase suppression can be exercised with a real Escape keydown.
 */
function createStubManager(): InputManager & {
    triggerAction: (id: InputActionId, event: InputEvent) => void;
} {
    const subscribers = new Map<InputActionId, Set<(event: InputEvent) => void>>();
    let onKeydown: ((event: KeyboardEvent) => void) | null = null;

    function dispatch(id: InputActionId, event: InputEvent): void {
        const cbs = subscribers.get(id);
        if (cbs === undefined) return;
        for (const cb of [...cbs]) cb(event);
    }

    return {
        start(): void {
            onKeydown = (event: KeyboardEvent): void => {
                if (event.key !== 'Escape') return;
                dispatch('engine:toggle-menu', makeEvent('engine:toggle-menu'));
            };
            window.addEventListener('keydown', onKeydown);
        },
        stop(): void {
            if (onKeydown !== null) {
                window.removeEventListener('keydown', onKeydown);
                onKeydown = null;
            }
        },
        isPressed: () => false,
        onAction(id, callback): () => void {
            const set = subscribers.get(id) ?? new Set();
            set.add(callback);
            subscribers.set(id, set);
            return () => {
                subscribers.get(id)?.delete(callback);
            };
        },
        setActiveCategory: () => undefined,
        rebind: async () => ({ ok: true as const }),
        pollGamepad: () => undefined,
        getActions: () => [],
        getBinding: () => undefined,
        resetBinding: async () => undefined,
        triggerAction(id, event): void {
            dispatch(id, event);
        },
    };
}

let capturedProps: InGameMenuProps | null = null;

function SpyMenu(props: InGameMenuProps): React.ReactElement {
    capturedProps = props;
    return (
        <div data-testid="override-menu">
            <button type="button" onClick={props.closeMenu}>
                override-resume
            </button>
        </div>
    );
}

function TransientOverlay({ onClose }: { readonly onClose: () => void }): React.ReactElement {
    useEscapeLayer(onClose, true);
    return <div data-testid="transient-overlay" />;
}

describe('InGameMenuHost', () => {
    let manager: ReturnType<typeof createStubManager>;

    beforeEach(() => {
        manager = createStubManager();
        capturedProps = null;
    });

    afterEach(() => {
        manager.stop();
        cleanup();
        vi.restoreAllMocks();
        useLobbyStore.getState().applyLobbyState(null);
        useLobbyUiStore.getState().clearLocalLobbyContext();
        useLobbyUiStore.getState().setLeavingToMainMenu(false);
        delete (globalThis as { __chimera?: unknown }).__chimera;
    });

    function renderHost(ui: React.ReactElement): void {
        render(
            <InputManagerContext.Provider value={manager}>
                <EscapeStackProvider>{ui}</EscapeStackProvider>
            </InputManagerContext.Provider>,
        );
    }

    function toggleMenu(): void {
        act(() => {
            manager.triggerAction('engine:toggle-menu', makeEvent('engine:toggle-menu'));
        });
    }

    it('renders the engine-default menu when the slot is omitted and the toggle fires', () => {
        renderHost(<InGameMenuHost />);
        expect(screen.queryByRole('dialog')).toBeNull();

        toggleMenu();

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /leave match/i })).toBeTruthy();
    });

    it('renders the game override with closeMenu, leaveGame, and isHost', () => {
        renderHost(<InGameMenuHost inGameMenu={SpyMenu} isHost />);
        toggleMenu();

        expect(screen.getByTestId('override-menu')).toBeTruthy();
        // The override owns its presentation; the engine-default Modal is not used.
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(capturedProps).not.toBeNull();
        expect(typeof capturedProps?.closeMenu).toBe('function');
        expect(typeof capturedProps?.leaveGame).toBe('function');
        expect(capturedProps?.isHost).toBe(true);
    });

    it('is a no-op when the slot is "none" — the toggle opens nothing', () => {
        renderHost(<InGameMenuHost inGameMenu="none" />);
        toggleMenu();

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('override-menu')).toBeNull();
    });

    it('lets an open transient overlay consume Escape before the menu toggles', () => {
        manager.start();
        const onOverlayClose = vi.fn();
        renderHost(
            <>
                <InGameMenuHost />
                <TransientOverlay onClose={onOverlayClose} />
            </>,
        );

        act(() => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });

        expect(onOverlayClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens the menu on Escape when no overlay is registered', () => {
        manager.start();
        renderHost(<InGameMenuHost />);

        act(() => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });

        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('routes a host leave through returnToLobby() via useLeaveGame', async () => {
        const leave = vi.fn(async () => undefined);
        const returnToLobby = vi.fn(async () => undefined);
        (globalThis as { __chimera?: unknown }).__chimera = { lobby: { leave, returnToLobby } };
        useLobbyStore.getState().applyLobbyState(makeLobbyState('host'));
        useLobbyUiStore.getState().setLocalLobbyContext(playerId('host'), [playerId('host')]);

        renderHost(<InGameMenuHost isHost />);
        toggleMenu();

        fireEvent.click(screen.getByRole('button', { name: /leave match/i }));
        fireEvent.click(screen.getByRole('button', { name: /confirm leave/i }));

        await waitFor(() => expect(returnToLobby).toHaveBeenCalledOnce());
        expect(leave).not.toHaveBeenCalled();
    });

    it('routes a client leave through leave() and flags leaving-to-main-menu', async () => {
        const leave = vi.fn(async () => undefined);
        const returnToLobby = vi.fn(async () => undefined);
        (globalThis as { __chimera?: unknown }).__chimera = { lobby: { leave, returnToLobby } };
        useLobbyStore.getState().applyLobbyState(makeLobbyState('host'));
        useLobbyUiStore.getState().setLocalLobbyContext(playerId('client'), [playerId('client')]);

        renderHost(<InGameMenuHost />);
        toggleMenu();

        fireEvent.click(screen.getByRole('button', { name: /leave match/i }));
        fireEvent.click(screen.getByRole('button', { name: /confirm leave/i }));

        await waitFor(() => expect(leave).toHaveBeenCalledOnce());
        expect(returnToLobby).not.toHaveBeenCalled();
        expect(useLobbyUiStore.getState().leavingToMainMenu).toBe(true);
    });

    it('acts only on the key-down: the key-up dispatch must not re-close a freshly opened menu', () => {
        renderHost(<InGameMenuHost />);

        // A physical Escape tap dispatches engine:toggle-menu twice — pressed on
        // key-down, released on key-up (oneShot suppresses key-repeat, not the
        // key-up). The host must act only on the key-down, mirroring the
        // engine:toggle-perf-hud handler, or the tap would open then instantly
        // close and the menu could never be opened from the keyboard.
        act(() => {
            manager.triggerAction('engine:toggle-menu', makeEvent('engine:toggle-menu'));
        });
        expect(screen.getByRole('dialog')).toBeTruthy();

        act(() => {
            manager.triggerAction('engine:toggle-menu', {
                ...makeEvent('engine:toggle-menu'),
                pressed: false,
            });
        });
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('closes on Resume and reopens on a second toggle', () => {
        renderHost(<InGameMenuHost />);
        toggleMenu();
        expect(screen.getByRole('dialog')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        expect(screen.queryByRole('dialog')).toBeNull();

        toggleMenu();
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('closes on Escape via the host base layer while open', () => {
        manager.start();
        renderHost(<InGameMenuHost />);
        toggleMenu();
        expect(screen.getByRole('dialog')).toBeTruthy();

        act(() => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
