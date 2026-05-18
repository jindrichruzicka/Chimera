// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    LobbyState,
    ResolvedSettings,
    SettingsAPI,
} from '@chimera/electron/preload/api-types.js';
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
        display: { fullscreen: false, vsync: true, targetFps: 60, uiScale: 1.0 },
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
            root.render(<SettingsBootstrap />);
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(useSettingsStore.getState().activeGameId).toBeNull();
        expect(get).not.toHaveBeenCalledWith('tactics');
        expect(loadRendererGameMock).not.toHaveBeenCalled();
    });
});
