// @vitest-environment jsdom

/**
 * renderer/app/settings/page.test.tsx
 *
 * Unit tests for the SettingsPage component.
 *
 * Architecture reference: §4.13 — Settings System
 * Task: issue #393
 *
 * Invariant #36: Settings are never read by the simulation core — the page
 *   only reads from `settingsStore`, never dispatches into `ActionPipeline`.
 *
 * Rules:
 *   - Reads settings from `useSettingsStore` via narrow selectors only.
 *   - All writes dispatched through `window.__chimera.settings`.
 *   - Must NOT import from: electron/main/, simulation/, networking/.
 */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSettingsPageDefinition } from '@chimera/shared/game-shell-contract.js';
import SettingsPage from './page';
import { useSettingsStore } from '../../state/settingsStore';
import { useInputManager } from '../../input/InputManagerContext.js';
import type { InputManager } from '../../input/InputManager.js';
import type { InputAction, InputActionId } from '../../input/InputAction.js';
import type { KeyBinding } from '../../input/InputBindingSchema.js';
import type { ResolvedSettings } from '@chimera/electron/preload/api-types.js';
import type { LoadedRendererGame } from '../../game/rendererGameRegistry';

const { mockLoadRendererGame } = vi.hoisted(() => ({
    mockLoadRendererGame: vi.fn(),
}));

// Mock the InputManagerContext so tests control what useInputManager() returns
vi.mock('../../input/InputManagerContext.js', () => ({
    InputManagerContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
    useInputManager: vi.fn(),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGame: mockLoadRendererGame,
}));

// ── Mock window.__chimera.settings ────────────────────────────────────────────

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockReset = vi.fn().mockResolvedValue(undefined);

function setChimera(): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            settings: {
                update: mockUpdate,
                reset: mockReset,
                get: vi.fn(),
                onChange: vi.fn(),
            },
        },
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GAME_ID = 'tactics';

function makeRendererGame(settings?: GameSettingsPageDefinition): LoadedRendererGame {
    return {
        registry: { board: () => null },
        shell: settings === undefined ? {} : { settings },
    };
}

function makeSettings(
    audioOverrides: Partial<{
        masterVolume: number;
        sfxVolume: number;
        musicVolume: number;
        muted: boolean;
    }> = {},
): ResolvedSettings {
    return {
        audio: {
            masterVolume: 0.8,
            sfxVolume: 1.0,
            musicVolume: 0.7,
            muted: false,
            ...audioOverrides,
        },
        display: { fullscreen: false, vsync: true, targetFps: 60 as const, uiScale: 1.0 },
        gameplay: {
            language: 'en-US',
            autoSave: true,
            autoSaveIntervalTurns: 5,
            showHints: true,
            showPerfHud: false,
        },
        controls: { bindings: {} },
    };
}

async function renderSettingsPage(): Promise<void> {
    render(<SettingsPage />);
    await screen.findByRole('tab', { name: 'Audio' });
}

async function renderSettingsPageAndOpenTab(tabName: string): Promise<void> {
    await renderSettingsPage();
    fireEvent.click(screen.getByRole('tab', { name: tabName }));
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    vi.resetAllMocks();
    mockLoadRendererGame.mockResolvedValue(makeRendererGame());
    mockUpdate.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);
    setChimera();
    useSettingsStore.setState({
        settings: { [GAME_ID]: makeSettings() },
        activeGameId: GAME_ID,
    });
    // Default stub — existing tests don't exercise input manager behaviour
    vi.mocked(useInputManager).mockReturnValue(makeInputManagerDouble());
});

