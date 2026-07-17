// @vitest-environment jsdom

/**
 * renderer/state/settingsStoreBootstrap.test.ts
 *
 * Unit tests for settingsStoreBootstrap.
 * Verifies that bootstrapSettingsStore registers the onChange callback and
 * routes incoming push events into the settingsStore singleton.
 *
 * Architecture reference: §F07 hardening #157 (BLOCK-2, WARN-4)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    SettingsAPI,
    Unsubscribe,
    ResolvedSettings,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { bootstrapSettingsStore } from './settingsStoreBootstrap';
import { useSettingsStore } from './settingsStore';
import { ENGINE_SETTINGS_GAME_ID } from '../input/KeyBindingRepository.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeSettings = (masterVolume = 1.0): ResolvedSettings => ({
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
            'engine:redo': { primary: 'KeyZ', modifiers: ['Ctrl', 'Shift'] },
            'engine:toggle-menu': { primary: 'Escape' },
        },
    },
});

function makeApi(
    onChangeImpl?: (cb: (gameId: string, settings: ResolvedSettings) => void) => Unsubscribe,
): SettingsAPI {
    return {
        get: vi.fn().mockResolvedValue(makeSettings()),
        update: vi.fn(),
        reset: vi.fn(),
        onChange: vi.fn(onChangeImpl ?? (() => vi.fn())),
    };
}

async function flushPromiseJobs(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

// Reset the singleton store between tests
beforeEach(() => {
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

// ── bootstrapSettingsStore ────────────────────────────────────────────────────

describe('bootstrapSettingsStore()', () => {
    it('registers an onChange callback with the bridge', () => {
        const api = makeApi();
        bootstrapSettingsStore(api);
        expect(api.onChange).toHaveBeenCalledOnce();
    });

    it('returns an Unsubscribe function', () => {
        const unsubscribe = vi.fn();
        const api = makeApi(() => unsubscribe);
        const result = bootstrapSettingsStore(api);
        expect(typeof result).toBe('function');
    });

    it('calling the returned unsubscribe invokes the bridge unsubscribe', () => {
        const unsubscribe = vi.fn();
        const api = makeApi(() => unsubscribe);
        const stop = bootstrapSettingsStore(api);
        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('routes onChange (gameId, settings) push event into the store via _applySettings', () => {
        let captured: ((gameId: string, settings: ResolvedSettings) => void) | undefined;
        const unsub = vi.fn();
        const api = makeApi((cb) => {
            captured = cb;
            return unsub;
        });

        bootstrapSettingsStore(api);
        expect(captured).toBeDefined();

        const incoming = makeSettings(0.42);
        captured!('tactics', incoming);

        const stored = useSettingsStore.getState().settings['tactics'];
        expect(stored).toBe(incoming);
    });

    it('loads initial engine settings into the store', async () => {
        const incoming = makeSettings(0.42);
        const api = makeApi();
        vi.mocked(api.get).mockResolvedValue(incoming);

        bootstrapSettingsStore(api);
        await flushPromiseJobs();

        expect(api.get).toHaveBeenCalledWith(ENGINE_SETTINGS_GAME_ID);
        expect(useSettingsStore.getState().settings[ENGINE_SETTINGS_GAME_ID]).toBe(incoming);
    });

    it('does not let initial engine replay overwrite a fresher engine push event', async () => {
        let captured: ((gameId: string, settings: ResolvedSettings) => void) | undefined;
        let resolveInitial!: (settings: ResolvedSettings) => void;
        const api = makeApi((cb) => {
            captured = cb;
            return vi.fn();
        });
        vi.mocked(api.get).mockReturnValue(
            new Promise<ResolvedSettings>((resolve) => {
                resolveInitial = resolve;
            }),
        );

        bootstrapSettingsStore(api);
        expect(captured).toBeDefined();

        const staleInitialSettings = makeSettings(0.1);
        const fresherPushedSettings = makeSettings(0.9);
        captured!('__engine__', fresherPushedSettings);

        resolveInitial(staleInitialSettings);
        await flushPromiseJobs();

        expect(useSettingsStore.getState().settings['__engine__']).toBe(fresherPushedSettings);
    });

    it('warns when initial engine settings replay fails', async () => {
        const error = new Error('settings unavailable');
        const api = makeApi();
        vi.mocked(api.get).mockRejectedValue(error);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        try {
            bootstrapSettingsStore(api);
            await flushPromiseJobs();

            expect(warn).toHaveBeenCalledWith(
                '[settingsStoreBootstrap] Failed to replay engine settings:',
                error,
            );
        } finally {
            warn.mockRestore();
        }
    });

    it('routes push events for multiple games independently', () => {
        let captured: ((gameId: string, settings: ResolvedSettings) => void) | undefined;
        const unsub = vi.fn();
        const api = makeApi((cb) => {
            captured = cb;
            return unsub;
        });

        bootstrapSettingsStore(api);

        captured!('tactics', makeSettings(0.1));
        captured!('chess', makeSettings(0.9));

        const t = useSettingsStore.getState().settings['tactics'] as {
            audio: { masterVolume: number };
        };
        const c = useSettingsStore.getState().settings['chess'] as {
            audio: { masterVolume: number };
        };
        expect(t.audio.masterVolume).toBe(0.1);
        expect(c.audio.masterVolume).toBe(0.9);
    });
});
