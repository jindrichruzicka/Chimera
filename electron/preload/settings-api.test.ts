import { describe, expect, it, vi } from 'vitest';
import {
    SETTINGS_CHANGE_CHANNEL,
    SETTINGS_GET_CHANNEL,
    SETTINGS_RESET_CHANNEL,
    SETTINGS_UPDATE_CHANNEL,
    createSettingsApi,
    type SettingsApiIpcPort,
    type SettingsApiListener,
} from './settings-api.js';
import type { ResolvedSettings, UserSettings } from './api.js';

/**
 * Recording stub for the narrow `SettingsApiIpcPort` slice. Captures every
 * call so tests can assert the exact channel / payload protocol without
 * pulling in a real Electron `ipcRenderer`.
 */
function makeIpcStub(): {
    readonly port: SettingsApiIpcPort;
    readonly invocations: { channel: string; args: readonly unknown[] }[];
    readonly listeners: Map<string, Set<SettingsApiListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const listeners = new Map<string, Set<SettingsApiListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: SettingsApiIpcPort = {
        invoke: (channel, ...args) => {
            invocations.push({ channel, args });
            return Promise.resolve(invokeResults.get(channel));
        },
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<SettingsApiListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };

    return { port, invocations, listeners, invokeResults };
}

function makeSettings(overrides: ResolvedSettings = {}): ResolvedSettings {
    return { masterVolume: 0.8, ...overrides };
}

describe('createSettingsApi', () => {
    describe('get()', () => {
        it('invokes chimera:settings:get with the gameId and resolves to ResolvedSettings', async () => {
            const stub = makeIpcStub();
            const expected = makeSettings();
            stub.invokeResults.set(SETTINGS_GET_CHANNEL, expected);
            const api = createSettingsApi(stub.port);

            const result = await api.get('sample-game');

            expect(stub.invocations).toEqual([
                { channel: SETTINGS_GET_CHANNEL, args: ['sample-game'] },
            ]);
            expect(result).toBe(expected);
        });
    });

    describe('update()', () => {
        it('invokes chimera:settings:update with (gameId, patch) and resolves to ResolvedSettings', async () => {
            const stub = makeIpcStub();
            const expected = makeSettings({ masterVolume: 0.5 });
            stub.invokeResults.set(SETTINGS_UPDATE_CHANNEL, expected);
            const api = createSettingsApi(stub.port);
            const patch: Partial<UserSettings> = { masterVolume: 0.5 };

            const result = await api.update('sample-game', patch);

            expect(stub.invocations).toEqual([
                { channel: SETTINGS_UPDATE_CHANNEL, args: ['sample-game', patch] },
            ]);
            expect(result).toBe(expected);
        });
    });

    describe('reset()', () => {
        it('invokes chimera:settings:reset with the gameId and resolves to ResolvedSettings', async () => {
            const stub = makeIpcStub();
            const expected = makeSettings();
            stub.invokeResults.set(SETTINGS_RESET_CHANNEL, expected);
            const api = createSettingsApi(stub.port);

            const result = await api.reset('sample-game');

            expect(stub.invocations).toEqual([
                { channel: SETTINGS_RESET_CHANNEL, args: ['sample-game'] },
            ]);
            expect(result).toBe(expected);
        });
    });

    describe('onChange()', () => {
        it('registers a listener on chimera:settings:change and forwards (gameId, settings)', () => {
            const stub = makeIpcStub();
            const api = createSettingsApi(stub.port);
            const callback = vi.fn<(gameId: string, settings: ResolvedSettings) => void>();

            api.onChange(callback);

            const registered = stub.listeners.get(SETTINGS_CHANGE_CHANNEL);
            expect(registered?.size).toBe(1);

            const settings = makeSettings({ masterVolume: 0.25 });
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, 'sample-game', settings);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith('sample-game', settings);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createSettingsApi(stub.port);
            const callback = vi.fn<(gameId: string, settings: ResolvedSettings) => void>();

            const unsubscribe = api.onChange(callback);
            const beforeUnsub = stub.listeners.get(SETTINGS_CHANGE_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(SETTINGS_CHANGE_CHANNEL)?.size).toBe(0);
        });

        it('supports multiple independent subscriptions', () => {
            const stub = makeIpcStub();
            const api = createSettingsApi(stub.port);
            const cbA = vi.fn<(gameId: string, settings: ResolvedSettings) => void>();
            const cbB = vi.fn<(gameId: string, settings: ResolvedSettings) => void>();

            const unsubA = api.onChange(cbA);
            api.onChange(cbB);

            const settings = makeSettings();
            for (const listener of stub.listeners.get(SETTINGS_CHANGE_CHANNEL) ?? []) {
                listener({}, 'sample-game', settings);
            }
            expect(cbA).toHaveBeenCalledOnce();
            expect(cbA).toHaveBeenCalledWith('sample-game', settings);
            expect(cbB).toHaveBeenCalledOnce();

            cbA.mockClear();
            cbB.mockClear();
            unsubA();
            for (const listener of stub.listeners.get(SETTINGS_CHANGE_CHANNEL) ?? []) {
                listener({}, 'sample-game', settings);
            }
            expect(cbA).not.toHaveBeenCalled();
            expect(cbB).toHaveBeenCalledOnce();
        });
    });
});