afterEach(() => {
    cleanup();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

// ── AC #1 — Declarative tab layout rendered ──────────────────────────────────

describe('SettingsPage — tabbed definition rendering (AC #1, #627)', () => {
    it('uses shared Typography primitives for headings and captions', async () => {
        await renderSettingsPage();

        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toHaveAttribute(
            'data-ch-heading-level',
            '1',
        );
        expect(screen.getByText('80%')).toHaveAttribute('data-ch-caption-tone', 'neutral');
    });

    it('renders the engine default Audio, Display, Gameplay, and Controls tabs', async () => {
        await renderSettingsPage();

        expect(screen.getByRole('tab', { name: 'Audio' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Display' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Gameplay' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Controls' })).toBeTruthy();
    });

    it('renders Display fields after selecting the Display tab', async () => {
        await renderSettingsPageAndOpenTab('Display');

        expect(screen.getByRole('heading', { name: /display/i })).toBeTruthy();
        expect(screen.getByLabelText(/fullscreen/i)).toBeTruthy();
        expect(screen.getByLabelText(/target fps/i)).toBeTruthy();
    });

    it('hydrates numeric select settings from the store', async () => {
        const settings = makeSettings();
        const displaySettings = (settings['display'] ?? {}) as Record<string, unknown>;
        useSettingsStore.setState({
            settings: {
                [GAME_ID]: {
                    ...settings,
                    display: { ...displaySettings, targetFps: 120 },
                },
            },
            activeGameId: GAME_ID,
        });

        await renderSettingsPageAndOpenTab('Display');

        expect(screen.getByLabelText<HTMLSelectElement>(/target fps/i).value).toBe('120');
    });

    it('renders Gameplay fields after selecting the Gameplay tab', async () => {
        await renderSettingsPageAndOpenTab('Gameplay');

        expect(screen.getByRole('heading', { name: /gameplay/i })).toBeTruthy();
        expect(screen.getByLabelText(/language/i)).toBeTruthy();
        expect(screen.getByRole('switch', { name: 'Auto Save' })).toBeTruthy();
    });

    it('renders the Controls tab with registered input actions', async () => {
        await renderSettingsPageAndOpenTab('Controls');

        expect(screen.getByRole('heading', { name: /controls/i })).toBeTruthy();
        expect(screen.getByText('Undo last action')).toBeTruthy();
    });

    it('shows a Spinner while active game settings are loading', async () => {
        const loadingGameId = 'settings-loading-game';
        let resolveGame!: (game: LoadedRendererGame) => void;
        mockLoadRendererGame.mockReturnValue(
            new Promise<LoadedRendererGame>((resolve) => {
                resolveGame = resolve;
            }),
        );
        useSettingsStore.setState({
            settings: { [loadingGameId]: makeSettings() },
            activeGameId: loadingGameId,
        });

        render(<SettingsPage />);

        expect(screen.getByRole('status', { name: /loading settings/i })).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'Audio' })).toBeNull();

        resolveGame(makeRendererGame());
        expect(await screen.findByRole('tab', { name: 'Audio' })).toBeTruthy();
    });

    it('renders custom tabs from the loaded game shell settings definition', async () => {
        const customGameId = 'custom-settings-game';
        const customDefinition: GameSettingsPageDefinition = {
            tabs: [
                {
                    id: 'combat',
                    label: 'Combat',
                    sections: [
                        {
                            id: 'rules',
                            label: 'Rules',
                            items: [
                                { kind: 'engine-field', fieldId: 'audio.masterVolume' },
                                {
                                    kind: 'game-field',
                                    path: 'tactics.difficulty',
                                    label: 'Difficulty',
                                    control: {
                                        type: 'select',
                                        options: [
                                            { value: 'normal', label: 'Normal' },
                                            { value: 'hard', label: 'Hard' },
                                        ],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    id: 'ai',
                    label: 'AI',
                    sections: [
                        {
                            id: 'assist',
                            items: [
                                {
                                    kind: 'game-field',
                                    path: 'tactics.aiAssist',
                                    label: 'AI Assist',
                                    control: { type: 'toggle' },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        mockLoadRendererGame.mockResolvedValue(makeRendererGame(customDefinition));
        useSettingsStore.setState({
            settings: {
                [customGameId]: {
                    ...makeSettings(),
                    tactics: { difficulty: 'normal', aiAssist: true },
                },
            },
            activeGameId: customGameId,
        });

        render(<SettingsPage />);

        expect(await screen.findByRole('tab', { name: 'Combat' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'AI' })).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'Display' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Rules' })).toBeTruthy();

        fireEvent.change(screen.getByLabelText(/difficulty/i), { target: { value: 'hard' } });

        expect(mockUpdate).toHaveBeenCalledWith(customGameId, {
            tactics: { difficulty: 'hard' },
        });

        fireEvent.click(screen.getByRole('tab', { name: 'AI' }));
        expect(screen.getByLabelText(/ai assist/i)).toBeTruthy();
    });

    it('does not render the legacy Game Settings JSON section for extra keys', async () => {
        useSettingsStore.setState({
            settings: { [GAME_ID]: { ...makeSettings(), mapSize: 12 } },
            activeGameId: GAME_ID,
        });

        await renderSettingsPage();

        expect(screen.queryByRole('heading', { name: /game settings/i })).toBeNull();
        expect(screen.queryByText('12')).toBeNull();
    });
});

// ── AC #2 — Volume slider dispatches update ───────────────────────────────────

describe('SettingsPage — master volume slider (AC #2)', () => {
    it('marks the master volume input for settings page objects', async () => {
        await renderSettingsPage();
        expect(screen.getByTestId('master-volume')).toBeTruthy();
    });

    it('calls window.__chimera.settings.update with audio masterVolume patch when slider changes', async () => {
        await renderSettingsPage();
        const slider = screen.getByLabelText(/master volume/i);
        fireEvent.change(slider, { target: { value: '0.4' } });
        expect(mockUpdate).toHaveBeenCalledWith(GAME_ID, { audio: { masterVolume: 0.4 } });
    });

    it('slider initial value reflects settings from the store', async () => {
        await renderSettingsPage();
        const slider = screen.getByLabelText<HTMLInputElement>(/master volume/i);
        expect(slider.value).toBe('0.8');
    });
});

// ── AC #3 — Reset to defaults button ─────────────────────────────────────────

describe('SettingsPage — reset to defaults (AC #3)', () => {
    it('marks the reset button for settings page objects', async () => {
        await renderSettingsPage();
        expect(screen.getByTestId('reset-to-defaults')).toBeTruthy();
    });

    it('calls window.__chimera.settings.reset with the active gameId when reset is clicked', async () => {
        await renderSettingsPage();
        const btn = screen.getByRole('button', { name: /reset to defaults/i });
        fireEvent.click(btn);
        expect(mockReset).toHaveBeenCalledWith(GAME_ID);
    });
});

// ── AC #4 — Live update on onChange push ─────────────────────────────────────

describe('SettingsPage — onChange push updates form without unmounting (AC #4)', () => {
    it('updates the masterVolume slider when _applySettings is called', async () => {
        await renderSettingsPage();

        const slider = screen.getByLabelText<HTMLInputElement>(/master volume/i);
        expect(slider.value).toBe('0.8');

        // Simulate a push from the main process (via bootstrapSettingsStore → _applySettings)
        act(() => {
            useSettingsStore
                .getState()
                ._applySettings(GAME_ID, makeSettings({ masterVolume: 0.3 }));
        });

        expect(screen.getByLabelText<HTMLInputElement>(/master volume/i).value).toBe('0.3');
    });

    it('updates numeric select values when _applySettings is called', async () => {
        await renderSettingsPageAndOpenTab('Display');

        const targetFps = screen.getByLabelText<HTMLSelectElement>(/target fps/i);
        expect(targetFps.value).toBe('60');

        const settings = makeSettings();
        const displaySettings = (settings['display'] ?? {}) as Record<string, unknown>;
        act(() => {
            useSettingsStore.getState()._applySettings(GAME_ID, {
                ...settings,
                display: { ...displaySettings, targetFps: 0 },
            });
        });

        expect(screen.getByLabelText<HTMLSelectElement>(/target fps/i).value).toBe('0');
    });
});

// ── AC #5 — Engine-wide settings (activeGameId === null) ──────────────────────
//
// Invariant #36: When no game is active, settings updates are dispatched against
// the reserved '__engine__' gameId. This allows engine-wide settings to be
// configured even before a game is loaded.
//
// Confirming '__engine__' is an accepted reserved id end-to-end (WARN-3).

describe('SettingsPage — engine-wide settings when activeGameId is null (AC #5)', () => {
    it('renders form controls even when activeGameId is null', async () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        await renderSettingsPage();
        expect(screen.getByRole('heading', { name: /audio/i })).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: 'Display' }));
        expect(screen.getByRole('heading', { name: /display/i })).toBeTruthy();
    });

    it('dispatches update with __engine__ gameId when activeGameId is null', async () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        await renderSettingsPage();
        const slider = screen.getByLabelText(/master volume/i);
        fireEvent.change(slider, { target: { value: '0.4' } });

        expect(mockUpdate).toHaveBeenCalledWith('__engine__', { audio: { masterVolume: 0.4 } });
    });

    it('dispatches reset with __engine__ gameId when activeGameId is null', async () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        await renderSettingsPage();
        const btn = screen.getByRole('button', { name: /reset to defaults/i });
        fireEvent.click(btn);

        expect(mockReset).toHaveBeenCalledWith('__engine__');
    });
});

// ── Helpers: InputManager double for rebind UI tests ─────────────────────────

const UNDO_ACTION: InputAction = {
    id: 'engine:undo',
    description: 'Undo last action',
    category: 'Engine',
    oneShot: true,
};
const TOGGLE_MENU_ACTION: InputAction = {
    id: 'engine:toggle-menu',
    description: 'Toggle game menu',
    category: 'Engine',
    oneShot: true,
};
const END_TURN_ACTION: InputAction = {
    id: 'game:end-turn',
    description: 'End current turn',
    category: 'Game',
    oneShot: true,
};

function makeInputManagerDouble(overrides: Partial<InputManager> = {}): InputManager {
    const bindings: Record<InputActionId, KeyBinding> = {
        'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
        'engine:toggle-menu': { primary: 'Escape' },
        'game:end-turn': { primary: 'Enter' },
    };
    return {
        start: vi.fn(),
        stop: vi.fn(),
        isPressed: vi.fn().mockReturnValue(false),
        onAction: vi.fn(() => vi.fn()),
        setActiveCategory: vi.fn(),
        rebind: vi.fn().mockResolvedValue({ ok: true }),
        pollGamepad: vi.fn(),
        getActions: vi.fn().mockReturnValue([UNDO_ACTION, TOGGLE_MENU_ACTION, END_TURN_ACTION]),
        getBinding: vi.fn((id: InputActionId) => bindings[id]),
        resetBinding: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

async function renderWithInputManager(inputManager: InputManager): Promise<void> {
    vi.mocked(useInputManager).mockReturnValue(inputManager);
    await renderSettingsPageAndOpenTab('Controls');
}

// ── AC #6 — Controls rebind panel renders all registered actions ──────────────

describe('SettingsPage — controls rebind panel (AC #6)', () => {
    it('renders action descriptions for all registered actions', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        expect(screen.getByText('Undo last action')).toBeTruthy();
        expect(screen.getByText('Toggle game menu')).toBeTruthy();
        expect(screen.getByText('End current turn')).toBeTruthy();
    });

    it('renders current binding key for each action', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        // engine:undo → Ctrl+KeyZ
        expect(screen.getByText(/Ctrl\+KeyZ/i)).toBeTruthy();
        // engine:toggle-menu → Escape
        expect(screen.getByText(/Escape/i)).toBeTruthy();
    });

    it('renders an "Edit" button for each action', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        expect(editButtons.length).toBe(3);
    });

    it('renders a "Reset" button for each action', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        const resetButtons = screen.getAllByRole('button', { name: /^reset$/i });
        expect(resetButtons.length).toBe(3);
    });

    it('groups actions by category', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        expect(screen.getByText('Engine')).toBeTruthy();
        expect(screen.getByText('Game')).toBeTruthy();
    });

    it('refreshes controls when the active game context changes after initial render', async () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings(), [GAME_ID]: makeSettings() },
            activeGameId: null,
        });
        let registeredActions: readonly InputAction[] = [UNDO_ACTION];
        await renderWithInputManager(
            makeInputManagerDouble({
                getActions: vi.fn(() => registeredActions),
            }),
        );

        expect(screen.getByText('Undo last action')).toBeTruthy();
        expect(screen.queryByText('End current turn')).toBeNull();

        registeredActions = [UNDO_ACTION, END_TURN_ACTION];
        act(() => {
            useSettingsStore.getState().setActiveGameId(GAME_ID);
        });

        fireEvent.click(await screen.findByRole('tab', { name: 'Controls' }));
        expect(await screen.findByText('End current turn')).toBeTruthy();
    });
});

// ── AC #7 — Capture mode: listening for a new key ────────────────────────────

describe('SettingsPage — rebind capture mode (AC #7)', () => {
    it('pressing Edit enters capture mode — shows "Press a key…" status', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[0]!);
        expect(screen.getByText(/press a key/i)).toBeTruthy();
    });

    it('pressing Escape while in capture mode cancels and restores normal view', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[0]!);
        expect(screen.getByText(/press a key/i)).toBeTruthy();

        fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' });
        expect(screen.queryByText(/press a key/i)).toBeNull();
    });

    it('pressing a non-Escape key while in capture mode calls rebind', async () => {
        const mockRebind = vi.fn().mockResolvedValue({ ok: true });
        await renderWithInputManager(makeInputManagerDouble({ rebind: mockRebind }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[0]!); // Edit engine:undo

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyA', key: 'a', ctrlKey: false });
        });

        expect(mockRebind).toHaveBeenCalledWith('engine:undo', { primary: 'KeyA', modifiers: [] });
    });

    it('capture mode with Ctrl held includes Ctrl in the binding modifiers', async () => {
        const mockRebind = vi.fn().mockResolvedValue({ ok: true });
        await renderWithInputManager(makeInputManagerDouble({ rebind: mockRebind }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[0]!);

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyB', key: 'b', ctrlKey: true });
        });

        expect(mockRebind).toHaveBeenCalledWith('engine:undo', {
            primary: 'KeyB',
            modifiers: ['Ctrl'],
        });
    });

    it('uses the latest input manager instance while capture mode is active', async () => {
        const firstRebind = vi.fn().mockResolvedValue({ ok: true });
        const secondRebind = vi.fn().mockResolvedValue({ ok: true });
        const firstManager = makeInputManagerDouble({ rebind: firstRebind });
        const secondManager = makeInputManagerDouble({ rebind: secondRebind });

        vi.mocked(useInputManager).mockReturnValue(firstManager);
        const { rerender } = render(<SettingsPage />);
        await screen.findByRole('tab', { name: 'Audio' });
        fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[0]!);

        vi.mocked(useInputManager).mockReturnValue(secondManager);
        rerender(<SettingsPage />);

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyC', key: 'c' });
        });

        expect(secondRebind).toHaveBeenCalledWith('engine:undo', {
            primary: 'KeyC',
            modifiers: [],
        });
        expect(firstRebind).not.toHaveBeenCalled();
    });

    it('keeps the capture listener attached across same-manager rerenders', async () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        const removeSpy = vi.spyOn(document, 'removeEventListener');

        const { rerender } = render(<SettingsPage />);
        await screen.findByRole('tab', { name: 'Audio' });
        fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[0]!);

        const keydownAddsAfterCapture = addSpy.mock.calls.filter(
            ([eventName]) => eventName === 'keydown',
        ).length;
        const keydownRemovesAfterCapture = removeSpy.mock.calls.filter(
            ([eventName]) => eventName === 'keydown',
        ).length;

        rerender(<SettingsPage />);

        expect(addSpy.mock.calls.filter(([eventName]) => eventName === 'keydown')).toHaveLength(
            keydownAddsAfterCapture,
        );
        expect(removeSpy.mock.calls.filter(([eventName]) => eventName === 'keydown')).toHaveLength(
            keydownRemovesAfterCapture,
        );
    });
});

