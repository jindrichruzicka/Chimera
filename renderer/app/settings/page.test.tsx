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
import {
    act,
    cleanup,
    fireEvent,
    render as baseRender,
    screen,
    within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSettingsPageDefinition } from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import modalCss from '../../components/ui/Modal.module.css?raw';
import { EscapeStackProvider } from '../../components/shell/EscapeStack';
import { I18nProvider } from '../../i18n/I18nProvider';
import pageCss from './page.module.css?raw';
import SettingsPage from './page';
import { useSettingsStore } from '../../state/settingsStore';
import { useInputManager } from '../../input/InputManagerContext.js';
import type { InputManager } from '../../input/InputManager.js';
import type { InputAction, InputActionId } from '../../input/InputAction.js';
import type { KeyBinding } from '../../input/InputBindingSchema.js';
import type { ResolvedSettings } from '@chimera-engine/simulation/bridge/api-types.js';
import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import type { LoadedRendererGame, LoadedRendererGameShell } from '../../game/rendererGameRegistry';

const { mockLoadRendererGame, mockLoadRendererGameShell, mockPush } = vi.hoisted(() => ({
    mockLoadRendererGame: vi.fn(),
    mockLoadRendererGameShell: vi.fn(),
    mockPush: vi.fn(),
}));

// Mock the InputManagerContext so tests control what useInputManager() returns
vi.mock('../../input/InputManagerContext.js', () => ({
    InputManagerContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
    useInputManager: vi.fn(),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGame: mockLoadRendererGame,
    loadRendererGameShell: mockLoadRendererGameShell,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

// ── Mock window.__chimera.settings ────────────────────────────────────────────

const mockGet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockReset = vi.fn().mockResolvedValue(undefined);

function setChimera(): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            settings: {
                update: mockUpdate,
                reset: mockReset,
                get: mockGet,
                onChange: vi.fn(),
            },
        },
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// The page renders through the shared Modal (Escape handling registers on the
// overlay stack → EscapeStackProvider), and the gameplay.language field renders
// <SettingsLanguageSelector> → useTranslate(), which throws outside an
// I18nProvider. Both wrappers are required for every render.
function AllProviders({ children }: { children: React.ReactNode }): React.ReactElement {
    return (
        <I18nProvider>
            <EscapeStackProvider>{children}</EscapeStackProvider>
        </I18nProvider>
    );
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: AllProviders });

// Renders under an I18nProvider carrying a game override bundle, so a test can
// prove an engine string is token-driven: re-keying an `engine.settings.*` token
// must change the rendered text.
function renderWithOverride(
    ui: React.ReactElement,
    gameOverride: Record<string, string>,
): ReturnType<typeof baseRender> {
    return baseRender(ui, {
        wrapper: ({ children }: { children: React.ReactNode }) => (
            <I18nProvider gameOverride={gameOverride}>
                <EscapeStackProvider>{children}</EscapeStackProvider>
            </I18nProvider>
        ),
    });
}

const GAME_ID = 'tactics';

const TWO_LANGUAGES: readonly GameLanguage[] = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
];

function makeRendererGame(settings?: GameSettingsPageDefinition): LoadedRendererGame {
    return {
        registry: { board: () => null },
        shell: settings === undefined ? {} : { settings },
    };
}

