// @vitest-environment jsdom

/**
 * renderer/state/settingsStore.test.ts
 *
 * Unit tests for the settingsStore Zustand store.
 * Uses jsdom environment (no real Electron IPC).
 */

import { describe, it, expect, vi } from 'vitest';
import { useSettingsStore, createSettingsStore } from './settingsStore';
import type { ResolvedSettings } from '../../electron/preload/api-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeSettings = (masterVolume = 1.0): ResolvedSettings => ({
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
            'engine:redo': { primary: 'KeyZ', modifiers: ['Ctrl', 'Shift'] },
            'engine:toggle-menu': { primary: 'Escape' },
        },
    },
});

// ── createSettingsStore (standalone instance for isolation) ───────────────────

describe('settingsStore — initial state', () => {
    it('initialises with empty settings map and null activeGameId', () => {
        const store = createSettingsStore();
        expect(store.getState().settings).toEqual({});
        expect(store.getState().activeGameId).toBeNull();
    });
});

describe('settingsStore._applySettings()', () => {
    it('stores resolved settings keyed by gameId', () => {
        const store = createSettingsStore();
        const s = makeSettings();
        store.getState()._applySettings('tactics', s);
        expect(store.getState().settings['tactics']).toEqual(s);
    });

    it('updates existing entry when called again for same gameId', () => {
        const store = createSettingsStore();
        store.getState()._applySettings('tactics', makeSettings(0.5));
        store.getState()._applySettings('tactics', makeSettings(0.9));
        const result = store.getState().settings['tactics'] as { audio: { masterVolume: number } };
        expect(result.audio.masterVolume).toBe(0.9);
    });

    it('stores settings for multiple games independently', () => {
        const store = createSettingsStore();
        store.getState()._applySettings('tactics', makeSettings(0.3));
        store.getState()._applySettings('chess', makeSettings(0.7));
        const t = store.getState().settings['tactics'] as { audio: { masterVolume: number } };
        const c = store.getState().settings['chess'] as { audio: { masterVolume: number } };
        expect(t.audio.masterVolume).toBe(0.3);
        expect(c.audio.masterVolume).toBe(0.7);
    });
});

describe('settingsStore.updateSettings()', () => {
    it('calls bridge.settings.update and applies returned settings', async () => {
        const updated = makeSettings(0.4);
        const updateFn = vi.fn().mockResolvedValue(updated);
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);

        await store.getState().updateSettings('tactics', { audio: { masterVolume: 0.4 } });

        expect(updateFn).toHaveBeenCalledWith('tactics', { audio: { masterVolume: 0.4 } });
        const result = store.getState().settings['tactics'] as { audio: { masterVolume: number } };
        expect(result.audio.masterVolume).toBe(0.4);
    });
});

describe('settingsStore.resetSettings()', () => {
    it('calls bridge.settings.reset and applies returned settings', async () => {
        const defaults = makeSettings(1.0);
        const resetFn = vi.fn().mockResolvedValue(defaults);
        const bridge = {
            settings: { update: vi.fn(), get: vi.fn(), reset: resetFn, onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings('tactics', makeSettings(0.1));

        await store.getState().resetSettings('tactics');

        expect(resetFn).toHaveBeenCalledWith('tactics');
        const result = store.getState().settings['tactics'] as { audio: { masterVolume: number } };
        expect(result.audio.masterVolume).toBe(1.0);
    });
});

// ── Singleton hook export ─────────────────────────────────────────────────────

describe('useSettingsStore', () => {
    it('is defined and returns a function', () => {
        expect(typeof useSettingsStore).toBe('function');
    });

    it('returns initial state via selector', () => {
        const settings = useSettingsStore.getState().settings;
        expect(settings).toBeDefined();
        expect(typeof settings).toBe('object');
    });
});

// ── Named bridge error (WARN-3) ───────────────────────────────────────────────

describe('settingsStore — named bridge error when bridge is unavailable (WARN-3)', () => {
    it('updateSettings throws a named error when no bridge is provided and globalThis.__chimera is absent', async () => {
        // Ensure globalThis.__chimera is not set
        const g = globalThis as Record<string, unknown>;
        const prev = g['__chimera'];
        delete g['__chimera'];

        const store = createSettingsStore(); // no bridge argument
        await expect(store.getState().updateSettings('game', {})).rejects.toThrow(
            /\[settingsStore\] preload bridge unavailable/,
        );

        g['__chimera'] = prev; // restore
    });

    it('resetSettings throws a named error when no bridge is provided and globalThis.__chimera is absent', async () => {
        const g = globalThis as Record<string, unknown>;
        const prev = g['__chimera'];
        delete g['__chimera'];

        const store = createSettingsStore();
        await expect(store.getState().resetSettings('game')).rejects.toThrow(
            /\[settingsStore\] preload bridge unavailable/,
        );

        g['__chimera'] = prev;
    });
});
