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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './page';
import { useSettingsStore } from '../../state/settingsStore';
import type { ResolvedSettings } from '@chimera/electron/preload/api-types.js';

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

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    vi.resetAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);
    setChimera();
    useSettingsStore.setState({
        settings: { [GAME_ID]: makeSettings() },
        activeGameId: GAME_ID,
    });
});

afterEach(() => {
    cleanup();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

// ── AC #1 — All five sections rendered ───────────────────────────────────────

describe('SettingsPage — section rendering (AC #1)', () => {
    it('renders the Audio section heading', () => {
        render(<SettingsPage />);
        expect(screen.getByRole('heading', { name: /audio/i })).toBeTruthy();
    });

    it('renders the Display section heading', () => {
        render(<SettingsPage />);
        expect(screen.getByRole('heading', { name: /display/i })).toBeTruthy();
    });

    it('renders the Gameplay section heading', () => {
        render(<SettingsPage />);
        expect(screen.getByRole('heading', { name: /gameplay/i })).toBeTruthy();
    });

    it('renders the Controls section heading as a placeholder', () => {
        render(<SettingsPage />);
        expect(screen.getByRole('heading', { name: /controls/i })).toBeTruthy();
    });

    it('renders the Game Settings section when game-specific keys are present', () => {
        useSettingsStore.setState({
            settings: { [GAME_ID]: { ...makeSettings(), mapSize: 12 } },
            activeGameId: GAME_ID,
        });
        render(<SettingsPage />);
        expect(screen.getByRole('heading', { name: /game settings/i })).toBeTruthy();
    });

    it('does not render the Game Settings section when no game-specific keys are present', () => {
        render(<SettingsPage />);
        expect(screen.queryByRole('heading', { name: /game settings/i })).toBeNull();
    });
});

// ── AC #2 — Volume slider dispatches update ───────────────────────────────────

describe('SettingsPage — master volume slider (AC #2)', () => {
    it('marks the master volume input for settings page objects', () => {
        render(<SettingsPage />);
        expect(screen.getByTestId('master-volume')).toBeTruthy();
    });

    it('calls window.__chimera.settings.update with audio masterVolume patch when slider changes', () => {
        render(<SettingsPage />);
        const slider = screen.getByLabelText(/master volume/i);
        fireEvent.change(slider, { target: { value: '0.4' } });
        expect(mockUpdate).toHaveBeenCalledWith(GAME_ID, { audio: { masterVolume: 0.4 } });
    });

    it('slider initial value reflects settings from the store', () => {
        render(<SettingsPage />);
        const slider = screen.getByLabelText<HTMLInputElement>(/master volume/i);
        expect(slider.value).toBe('0.8');
    });
});

// ── AC #3 — Reset to defaults button ─────────────────────────────────────────

describe('SettingsPage — reset to defaults (AC #3)', () => {
    it('marks the reset button for settings page objects', () => {
        render(<SettingsPage />);
        expect(screen.getByTestId('reset-to-defaults')).toBeTruthy();
    });

    it('calls window.__chimera.settings.reset with the active gameId when reset is clicked', () => {
        render(<SettingsPage />);
        const btn = screen.getByRole('button', { name: /reset to defaults/i });
        fireEvent.click(btn);
        expect(mockReset).toHaveBeenCalledWith(GAME_ID);
    });
});

// ── AC #4 — Live update on onChange push ─────────────────────────────────────

describe('SettingsPage — onChange push updates form without unmounting (AC #4)', () => {
    it('updates the masterVolume slider when _applySettings is called', () => {
        render(<SettingsPage />);

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
});

// ── AC #5 — Engine-wide settings (activeGameId === null) ──────────────────────
//
// Invariant #36: When no game is active, settings updates are dispatched against
// the reserved '__engine__' gameId. This allows engine-wide settings to be
// configured even before a game is loaded.
//
// Confirming '__engine__' is an accepted reserved id end-to-end (WARN-3).

describe('SettingsPage — engine-wide settings when activeGameId is null (AC #5)', () => {
    it('renders form controls even when activeGameId is null', () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        render(<SettingsPage />);
        expect(screen.getByRole('heading', { name: /audio/i })).toBeTruthy();
        expect(screen.getByRole('heading', { name: /display/i })).toBeTruthy();
    });

    it('dispatches update with __engine__ gameId when activeGameId is null', () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        render(<SettingsPage />);
        const slider = screen.getByLabelText(/master volume/i);
        fireEvent.change(slider, { target: { value: '0.4' } });

        expect(mockUpdate).toHaveBeenCalledWith('__engine__', { audio: { masterVolume: 0.4 } });
    });

    it('dispatches reset with __engine__ gameId when activeGameId is null', () => {
        useSettingsStore.setState({
            settings: { __engine__: makeSettings() },
            activeGameId: null,
        });

        render(<SettingsPage />);
        const btn = screen.getByRole('button', { name: /reset to defaults/i });
        fireEvent.click(btn);

        expect(mockReset).toHaveBeenCalledWith('__engine__');
    });
});