// ── AC #8 — Conflict message and resolution ───────────────────────────────────

describe('SettingsPage — conflict handling (AC #8)', () => {
    it('shows conflict message when rebind returns a conflict result', async () => {
        const conflictRebind = vi.fn().mockResolvedValue({
            ok: false,
            reason: 'conflict',
            conflictingAction: 'engine:undo',
        });
        await renderWithInputManager(makeInputManagerDouble({ rebind: conflictRebind }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[1]!); // Edit engine:toggle-menu

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', ctrlKey: true });
        });

        expect(screen.getByText(/conflict/i)).toBeTruthy();
    });

    it('shows "Unbind existing & rebind" button when there is a conflict', async () => {
        const conflictRebind = vi.fn().mockResolvedValue({
            ok: false,
            reason: 'conflict',
            conflictingAction: 'engine:undo',
        });
        await renderWithInputManager(makeInputManagerDouble({ rebind: conflictRebind }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[1]!);

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', ctrlKey: true });
        });

        expect(screen.getByRole('button', { name: /unbind existing/i })).toBeTruthy();
    });

    it('"Unbind existing & rebind" first unbinds conflicting action then calls rebind', async () => {
        const conflictRebind = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                reason: 'conflict',
                conflictingAction: 'engine:undo',
            })
            .mockResolvedValue({ ok: true });
        const mockResetBinding = vi.fn().mockResolvedValue(undefined);
        await renderWithInputManager(
            makeInputManagerDouble({ rebind: conflictRebind, resetBinding: mockResetBinding }),
        );

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[1]!);

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', ctrlKey: true });
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /unbind existing/i }));
        });

        expect(mockResetBinding).toHaveBeenCalledWith('engine:undo');
        // rebind must be called twice: once producing conflict, once after unbing
        expect(conflictRebind).toHaveBeenCalledTimes(2);
    });

    it("force-rebinding one conflicted action uses that action's captured key even after another conflict is captured later", async () => {
        const conflictRebind = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                reason: 'conflict',
                conflictingAction: 'engine:toggle-menu',
            })
            .mockResolvedValueOnce({
                ok: false,
                reason: 'conflict',
                conflictingAction: 'engine:undo',
            })
            .mockResolvedValue({ ok: true });
        const mockResetBinding = vi.fn().mockResolvedValue(undefined);

        await renderWithInputManager(
            makeInputManagerDouble({ rebind: conflictRebind, resetBinding: mockResetBinding }),
        );

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });

        // Capture conflict for engine:undo with Ctrl+X.
        fireEvent.click(editButtons[0]!);
        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyX', key: 'x', ctrlKey: true });
        });

        // Capture conflict for engine:toggle-menu with Ctrl+Y.
        fireEvent.click(editButtons[1]!);
        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyY', key: 'y', ctrlKey: true });
        });

        const forceButtons = screen.getAllByRole('button', { name: /unbind existing/i });
        await act(async () => {
            // Resolve first conflict (engine:undo) and assert it keeps its own captured key.
            fireEvent.click(forceButtons[0]!);
        });

        expect(conflictRebind).toHaveBeenLastCalledWith('engine:undo', {
            primary: 'KeyX',
            modifiers: ['Ctrl'],
        });
    });
});

// ── AC #9 — Per-action reset ──────────────────────────────────────────────────

describe('SettingsPage — per-action reset (AC #9)', () => {
    it('clicking Reset for an action calls inputManager.resetBinding() with the correct id', async () => {
        const mockResetBinding = vi.fn().mockResolvedValue(undefined);
        await renderWithInputManager(makeInputManagerDouble({ resetBinding: mockResetBinding }));

        const resetButtons = screen.getAllByRole('button', { name: /^reset$/i });
        await act(async () => {
            fireEvent.click(resetButtons[0]!); // reset engine:undo
        });

        expect(mockResetBinding).toHaveBeenCalledWith('engine:undo');
    });
});
