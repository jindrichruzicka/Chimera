// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import type { ResolvedSettings } from '@chimera-engine/simulation/bridge/api-types.js';
import { I18nProvider } from '../i18n/I18nProvider';
import * as rendererGameRegistry from '../game/rendererGameRegistry';
import { useSettingsStore } from '../state/settingsStore';
import { SettingsLanguageSelector } from './SettingsLanguageSelector';

const GAME_ID = 'tactics';

const LANGUAGES: readonly GameLanguage[] = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
];

function makeSettings(language = 'en-US'): ResolvedSettings {
    return {
        audio: { masterVolume: 0.8, sfxVolume: 1.0, musicVolume: 0.7, muted: false },
        display: { fullscreen: false, vsync: true, targetFps: 60 as const, uiScale: 1.0 },
        gameplay: {
            language,
            autoSave: true,
            autoSaveIntervalTurns: 5,
            showHints: true,
            showPerfHud: false,
        },
        controls: { bindings: {} },
    };
}

const render = (ui: ReactElement): ReturnType<typeof baseRender> =>
    baseRender(<I18nProvider>{ui}</I18nProvider>);

const mockUpdate = vi.fn();

function setChimera(): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            settings: {
                update: mockUpdate,
                reset: vi.fn().mockResolvedValue(undefined),
                get: vi.fn().mockResolvedValue(undefined),
                onChange: vi.fn(),
            },
        },
    });
}

beforeEach(() => {
    mockUpdate.mockReset();
    mockUpdate.mockImplementation((gameId: string, patch: unknown) => {
        const current = useSettingsStore.getState().settings[gameId] ?? makeSettings();
        return Promise.resolve({ ...current, ...(patch as object) });
    });
    setChimera();
    useSettingsStore.setState({
        settings: { [GAME_ID]: makeSettings() },
        activeGameId: GAME_ID,
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

describe('SettingsLanguageSelector', () => {
    it('reflects the current gameplay.language from the settings store', () => {
        useSettingsStore.setState({
            settings: { [GAME_ID]: makeSettings('cs-CZ') },
            activeGameId: GAME_ID,
        });

        render(<SettingsLanguageSelector gameId={GAME_ID} languages={LANGUAGES} />);

        expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('cs-CZ');
    });

    it('writes the new language through updateSettings when a language is selected', async () => {
        const user = userEvent.setup();
        render(<SettingsLanguageSelector gameId={GAME_ID} languages={LANGUAGES} />);

        await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'cs-CZ');

        expect(mockUpdate).toHaveBeenCalledWith(GAME_ID, { gameplay: { language: 'cs-CZ' } });
    });

    it('defaults the game context to the active game in the settings store', async () => {
        const user = userEvent.setup();
        render(<SettingsLanguageSelector languages={LANGUAGES} />);

        await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'cs-CZ');

        expect(mockUpdate).toHaveBeenCalledWith(GAME_ID, { gameplay: { language: 'cs-CZ' } });
    });

    it('renders null when the game declares fewer than two languages', () => {
        const { container } = render(
            <SettingsLanguageSelector gameId={GAME_ID} languages={[LANGUAGES[0]!]} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('resolves declared languages from the loaded shell when no prop is supplied', async () => {
        const loadShellSpy = vi
            .spyOn(rendererGameRegistry, 'loadRendererGameShell')
            .mockResolvedValue({ translations: { languages: LANGUAGES, bundles: {} } });

        render(<SettingsLanguageSelector gameId={GAME_ID} />);

        await waitFor(() =>
            expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument(),
        );
        expect(screen.getByRole('option', { name: 'Čeština' })).toHaveValue('cs-CZ');
        expect(loadShellSpy).toHaveBeenCalledWith(GAME_ID);
    });

    it('self-hides when the loaded shell contributes no languages', async () => {
        const loadShellSpy = vi
            .spyOn(rendererGameRegistry, 'loadRendererGameShell')
            .mockResolvedValue({});

        const { container } = render(<SettingsLanguageSelector gameId={GAME_ID} />);

        await waitFor(() => expect(loadShellSpy).toHaveBeenCalledWith(GAME_ID));
        expect(container).toBeEmptyDOMElement();
    });

    it('does not show the previous game’s languages while a new gameId is still loading', async () => {
        const OTHER_GAME_ID = 'other';
        useSettingsStore.setState({
            settings: { [GAME_ID]: makeSettings(), [OTHER_GAME_ID]: makeSettings() },
            activeGameId: GAME_ID,
        });
        // First game resolves immediately; the second game's shell load stays
        // pending, so only the reset (not the new load) can clear the old list.
        let resolveOther: (shell: rendererGameRegistry.LoadedRendererGameShell) => void = () =>
            undefined;
        const loadShellSpy = vi
            .spyOn(rendererGameRegistry, 'loadRendererGameShell')
            .mockImplementation((gameId: string) => {
                if (gameId === GAME_ID) {
                    return Promise.resolve({
                        translations: { languages: LANGUAGES, bundles: {} },
                    });
                }
                return new Promise((resolve) => {
                    resolveOther = resolve;
                });
            });

        const { rerender } = render(<SettingsLanguageSelector gameId={GAME_ID} />);
        await waitFor(() =>
            expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument(),
        );

        rerender(
            <I18nProvider>
                <SettingsLanguageSelector gameId={OTHER_GAME_ID} />
            </I18nProvider>,
        );

        // The old game's languages must not linger while OTHER_GAME_ID loads.
        await waitFor(() =>
            expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull(),
        );
        expect(loadShellSpy).toHaveBeenCalledWith(OTHER_GAME_ID);

        // Sanity: once the new game resolves, its languages appear.
        resolveOther({ translations: { languages: LANGUAGES, bundles: {} } });
        await waitFor(() =>
            expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument(),
        );
    });
});
