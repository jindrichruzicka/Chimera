// @vitest-environment jsdom

/**
 * renderer/input/KeyBindingRepository.test.ts
 *
 * Unit tests for the KeyBindingRepository — the thin adapter over
 * settings.controls.bindings (§4.26, Invariant #66).
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: KeyBindingRepository is renderer-only.
 * Invariant #66: Key bindings are stored under settings.controls.bindings.
 */

import { describe, expect, it, vi } from 'vitest';
import { createKeyBindingRepository } from './KeyBindingRepository.js';
import { createSettingsStore } from '../state/settingsStore.js';
import type { InputActionId } from './InputAction.js';
import type { KeyBinding } from './InputBindingSchema.js';
import type { ResolvedSettings } from '../../electron/preload/api-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const UNDO_BINDING: KeyBinding = { primary: 'KeyZ', modifiers: ['Ctrl'] };
const REDO_BINDING: KeyBinding = { primary: 'KeyZ', modifiers: ['Ctrl', 'Shift'] };
const TOGGLE_MENU_BINDING: KeyBinding = { primary: 'Escape' };
const TOGGLE_PERF_HUD_BINDING: KeyBinding = { primary: 'F3' };

function makeSettings(bindings: Record<string, KeyBinding> = {}): ResolvedSettings {
    return {
        audio: { masterVolume: 1, sfxVolume: 1, musicVolume: 0.8, muted: false },
        display: { fullscreen: false, vsync: true, targetFps: 60, uiScale: 1 },
        gameplay: {
            language: 'en-US',
            autoSave: true,
            autoSaveIntervalTurns: 5,
            showHints: true,
            showPerfHud: false,
        },
        controls: {
            bindings,
        },
    };
}

// ── getAll() ──────────────────────────────────────────────────────────────────

describe('KeyBindingRepository.getAll()', () => {
    it('returns an empty object when no settings are loaded', () => {
        const store = createSettingsStore();
        const repo = createKeyBindingRepository(store);

        expect(repo.getAll()).toEqual({});
    });

    it('returns controls.bindings from the active game settings', () => {
        const store = createSettingsStore();
        store.getState()._applySettings(
            'tactics',
            makeSettings({
                'engine:undo': UNDO_BINDING,
                'engine:redo': REDO_BINDING,
            }),
        );
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        expect(repo.getAll()).toEqual({
            'engine:undo': UNDO_BINDING,
            'engine:redo': REDO_BINDING,
        });
    });

    it('falls back to __engine__ bindings when activeGameId is null', () => {
        const store = createSettingsStore();
        store.getState()._applySettings(
            '__engine__',
            makeSettings({
                'engine:toggle-menu': TOGGLE_MENU_BINDING,
            }),
        );
        const repo = createKeyBindingRepository(store);

        expect(store.getState().activeGameId).toBeNull();
        expect(repo.getAll()).toEqual({
            'engine:toggle-menu': TOGGLE_MENU_BINDING,
        });
    });

    it('falls back to __engine__ bindings when activeGameId has no settings entry', () => {
        const store = createSettingsStore();
        store.getState()._applySettings(
            '__engine__',
            makeSettings({
                'engine:toggle-perf-hud': TOGGLE_PERF_HUD_BINDING,
            }),
        );
        store.setState({ activeGameId: 'unknown-game' });
        const repo = createKeyBindingRepository(store);

        expect(repo.getAll()).toEqual({
            'engine:toggle-perf-hud': TOGGLE_PERF_HUD_BINDING,
        });
    });

    it('returns {} when neither active game nor __engine__ has settings', () => {
        const store = createSettingsStore();
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        expect(repo.getAll()).toEqual({});
    });
});

// ── get() ─────────────────────────────────────────────────────────────────────

describe('KeyBindingRepository.get()', () => {
    it('returns the KeyBinding for a known action id', () => {
        const store = createSettingsStore();
        store.getState()._applySettings(
            'tactics',
            makeSettings({
                'engine:undo': UNDO_BINDING,
                'engine:redo': REDO_BINDING,
            }),
        );
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        expect(repo.get('engine:undo')).toEqual(UNDO_BINDING);
    });

    it('returns undefined for an action id not in bindings', () => {
        const store = createSettingsStore();
        store.getState()._applySettings(
            'tactics',
            makeSettings({
                'engine:undo': UNDO_BINDING,
            }),
        );
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        expect(repo.get('engine:toggle-menu')).toBeUndefined();
    });

    it('returns undefined when no settings are loaded', () => {
        const store = createSettingsStore();
        const repo = createKeyBindingRepository(store);

        expect(repo.get('engine:undo')).toBeUndefined();
    });
});

// ── save() ────────────────────────────────────────────────────────────────────

