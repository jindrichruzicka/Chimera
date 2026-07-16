// @vitest-environment jsdom

/**
 * renderer/components/shell/SpectatorHud.test.tsx
 *
 * Unit tests for the read-only spectator overlay (Invariant #114): it names the
 * followed seat (from the profile-sourced lobby roster — Invariant #62), offers
 * a switch affordance + hotkey that cycles the followed seat through the
 * out-of-band spectate IPC (Invariant #115), and self-gates to null for players.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import {
    gamePhase,
    playerId,
    type LobbyState,
    type PlayerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import type { InputEvent } from '../../input/InputAction.js';
import type { InputManager } from '../../input/InputManager.js';
import { InputManagerContext } from '../../input/InputManagerContext.js';
import { useGameStore } from '../../state/gameStore.js';
import { useLobbyStore } from '../../state/lobbyStore.js';
import { useLobbyUiStore } from '../../state/lobbyUiStore.js';
import { SpectatorHud } from './SpectatorHud.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const P1 = playerId('p1');
const P2 = playerId('p2');

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        tick: 3,
        viewerId: P1,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: false,
        ...overrides,
    };
}

function makeLobbyState(): LobbyState {
    return {
        info: { sessionId: 'sess-1', hostId: P1, gameId: 'tactics' },
        players: [
            { playerId: P1, displayName: 'Alice', ready: true },
            { playerId: P2, displayName: 'Bob', ready: true },
        ],
    };
}

/** Captured hotkey handlers, keyed by action id, so tests can fire them. */
const actionHandlers = new Map<string, (event: InputEvent) => void>();
const setFollowedTargetSpy = vi.fn<(id: PlayerId) => void>();

function inputEvent(pressed: boolean): InputEvent {
    return {
        actionId: 'engine:spectate-cycle',
        code: 'Tab',
        modifiers: [],
        repeat: false,
        pressed,
        timestamp: 0,
    };
}

function makeInputManager(): InputManager {
    return {
        onAction: (id: string, cb: (event: InputEvent) => void) => {
            actionHandlers.set(id, cb);
            return () => actionHandlers.delete(id);
        },
        getBinding: (id: string) =>
            id === 'engine:spectate-cycle' ? { primary: 'Tab' } : undefined,
    } as unknown as InputManager;
}

function renderHud(): void {
    render(
        <I18nProvider>
            <InputManagerContext.Provider value={makeInputManager()}>
                <SpectatorHud />
            </InputManagerContext.Provider>
        </I18nProvider>,
    );
}

beforeEach(() => {
    actionHandlers.clear();
    setFollowedTargetSpy.mockReset();
    (globalThis as { __chimera?: unknown }).__chimera = {
        spectate: { setFollowedTarget: setFollowedTargetSpy },
    };
    useGameStore.getState().applySnapshot(makeSnapshot());
    useLobbyStore.getState().applyLobbyState(makeLobbyState());
    useLobbyUiStore.getState().setLocalRole('spectator');
});

afterEach(() => {
    cleanup();
    useLobbyUiStore.getState().setLocalRole('player');
    Reflect.deleteProperty(globalThis, '__chimera');
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SpectatorHud', () => {
    it('renders the followed player name from the roster and the switch hint', () => {
        renderHud();

        // Name is the one prominent text; the mode label is a separate span so
        // no sentence is concatenated in code (i18n-safe composition).
        expect(screen.getByTestId('spectator-following').textContent).toBe('Alice');
        expect(screen.getByText('Spectating').tagName).toBe('SPAN');
        // The hint is a keycap showing the bound key; the full formatted
        // sentence stays reachable for assistive tech via aria-label.
        expect(screen.getByTestId('spectator-hint').textContent).toBe('Tab');
        expect(screen.getByTestId('spectator-hint').getAttribute('aria-label')).toBe(
            'Press Tab to switch',
        );
        expect(screen.getByTestId('spectator-switch').tagName).toBe('BUTTON');
        expect(screen.getByTestId('spectator-switch').getAttribute('aria-label')).toBe(
            'Switch view',
        );
    });

    it('renders nothing when the local session is not a spectator', () => {
        useLobbyUiStore.getState().setLocalRole('player');
        renderHud();

        expect(screen.queryByTestId('spectator-hud')).toBeNull();
    });

    it('cycles to the next seated player when the switch button is clicked', () => {
        renderHud();

        fireEvent.click(screen.getByTestId('spectator-switch'));

        expect(setFollowedTargetSpy).toHaveBeenCalledExactlyOnceWith(P2);
    });

    it('wraps around to the first seat when following the last one', () => {
        useGameStore.getState().applySnapshot(makeSnapshot({ viewerId: P2 }));
        renderHud();

        fireEvent.click(screen.getByTestId('spectator-switch'));

        expect(setFollowedTargetSpy).toHaveBeenCalledExactlyOnceWith(P1);
    });

    it('cycles on the switch hotkey key-down, but ignores the key-up', () => {
        renderHud();

        actionHandlers.get('engine:spectate-cycle')?.(inputEvent(false));
        expect(setFollowedTargetSpy).not.toHaveBeenCalled();

        actionHandlers.get('engine:spectate-cycle')?.(inputEvent(true));
        expect(setFollowedTargetSpy).toHaveBeenCalledExactlyOnceWith(P2);
    });

    it('ignores the switch hotkey for a non-spectator (subscription is live but inert)', () => {
        useLobbyUiStore.getState().setLocalRole('player');
        renderHud();

        actionHandlers.get('engine:spectate-cycle')?.(inputEvent(true));

        expect(setFollowedTargetSpy).not.toHaveBeenCalled();
    });

    it('falls back to the raw id when the followed seat is missing from the roster', () => {
        useLobbyStore.getState().applyLobbyState(null);
        renderHud();

        expect(screen.getByTestId('spectator-following').textContent).toBe('p1');
    });
});
