// @vitest-environment jsdom

/**
 * renderer/__tests__/shell-input-actions.test.tsx
 *
 * The headline integration pin (§4.26): a SHELL surface receives a
 * game input action with no match ever having run.
 *
 * Deliberately end to end through the real app tree rather than a component
 * unit: the chain has four links and each one was a separate reason the feature
 * did not work before this branch —
 *
 *   1. the game declares the table on its SHELL payload,
 *   2. `InputActionsBootstrap` registers it into the app-lifetime registry at
 *      boot, off the URL `?gameId=` context,
 *   3. `SettingsBootstrap` gives that game the active-game slot, which is what
 *      `KeyBindingRepository` resolves the key through, and
 *   4. the Providers-owned `InputManager` dispatches to the surface's
 *      `useInputAction` subscriber.
 *
 * Mounting only the bootstrap would prove (2) and assume (3) — and (3) alone
 * decides whether the player's key does anything.
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSettings } from '@chimera-engine/simulation/bridge/api-types.js';

import { installMatchMedia } from '../__test-support__/installMatchMedia';
import { AppShell } from '../app/AppShell';
import {
    _resetRendererGameRegistryForTest,
    registerRendererGame,
} from '../game/rendererGameRegistry';
import type { InputAction, InputEvent } from '../input/InputAction.js';
import { useInputAction } from '../input/useInputAction.js';
import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi';
import { _resetShellStateForTest } from '../shell/shellStateStore';
import { useSettingsStore } from '../state/settingsStore';

const navigationState = { pathname: '/main-menu', search: '?gameId=fake' };

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => navigationState.pathname,
    useSearchParams: () => new URLSearchParams(navigationState.search),
}));

const GAME_ID = 'fake';
const SELECT_ACTION: InputAction = {
    id: 'game:select',
    description: 'game.fake.actions.select',
    category: 'game.fake.actions.categoryGame',
    oneShot: true,
};
const SELECT_KEY = 'KeyE';

/**
 * Settings as the main process resolves them, PER GAME ID.
 *
 * The split is load-bearing, not decoration: a `game:*` binding lives in the
 * GAME's settings (`apps/<game>/settings-schema.ts` defaults), never in the
 * engine's, and `KeyBindingRepository` falls back to `__engine__` whenever no
 * game holds the active-game slot. A fixture that answered the same bindings
 * for every id would make the fallback indistinguishable from the game context
 * — and the slot is exactly what this file is here to prove.
 */
function makeSettings(gameId: string): ResolvedSettings {
    return {
        audio: { masterVolume: 1, sfxVolume: 1, musicVolume: 1, muted: false },
        display: { targetFps: 60 },
        gameplay: {
            language: 'en-US',
            autoSave: true,
            autoSaveIntervalTurns: 5,
            showHints: true,
            showPerfHud: false,
        },
        controls: {
            bindings: gameId === GAME_ID ? { [SELECT_ACTION.id]: { primary: SELECT_KEY } } : {},
        },
    };
}

/**
 * A stand-in for a game's shell surface (a live background, a select page):
 * it renders under `AppShell` on a menu route and subscribes with the public
 * barrel's hook, exactly as a game's own component would.
 */
function ShellSurface({ onSelect }: { readonly onSelect: (event: InputEvent) => void }) {
    useInputAction(SELECT_ACTION.id, onSelect);
    return <div data-testid="shell-surface">shell surface</div>;
}

function registerFakeGame(shellInputActions: readonly InputAction[] | undefined): void {
    const shell = {
        ...(shellInputActions === undefined ? {} : { inputActions: shellInputActions }),
    };
    registerRendererGame({
        gameId: GAME_ID,
        loadGame: () => Promise.resolve({ registry: { playfield: () => null }, shell }),
        loadShell: () => Promise.resolve(shell),
    });
}

let logsApi: ReturnType<typeof createRecordingLogsApi>;

beforeEach(() => {
    logsApi = createRecordingLogsApi();
    navigationState.pathname = '/main-menu';
    navigationState.search = `?gameId=${GAME_ID}`;
    window.history.replaceState({}, '', `/main-menu?gameId=${GAME_ID}`);
    _resetShellStateForTest();
    _resetRendererGameRegistryForTest();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
    installMatchMedia();

    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: { onConnectionStatus: vi.fn(() => () => undefined) },
            logs: logsApi,
            settings: {
                get: vi.fn(async (gameId: string) => makeSettings(gameId)),
                update: vi.fn(),
                reset: vi.fn(),
                onChange: vi.fn(() => () => undefined),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    _resetRendererGameRegistryForTest();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
    vi.restoreAllMocks();
});

async function mountShell(onSelect: (event: InputEvent) => void): Promise<void> {
    render(
        <AppShell>
            <ShellSurface onSelect={onSelect} />
        </AppShell>,
    );
    await screen.findByTestId('shell-surface');
    // Two async hops settle before the key can land: the shell-payload load that
    // registers the action, and the settings hydration that claims the slot the
    // binding resolves through.
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

function pressSelectKey(): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: SELECT_KEY }));
    });
}

describe('a shell surface receives a game input action before any match', () => {
    it('dispatches the declared action to a menu-route subscriber', async () => {
        registerFakeGame([SELECT_ACTION]);
        const onSelect = vi.fn();

        await mountShell(onSelect);
        pressSelectKey();

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0]?.[0]).toMatchObject({
            actionId: SELECT_ACTION.id,
            code: SELECT_KEY,
            pressed: true,
        });
    });

    // The test above cannot tell registration from a bare binding: `InputManager`
    // dispatches off the binding map alone, so a build that registered NOTHING
    // still passes it. What registration decides is `oneShot` — the one dispatch
    // behaviour that reads `InputActionRegistry` — so this pair is the actual
    // registration pin, with the non-repeat press as the positive control that
    // keeps "no call" from being vacuously true.
    it('honors oneShot because the shell payload declared the action', async () => {
        registerFakeGame([SELECT_ACTION]);
        const onSelect = vi.fn();
        await mountShell(onSelect);

        pressSelectKey();
        expect(onSelect).toHaveBeenCalledTimes(1);

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: SELECT_KEY, repeat: true }));
        });

        // Registered AND oneShot ⇒ the key-repeat is swallowed.
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('cannot honor oneShot when the shell payload declares nothing', async () => {
        registerFakeGame(undefined);
        const onSelect = vi.fn();
        await mountShell(onSelect);

        pressSelectKey();
        expect(onSelect).toHaveBeenCalledTimes(1);

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: SELECT_KEY, repeat: true }));
        });

        // Unregistered ⇒ `InputManager` has no `oneShot` to consult, so the
        // repeat is dispatched too. This is what the Controls pane and the
        // rebind path also see as "the game's actions are not registered".
        expect(onSelect).toHaveBeenCalledTimes(2);
    });
});