describe('KeyBindingRepository.save()', () => {
    it('calls updateSettings with a controls.bindings patch containing the new binding', async () => {
        const newBinding: KeyBinding = { primary: 'KeyA' };
        const resultSettings = makeSettings({ 'engine:undo': newBinding });
        const updateFn = vi.fn().mockResolvedValue(resultSettings);
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings(
            'tactics',
            makeSettings({
                'engine:undo': UNDO_BINDING,
                'engine:redo': REDO_BINDING,
            }),
        );
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        await repo.save('engine:undo', newBinding);

        expect(updateFn).toHaveBeenCalledWith('tactics', {
            controls: {
                bindings: {
                    'engine:undo': newBinding,
                    'engine:redo': REDO_BINDING,
                },
            },
        });
    });

    it('uses __engine__ game id when activeGameId is null', async () => {
        const newBinding: KeyBinding = { primary: 'Escape' };
        const resultSettings = makeSettings({ 'engine:toggle-menu': newBinding });
        const updateFn = vi.fn().mockResolvedValue(resultSettings);
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings(
            '__engine__',
            makeSettings({
                'engine:toggle-menu': TOGGLE_MENU_BINDING,
            }),
        );
        const repo = createKeyBindingRepository(store);

        await repo.save('engine:toggle-menu', newBinding);

        expect(updateFn).toHaveBeenCalledWith(
            '__engine__',
            expect.objectContaining({
                controls: {
                    bindings: {
                        'engine:toggle-menu': newBinding,
                    },
                },
            }),
        );
    });

    it('applies the updated settings to the store after save', async () => {
        const newBinding: KeyBinding = { primary: 'KeyB' };
        const resultSettings = makeSettings({ 'engine:undo': newBinding });
        const updateFn = vi.fn().mockResolvedValue(resultSettings);
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings(
            'tactics',
            makeSettings({
                'engine:undo': UNDO_BINDING,
            }),
        );
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        await repo.save('engine:undo', newBinding);

        const stored = store.getState().settings['tactics'] as {
            controls: { bindings: Record<string, KeyBinding> };
        };
        expect(stored.controls.bindings['engine:undo']).toEqual(newBinding);
    });
});

// ── reset() ────────────────────────────────────────────────────────────────────

describe('KeyBindingRepository.reset()', () => {
    it('restores the engine default binding after a save', async () => {
        const customBinding: KeyBinding = { primary: 'KeyA' };
        const defaultBinding: KeyBinding = { primary: 'KeyZ', modifiers: ['Ctrl'] };
        // Save returns the custom binding, reset returns engine default.
        const updateFn = vi
            .fn()
            .mockResolvedValueOnce(makeSettings({ 'engine:undo': customBinding }))
            .mockResolvedValueOnce(makeSettings({ 'engine:undo': defaultBinding }));
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings('tactics', makeSettings({ 'engine:undo': customBinding }));
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        // First save a custom binding
        await repo.save('engine:undo', customBinding);
        // Then reset it — should call updateSettings to restore the engine default
        await repo.reset('engine:undo');

        const stored = store.getState().settings['tactics'] as {
            controls: { bindings: Record<string, KeyBinding> };
        };
        expect(stored.controls.bindings['engine:undo']).toEqual(defaultBinding);
    });

    it('reset() removes the action override by calling updateSettings without that binding key', async () => {
        const customBinding: KeyBinding = { primary: 'KeyA' };
        const afterReset = makeSettings({
            'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
        });
        const updateFn = vi.fn().mockResolvedValue(afterReset);
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings('tactics', makeSettings({ 'engine:undo': customBinding }));
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        await repo.reset('engine:undo');

        // Must remove the override key so layered merge can restore the default.
        expect(updateFn).toHaveBeenCalledWith(
            'tactics',
            expect.objectContaining({
                controls: {
                    bindings: {},
                },
            }),
        );
    });

    it('reset() removes a game-action override so it falls back to defaults from layered merge', async () => {
        const dashBinding: KeyBinding = { primary: 'KeyQ' };
        const updateFn = vi.fn().mockResolvedValue(makeSettings({ 'engine:undo': UNDO_BINDING }));
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings(
            'tactics',
            makeSettings({
                'engine:undo': UNDO_BINDING,
                'game:dash': dashBinding,
            }),
        );
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        await repo.reset('game:dash');

        expect(updateFn).toHaveBeenCalledWith(
            'tactics',
            expect.objectContaining({
                controls: {
                    bindings: {
                        'engine:undo': UNDO_BINDING,
                    },
                },
            }),
        );
    });

    it('reset() for an unknown id that is not currently overridden is a no-op (does not call update)', async () => {
        const updateFn = vi.fn().mockResolvedValue(makeSettings());
        const bridge = {
            settings: { update: updateFn, get: vi.fn(), reset: vi.fn(), onChange: vi.fn() },
        };
        const store = createSettingsStore(bridge);
        store.getState()._applySettings('tactics', makeSettings());
        store.setState({ activeGameId: 'tactics' });
        const repo = createKeyBindingRepository(store);

        // 'game:custom-action' has no engine default — should be a no-op
        const unknownAction: InputActionId = 'game:custom-action';
        await repo.reset(unknownAction);

        expect(updateFn).not.toHaveBeenCalled();
    });
});
