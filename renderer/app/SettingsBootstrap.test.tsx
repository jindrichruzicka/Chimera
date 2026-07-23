// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    LobbyState,
    ResolvedSettings,
    SettingsAPI,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { createInputActionRegistry } from '../input/InputActionRegistry.js';
import { InputActionRegistryContext } from '../input/InputActionRegistryContext.js';
import type { InputAction } from '../input/InputAction.js';
import { useLobbyStore } from '../state/lobbyStore.js';
import { useSettingsStore } from '../state/settingsStore.js';
import { SettingsBootstrap } from './SettingsBootstrap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loadRendererGameMock = vi.hoisted(() => vi.fn());

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGame: loadRendererGameMock,
}));

vi.mock('../state/settingsStoreBootstrap', () => ({
    bootstrapSettingsStore: vi.fn(() => vi.fn()),
}));

// The URL-gameId hydration effect re-resolves `window.location.search` on every
// pathname change; the tests drive the URL via history.replaceState and keep the
// pathname constant (mirrors the TokenModeI18nProvider test setup).
vi.mock('next/navigation', () => ({
    usePathname: () => '/main-menu',
}));

function setUrlGameId(gameId: string | null): void {
    window.history.replaceState(
        {},
        '',
        gameId === null ? '/main-menu' : `/main-menu?gameId=${gameId}`,
    );
}

const END_TURN_ACTION: InputAction = {
    id: 'game:end-turn',
    description: 'End current turn',
    category: 'Game',
    oneShot: true,
};

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

function makeSettings(masterVolume = 1.0): ResolvedSettings {
    return {
        audio: { masterVolume, sfxVolume: 1.0, musicVolume: 0.8, muted: false },
        display: { targetFps: 60 },
        gameplay: {
            language: 'en-US',
            autoSave: true,
            autoSaveIntervalTurns: 5,
            showHints: true,
            showPerfHud: false,
        },
        controls: {
            bindings: {
                'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
                'game:end-turn': { primary: 'Enter' },
            },
        },
    };
}

function makeLobbyState(gameId: string): LobbyState {
    return {
        info: {
            sessionId: 'session-1',
            hostId: 'p1',
            gameId,
        },
        players: [
            {
                playerId: 'p1',
                displayName: 'Player One',
                ready: true,
            },
        ],
    };
}

function makeSettingsApi(get: SettingsAPI['get']): SettingsAPI {
    return {
        get,
        update: vi.fn(),
        reset: vi.fn(),
        onChange: vi.fn(() => vi.fn()),
    };
}

async function flushPromiseJobs(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    setUrlGameId(null);
    useLobbyStore.getState().applyLobbyState(null);
    useSettingsStore.setState({ settings: {}, activeGameId: null });
    loadRendererGameMock.mockReset();
    loadRendererGameMock.mockResolvedValue({
        registry: { board: () => null },
        inputActions: [END_TURN_ACTION],
    });
});

afterEach(() => {
    if (mounted) {
        act(() => {
            root.unmount();
        });
    }
    container.remove();
    useLobbyStore.getState().applyLobbyState(null);
    useSettingsStore.setState({ settings: {}, activeGameId: null });
    delete (globalThis as { __chimera?: unknown }).__chimera;
});

describe('SettingsBootstrap', () => {
    it('hydrates active game settings and registers active game input actions', async () => {
        const tacticsSettings = makeSettings(0.75);
        const get = vi.fn(async (gameId: string) =>
            gameId === 'tactics' ? tacticsSettings : makeSettings(),
        );
        const settings = makeSettingsApi(get);
        (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera = { settings };
        useLobbyStore.getState().applyLobbyState(makeLobbyState('tactics'));
        const inputActionRegistry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={inputActionRegistry}>
                    <SettingsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(useSettingsStore.getState().activeGameId).toBe('tactics');
        expect(get).toHaveBeenCalledWith('tactics');
        expect(useSettingsStore.getState().settings['tactics']).toBe(tacticsSettings);
        expect(loadRendererGameMock).toHaveBeenCalledWith('tactics');
        expect(inputActionRegistry.get('game:end-turn')).toEqual(END_TURN_ACTION);
    });

    it('clears active game id when no lobby game is active', async () => {
        const get = vi.fn(async () => makeSettings());
        const settings = makeSettingsApi(get);
        (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera = { settings };
        useSettingsStore.setState({ settings: {}, activeGameId: 'tactics' });

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={createInputActionRegistry()}>
                    <SettingsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(useSettingsStore.getState().activeGameId).toBeNull();
        expect(get).not.toHaveBeenCalledWith('tactics');
        expect(loadRendererGameMock).not.toHaveBeenCalled();
    });

    // The persisted locale (gameplay.language) must apply on a COLD boot to the
    // main menu: with no lobby active, the URL `?gameId=` context alone must
    // hydrate that game's persisted settings into the store so consumers like
    // useActiveGameTranslations read the real locale instead of the default.
    it('hydrates the URL-resolved shell game settings on the menu route without a lobby', async () => {
        const tacticsSettings = makeSettings(0.75);
        const get = vi.fn(async (gameId: string) =>
            gameId === 'tactics' ? tacticsSettings : makeSettings(),
        );
        const settings = makeSettingsApi(get);
        (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera = { settings };
        setUrlGameId('tactics');

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={createInputActionRegistry()}>
                    <SettingsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(get).toHaveBeenCalledWith('tactics');
        expect(useSettingsStore.getState().settings['tactics']).toBe(tacticsSettings);
        // URL-only context is settings hydration ONLY: it neither claims the
        // active-game slot (lobby semantics) nor registers input actions.
        expect(useSettingsStore.getState().activeGameId).toBeNull();
        expect(loadRendererGameMock).not.toHaveBeenCalled();
    });

    it('does not hydrate URL settings when the URL carries no gameId', async () => {
        const get = vi.fn(async () => makeSettings());
        const settings = makeSettingsApi(get);
        (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera = { settings };

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={createInputActionRegistry()}>
                    <SettingsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(get).not.toHaveBeenCalled();
        expect(useSettingsStore.getState().settings).toEqual({});
    });

    it('hydrates both the URL game and the lobby game when they differ', async () => {
        const urlGameSettings = makeSettings(0.25);
        const lobbyGameSettings = makeSettings(0.75);
        const get = vi.fn(async (gameId: string) => {
            if (gameId === 'chess') return urlGameSettings;
            if (gameId === 'tactics') return lobbyGameSettings;
            return makeSettings();
        });
        const settings = makeSettingsApi(get);
        (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera = { settings };
        setUrlGameId('chess');
        useLobbyStore.getState().applyLobbyState(makeLobbyState('tactics'));
        const inputActionRegistry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={inputActionRegistry}>
                    <SettingsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(useSettingsStore.getState().settings['chess']).toBe(urlGameSettings);
        expect(useSettingsStore.getState().settings['tactics']).toBe(lobbyGameSettings);
        // The lobby game (not the URL game) owns the active-game slot.
        expect(useSettingsStore.getState().activeGameId).toBe('tactics');
    });
});