/** A loaded shell carrying the given declared languages (or none). */
function makeRendererShell(languages: readonly GameLanguage[] = []): LoadedRendererGameShell {
    return languages.length > 0 ? { translations: { languages, bundles: {} } } : {};
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
        display: { targetFps: 60 as const },
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

function setSettingsUrl(search = ''): void {
    window.history.replaceState({}, '', `/settings${search}`);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    vi.resetAllMocks();
    mockLoadRendererGame.mockResolvedValue(makeRendererGame());
    // Default: two declared languages so the Language selector renders. Tests
    // that need the single-language (hidden-row) path override this.
    mockLoadRendererGameShell.mockResolvedValue(makeRendererShell(TWO_LANGUAGES));
    mockPush.mockReset();
    mockGet.mockResolvedValue(makeSettings());
    mockUpdate.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);
    setSettingsUrl();
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
    setSettingsUrl();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

// ── AC #1 — Declarative tab layout rendered ──────────────────────────────────

describe('SettingsPage — tabbed definition rendering (AC #1, #627)', () => {
    it('omits the redundant page title and keeps settings value captions', async () => {
        await renderSettingsPage();

        expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).toBeNull();
        expect(screen.getByText('80%')).toHaveAttribute('data-ch-caption-tone', 'neutral');
    });

    it('renders the engine default Audio, Display, Gameplay, and Controls tabs', async () => {
        await renderSettingsPage();

        expect(screen.getByRole('tab', { name: 'Audio' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Display' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Gameplay' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Controls' })).toBeTruthy();
    });

    it('marks settings tabs and sections with stable E2E test ids', async () => {
        await renderSettingsPage();

        expect(screen.getByTestId('settings-tabs')).toBeTruthy();
        expect(screen.getByTestId('settings-tab-audio')).toBeTruthy();
        expect(screen.getByTestId('settings-tab-display')).toBeTruthy();
        expect(screen.getByTestId('settings-section-audio-audio')).toBeTruthy();
    });

    it('omits section headings that repeat the active tab label', async () => {
        await renderSettingsPage();

        expect(screen.queryByRole('heading', { level: 2, name: 'Audio' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Display' }));
        expect(screen.queryByRole('heading', { level: 2, name: 'Display' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Gameplay' }));
        expect(screen.queryByRole('heading', { level: 2, name: 'Gameplay' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
        expect(screen.queryByRole('heading', { level: 2, name: 'Controls' })).toBeNull();
    });

    it('renders Display fields after selecting the Display tab', async () => {
        await renderSettingsPageAndOpenTab('Display');

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

    it('renders the Language selector after selecting the Gameplay tab', async () => {
        await renderSettingsPageAndOpenTab('Gameplay');

        // The engine default gameplay tab surfaces only the language selector
        // (which loads its declared languages asynchronously); games register
        // their own gameplay settings.
        expect(await screen.findByRole('combobox', { name: 'Language' })).toBeTruthy();
    });

    describe('gameplay.language field → LanguageSelector (#868)', () => {
        it('renders the declared languages as the Language selector when the game declares ≥2', async () => {
            await renderSettingsPageAndOpenTab('Gameplay');

            const select = await screen.findByRole('combobox', { name: 'Language' });
            expect(within(select).getByRole('option', { name: 'English' })).toHaveValue('en-US');
            expect(within(select).getByRole('option', { name: 'Čeština' })).toHaveValue('cs-CZ');
            // Reflects the persisted gameplay.language.
            expect(select).toHaveValue('en-US');
        });

        it('uses a token-driven "Language" accessible name, not a hardcoded field label', async () => {
            await renderSettingsPageAndOpenTab('Gameplay');

            // 'Language' comes from useTranslate(SETTINGS_KEYS.language); the
            // selector renders its own label, so there is exactly one.
            const selects = await screen.findAllByRole('combobox', { name: 'Language' });
            expect(selects).toHaveLength(1);
        });

        it('persists the chosen language via updateSettings', async () => {
            await renderSettingsPageAndOpenTab('Gameplay');

            const select = await screen.findByRole('combobox', { name: 'Language' });
            fireEvent.change(select, { target: { value: 'cs-CZ' } });

            expect(mockUpdate).toHaveBeenCalledWith(GAME_ID, { gameplay: { language: 'cs-CZ' } });
        });

        it('shows the empty-section message (not a Language row) when the game declares fewer than two languages', async () => {
            mockLoadRendererGameShell.mockResolvedValue(makeRendererShell([TWO_LANGUAGES[0]!]));

            await renderSettingsPageAndOpenTab('Gameplay');
            // Wait for the gameplay section to paint (empty once the single-language
            // selector hides itself).
            expect(await screen.findByTestId('settings-section-gameplay-gameplay')).toBeTruthy();

            // With nothing the player can change, the section surfaces the shared
            // empty-state message instead of a blank panel — parity with the
            // controls tab's "No controls registered.".
            expect(await screen.findByText('No settings available.')).toBeTruthy();
            expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
        });

        it('shows the empty-section message when the game declares no languages', async () => {
            mockLoadRendererGameShell.mockResolvedValue(makeRendererShell([]));

            await renderSettingsPageAndOpenTab('Gameplay');
            expect(await screen.findByTestId('settings-section-gameplay-gameplay')).toBeTruthy();

            expect(await screen.findByText('No settings available.')).toBeTruthy();
            expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
        });

        it('does not show the empty-section message when the game declares ≥2 languages', async () => {
            // TWO_LANGUAGES is the default: the language selector renders, so the
            // gameplay section is not empty and the message must stay absent (no
            // first-paint flash while the languages are still loading).
            await renderSettingsPageAndOpenTab('Gameplay');

            expect(await screen.findByRole('combobox', { name: 'Language' })).toBeTruthy();
            expect(screen.queryByText('No settings available.')).toBeNull();
        });
    });

    it('renders the Controls tab with registered game input actions', async () => {
        await renderSettingsPageAndOpenTab('Controls');

        expect(screen.getByText('End current turn')).toBeTruthy();
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

    it('resolves a game-field label and its select options through the active translator', async () => {
        // A game may store token keys as its game-field label and select-option
        // labels; the settings renderer resolves them through `t()`, so the
        // game's own bundle (here an override) drives the visible text.
        const customGameId = 'token-labelled-game';
        const customDefinition: GameSettingsPageDefinition = {
            tabs: [
                {
                    id: 'combat',
                    label: 'game.example.settings.tabCombat',
                    sections: [
                        {
                            id: 'rules',
                            label: 'game.example.settings.tabCombat',
                            items: [
                                {
                                    kind: 'game-field',
                                    path: 'tactics.difficulty',
                                    label: 'game.example.settings.difficulty',
                                    control: {
                                        type: 'select',
                                        options: [
                                            {
                                                value: 'normal',
                                                label: 'game.example.settings.normal',
                                            },
                                            { value: 'hard', label: 'game.example.settings.hard' },
                                        ],
                                    },
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
                [customGameId]: { ...makeSettings(), tactics: { difficulty: 'normal' } },
            },
            activeGameId: customGameId,
        });

        renderWithOverride(<SettingsPage />, {
            'game.example.settings.tabCombat': 'Boj',
            'game.example.settings.difficulty': 'Obtížnost',
            'game.example.settings.normal': 'Normální',
            'game.example.settings.hard': 'Těžká',
        });

        expect(await screen.findByRole('tab', { name: 'Boj' })).toBeTruthy();
        // The game-field label resolves through the translator.
        expect(screen.getByLabelText('Obtížnost')).toBeTruthy();
        // …and so do its select options.
        expect(screen.getByRole('option', { name: 'Normální' })).toBeTruthy();
        expect(screen.getByRole('option', { name: 'Těžká' })).toBeTruthy();
    });

    it('uses URL game context when no active lobby game is stored', async () => {
        const customGameId = 'custom-url-settings-game';
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
            ],
        };
        mockLoadRendererGame.mockResolvedValue(makeRendererGame(customDefinition));
        mockGet.mockResolvedValue({
            ...makeSettings(),
            tactics: { difficulty: 'normal' },
        });
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });
        setSettingsUrl(`?gameId=${customGameId}`);

        render(<SettingsPage />);

        expect(await screen.findByRole('tab', { name: 'Combat' })).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'Display' })).toBeNull();
        expect(mockLoadRendererGame).toHaveBeenCalledWith(customGameId);
        expect(mockGet).toHaveBeenCalledWith(customGameId);

        fireEvent.change(screen.getByLabelText(/difficulty/i), { target: { value: 'hard' } });

        expect(mockUpdate).toHaveBeenCalledWith(customGameId, {
            tactics: { difficulty: 'hard' },
        });
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

// ── Token-driven engine strings ───────────────────────────────────────────────
//
// The engine settings strings are resolved through useTranslate() against the
// engine token catalogue, so a game override bundle re-keying an
// `engine.settings.*` token wins over the English default. These prove the page
// renders tokens, not hardcoded literals.

describe('SettingsPage — token-driven engine strings', () => {
    it('renders the modal title from the engine.settings.modalTitle token', async () => {
        renderWithOverride(<SettingsPage />, { 'engine.settings.modalTitle': 'Preferences' });
        await screen.findByRole('tab', { name: 'Audio' });

        expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeTruthy();
        expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    });

    it('renders a field label from its engine.settings token', async () => {
        renderWithOverride(<SettingsPage />, { 'engine.settings.masterVolume': 'Main Volume' });
        await screen.findByRole('tab', { name: 'Audio' });

        expect(screen.getByLabelText(/main volume/i)).toBeTruthy();
    });

    it('renders a tab label from its engine.settings tab token', async () => {
        renderWithOverride(<SettingsPage />, { 'engine.settings.tabAudio': 'Sound' });
        expect(await screen.findByRole('tab', { name: 'Sound' })).toBeTruthy();
    });
});

// ── AC #2 — Volume slider dispatches update ───────────────────────────────────

describe('SettingsPage — master volume slider (AC #2)', () => {
    it('marks the master volume input for settings page objects', async () => {
        await renderSettingsPage();
        expect(screen.getByTestId('master-volume')).toBeTruthy();
    });

    it('marks generated engine controls with stable E2E test ids', async () => {
        await renderSettingsPageAndOpenTab('Display');

        expect(screen.getByTestId('settings-control-display-targetfps')).toBeTruthy();
    });

    it('stretches settings controls to the full panel width', async () => {
        await renderSettingsPage();

        expect(screen.getByTestId('master-volume')).toBeTruthy();
        expect(pageCss).toMatch(/\.field\s*{[^}]*inline-size: 100%/s);
        expect(pageCss).not.toContain('max-inline-size: calc(var(--ch-space-xl) * 10)');
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

    it('labels the reset action compactly', async () => {
        await renderSettingsPage();
        expect(screen.getByRole('button', { name: /^reset$/i })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /reset to defaults/i })).toBeNull();
    });

    it('wraps the settings tabs and footer actions in one accessible modal dialog', async () => {
        await renderSettingsPage();

        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toContainElement(screen.getByTestId('settings-tabs'));
        expect(dialog).toContainElement(screen.getByTestId('settings-dialog-actions'));
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('renders the chrome-less Modal surface — the page module paints no panel of its own', async () => {
        await renderSettingsPage();

        expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAttribute(
            'data-ch-modal-size',
            'lg',
        );
        // No page-level panel chrome remains: the Modal owns the dialog surface.
        expect(pageCss).not.toContain('background-color');
        expect(pageCss).not.toContain('box-shadow');
    });

    it('keeps the dialog height static across tabs and scrolls overflowing tab content', async () => {
        await renderSettingsPage();

        // Static height comes from the Modal's fixed-height variant: the dialog
        // must not grow/shrink with the active tab's content.
        expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAttribute(
            'data-ch-modal-fixed-height',
            'true',
        );

        const fixedRule = /\.fixed-height\s*\{[^}]*\}/s.exec(modalCss)?.[0] ?? '';
        expect(fixedRule).toMatch(/[^-]block-size: min\(/);

        // Scrolling happens inside the body (Tabs scroll the active panel), not
        // on the dialog itself.
        const fixedBodyRule = /\.fixed-height \.body\s*\{[^}]*\}/s.exec(modalCss)?.[0] ?? '';
        expect(fixedBodyRule).toContain('overflow-y: hidden');
    });

    it('pads the dialog with the standard container spacing token', async () => {
        await renderSettingsPage();

        const dialogRule = /\.dialog\s*\{[^}]*\}/s.exec(modalCss)?.[0] ?? '';

        expect(dialogRule).toContain('padding: var(--ch-space-lg)');
    });

    it('calls window.__chimera.settings.reset with the active gameId and keeps the modal open', async () => {
        await renderSettingsPage();
        const btn = screen.getByRole('button', { name: /^reset$/i });
        fireEvent.click(btn);
        expect(mockReset).toHaveBeenCalledWith(GAME_ID);
        // Reset operates in place (dismiss: false) — it must not navigate away.
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('renders dialog-style reset and close controls aligned to the right', async () => {
        await renderSettingsPage();

        const actions = screen.getByTestId('settings-dialog-actions');
        expect(actions).toContainElement(screen.getByRole('button', { name: /^close$/i }));
        expect(actions).toContainElement(screen.getByRole('button', { name: /^reset$/i }));
        expect(modalCss).toMatch(/\.actions\s*{[^}]*justify-content: flex-end/s);
    });

    it('places Close as the rightmost dialog action', async () => {
        await renderSettingsPage();

        const actionLabels = within(screen.getByTestId('settings-dialog-actions'))
            .getAllByRole('button')
            .map((button) => button.textContent);

        expect(actionLabels).toEqual(['Reset', 'Close']);
    });

    it('navigates back to the engine main menu when close is clicked without game context', async () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        await renderSettingsPage();
        fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
        expect(mockPush).toHaveBeenCalledWith('/main-menu');
    });

    it('preserves URL game context when close returns to the main menu', async () => {
        setSettingsUrl('?gameId=tactics');
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        await renderSettingsPage();
        fireEvent.click(screen.getByRole('button', { name: /^close$/i }));

        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });
});

// ── Escape behaviour (chrome-less Modal conversion) ──────────────────────────

describe('SettingsPage — Escape behaviour', () => {
    it('closes to the main menu on Escape, preserving URL game context', async () => {
        setSettingsUrl('?gameId=tactics');
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        await renderSettingsPage();
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

        expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics');
    });

    it('cancels binding capture on Escape without closing the settings modal', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
        expect(screen.getByText(/press a key/i)).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

        expect(screen.queryByText(/press a key/i)).toBeNull();
        expect(mockPush).not.toHaveBeenCalled();
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
        expect(screen.getByLabelText(/master volume/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: 'Display' }));
        expect(screen.getByLabelText(/target fps/i)).toBeTruthy();
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
        const btn = screen.getByRole('button', { name: /^reset$/i });
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
const CYCLE_UNIT_ACTION: InputAction = {
    id: 'game:cycle-unit',
    description: 'Cycle to next unit',
    category: 'Game',
    oneShot: true,
};

function makeInputManagerDouble(overrides: Partial<InputManager> = {}): InputManager {
    const bindings: Record<InputActionId, KeyBinding> = {
        'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
        'engine:toggle-menu': { primary: 'Escape' },
        'game:end-turn': { primary: 'Enter' },
        'game:cycle-unit': { primary: 'KeyN' },
    };
    return {
        start: vi.fn(),
        stop: vi.fn(),
        isPressed: vi.fn().mockReturnValue(false),
        onAction: vi.fn(() => vi.fn()),
        setActiveCategory: vi.fn(),
        rebind: vi.fn().mockResolvedValue({ ok: true }),
        pollGamepad: vi.fn(),
        getActions: vi
            .fn()
            .mockReturnValue([UNDO_ACTION, TOGGLE_MENU_ACTION, END_TURN_ACTION, CYCLE_UNIT_ACTION]),
        getBinding: vi.fn((id: InputActionId) => bindings[id]),
        resetBinding: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

async function renderWithInputManager(inputManager: InputManager): Promise<void> {
    vi.mocked(useInputManager).mockReturnValue(inputManager);
    await renderSettingsPageAndOpenTab('Controls');
}

// ── AC #6 — Controls rebind panel renders game actions only ───────────────────

describe('SettingsPage — controls rebind panel (AC #6)', () => {
    it('renders descriptions for game actions and hides engine actions', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        expect(screen.getByText('End current turn')).toBeTruthy();
        expect(screen.getByText('Cycle to next unit')).toBeTruthy();
        expect(screen.queryByText('Undo last action')).toBeNull();
        expect(screen.queryByText('Toggle game menu')).toBeNull();
    });

    it('renders current binding key for each game action and no engine bindings', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        const values = screen.getAllByTestId('binding-value').map((el) => el.textContent);
        expect(values).toEqual(['Enter', 'KeyN']);
    });

    it('renders an "Edit" button for each game action', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        expect(editButtons.length).toBe(2);
    });

    it('renders a "Reset" button for each game action', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        const resetButtons = screen.getAllByTestId('binding-reset');
        expect(resetButtons.length).toBe(2);
    });

    it('omits category captions when only one category is visible', async () => {
        await renderWithInputManager(makeInputManagerDouble());
        expect(screen.queryByText('Engine')).toBeNull();
        expect(screen.queryByText('Game')).toBeNull();
    });

    it('renders category captions when game actions span multiple categories', async () => {
        const moveCursorAction: InputAction = {
            id: 'game:move-cursor',
            description: 'Move cursor',
            category: 'Movement',
            oneShot: false,
        };
        await renderWithInputManager(
            makeInputManagerDouble({
                getActions: vi
                    .fn()
                    .mockReturnValue([UNDO_ACTION, END_TURN_ACTION, moveCursorAction]),
            }),
        );
        expect(screen.getByRole('heading', { level: 3, name: 'Game' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 3, name: 'Movement' })).toBeTruthy();
        expect(screen.queryByText('Engine')).toBeNull();
    });

    it('shows the empty state when only engine actions are registered', async () => {
        await renderWithInputManager(
            makeInputManagerDouble({
                getActions: vi.fn().mockReturnValue([UNDO_ACTION, TOGGLE_MENU_ACTION]),
            }),
        );
        expect(screen.getByText('No controls registered.')).toBeTruthy();
        expect(screen.queryByTestId('binding-action-row')).toBeNull();
    });

    it('right-aligns current bindings and left-aligns per-action buttons', async () => {
        await renderWithInputManager(makeInputManagerDouble());

        const bindingValues = screen.getAllByTestId('binding-value');
        expect(bindingValues[0]).toHaveTextContent('Enter');
        expect(pageCss).toContain('.binding-value');
        expect(pageCss).toContain('justify-self: end');
        expect(pageCss).toContain('text-align: right');
        expect(pageCss).toMatch(/\.binding-actions\s*{[^}]*grid-column: 1/s);
        expect(pageCss).toMatch(/\.binding-actions\s*{[^}]*justify-content: flex-start/s);
        expect(pageCss).toMatch(/\.binding-actions\s*{[^}]*justify-self: start/s);
        expect(pageCss).toContain('.binding-action-button');
        expect(pageCss).toContain('--ch-button-min-width: calc(var(--ch-space-xl) * 2)');
    });

    it('sizes input-action labels to the compact input-field label size', () => {
        const actionLabelRule = /\.action-description\s*\{[^}]*\}/s.exec(pageCss)?.[0] ?? '';
        expect(actionLabelRule).toContain('font-size: var(--ch-font-size-sm)');
        expect(actionLabelRule).not.toContain('var(--ch-font-size-md)');
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

        expect(screen.getByText('No controls registered.')).toBeTruthy();
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
        fireEvent.click(editButtons[0]!); // Edit game:end-turn

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyA', key: 'a', ctrlKey: false });
        });

        expect(mockRebind).toHaveBeenCalledWith('game:end-turn', {
            primary: 'KeyA',
            modifiers: [],
        });
    });

    it('capture mode with Ctrl held includes Ctrl in the binding modifiers', async () => {
        const mockRebind = vi.fn().mockResolvedValue({ ok: true });
        await renderWithInputManager(makeInputManagerDouble({ rebind: mockRebind }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[0]!);

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyB', key: 'b', ctrlKey: true });
        });

        expect(mockRebind).toHaveBeenCalledWith('game:end-turn', {
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

        expect(secondRebind).toHaveBeenCalledWith('game:end-turn', {
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
            conflictingAction: 'game:end-turn',
        });
        await renderWithInputManager(makeInputManagerDouble({ rebind: conflictRebind }));

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
        fireEvent.click(editButtons[1]!); // Edit game:cycle-unit

        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', ctrlKey: true });
        });

        expect(screen.getByText(/conflict/i)).toBeTruthy();
    });

    it('shows "Unbind existing & rebind" button when there is a conflict', async () => {
        const conflictRebind = vi.fn().mockResolvedValue({
            ok: false,
            reason: 'conflict',
            conflictingAction: 'game:end-turn',
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
                conflictingAction: 'game:end-turn',
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

        expect(mockResetBinding).toHaveBeenCalledWith('game:end-turn');
        // rebind must be called twice: once producing conflict, once after unbing
        expect(conflictRebind).toHaveBeenCalledTimes(2);
    });

    it("force-rebinding one conflicted action uses that action's captured key even after another conflict is captured later", async () => {
        const conflictRebind = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                reason: 'conflict',
                conflictingAction: 'game:cycle-unit',
            })
            .mockResolvedValueOnce({
                ok: false,
                reason: 'conflict',
                conflictingAction: 'game:end-turn',
            })
            .mockResolvedValue({ ok: true });
        const mockResetBinding = vi.fn().mockResolvedValue(undefined);

        await renderWithInputManager(
            makeInputManagerDouble({ rebind: conflictRebind, resetBinding: mockResetBinding }),
        );

        const editButtons = screen.getAllByRole('button', { name: /^edit$/i });

        // Capture conflict for game:end-turn with Ctrl+X.
        fireEvent.click(editButtons[0]!);
        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyX', key: 'x', ctrlKey: true });
        });

        // Capture conflict for game:cycle-unit with Ctrl+Y.
        fireEvent.click(editButtons[1]!);
        await act(async () => {
            fireEvent.keyDown(document, { code: 'KeyY', key: 'y', ctrlKey: true });
        });

        const forceButtons = screen.getAllByRole('button', { name: /unbind existing/i });
        await act(async () => {
            // Resolve first conflict (game:end-turn) and assert it keeps its own captured key.
            fireEvent.click(forceButtons[0]!);
        });

        expect(conflictRebind).toHaveBeenLastCalledWith('game:end-turn', {
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

        const resetButtons = screen.getAllByTestId('binding-reset');
        await act(async () => {
            fireEvent.click(resetButtons[0]!); // reset game:end-turn
        });

        expect(mockResetBinding).toHaveBeenCalledWith('game:end-turn');
    });
});
