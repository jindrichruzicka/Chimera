import { describe, expect, it, vi } from 'vitest';
import { DEBUG_TOGGLE_INSPECTOR_CHANNEL } from '@chimera-engine/simulation/foundation/constants.js';
import {
    SYSTEM_CONNECTION_STATUS_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANGE_CHANNEL,
    SYSTEM_I18N_TOKEN_MODE_CHANNEL,
    SYSTEM_PLATFORM_CHANNEL,
    SYSTEM_QUIT_CHANNEL,
    SYSTEM_RELAUNCH_CHANNEL,
    createSystemApi,
    type SystemApiIpcPort,
    type SystemApiListener,
} from './system-api.js';
import type { ConnectionStatus, DeviceInfo } from '../api-types.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';

/**
 * Minimal recording stub that captures every `ipcRenderer` call the system
 * API makes, so we can assert the channel/payload contract.
 */
function makeIpcStub(): {
    readonly port: SystemApiIpcPort;
    readonly invocations: string[];
    readonly sends: string[];
    readonly listeners: Map<string, Set<SystemApiListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: string[] = [];
    const sends: string[] = [];
    const listeners = new Map<string, Set<SystemApiListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: SystemApiIpcPort = {
        invoke: (channel) => {
            invocations.push(channel);
            return Promise.resolve(invokeResults.get(channel));
        },
        send: (channel) => {
            sends.push(channel);
        },
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<SystemApiListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };

    return { port, invocations, sends, listeners, invokeResults };
}

describe('createSystemApi', () => {
    describe('platform()', () => {
        it('invokes the chimera:system:platform channel', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(SYSTEM_PLATFORM_CHANNEL, { os: 'linux', version: '33.0.0' });
            const api = createSystemApi(stub.port);

            const result = await api.platform();

            expect(stub.invocations).toEqual([SYSTEM_PLATFORM_CHANNEL]);
            expect(result).toEqual({ os: 'linux', version: '33.0.0' });
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            // Missing `version` — violates PlatformInfoSchema.
            stub.invokeResults.set(SYSTEM_PLATFORM_CHANNEL, { os: 'linux' });
            const api = createSystemApi(stub.port);

            await expect(api.platform()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('quit()', () => {
        it('sends on the chimera:system:quit channel without awaiting', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);

            api.quit();

            expect(stub.sends).toEqual([SYSTEM_QUIT_CHANNEL]);
        });

        it('calls the injected notifyQuit callback when provided, then still sends the IPC', () => {
            const stub = makeIpcStub();
            const notifyQuit = vi.fn();
            const api = createSystemApi(stub.port, notifyQuit);

            api.quit();

            expect(notifyQuit).toHaveBeenCalledOnce();
            expect(stub.sends).toEqual([SYSTEM_QUIT_CHANNEL]);
        });

        it('still sends the IPC when no notifyQuit callback is provided', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);

            expect(() => api.quit()).not.toThrow();
            expect(stub.sends).toEqual([SYSTEM_QUIT_CHANNEL]);
        });
    });

    describe('relaunch()', () => {
        it('sends on the chimera:system:relaunch channel without awaiting', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);

            api.relaunch();

            expect(stub.sends).toEqual([SYSTEM_RELAUNCH_CHANNEL]);
        });
    });

    describe('onConnectionStatus()', () => {
        it('registers a listener on chimera:system:connection-status and forwards the status', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const callback = vi.fn<(status: ConnectionStatus) => void>();

            api.onConnectionStatus(callback);

            const registered = stub.listeners.get(SYSTEM_CONNECTION_STATUS_CHANNEL);
            expect(registered?.size).toBe(1);

            // Main emits via `webContents.send(channel, ...args)`; the preload
            // receives (event, ...args). Verify the API strips the event and
            // forwards only the payload.
            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, 'connected');

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith('connected');
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const callback = vi.fn<(status: ConnectionStatus) => void>();

            const unsubscribe = api.onConnectionStatus(callback);
            const beforeUnsub = stub.listeners.get(SYSTEM_CONNECTION_STATUS_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(SYSTEM_CONNECTION_STATUS_CHANNEL)?.size).toBe(0);
        });

        it('supports multiple independent subscriptions', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const cbA = vi.fn<(status: ConnectionStatus) => void>();
            const cbB = vi.fn<(status: ConnectionStatus) => void>();

            const unsubA = api.onConnectionStatus(cbA);
            api.onConnectionStatus(cbB);

            // Emit via every registered listener; both callbacks should fire.
            const set = stub.listeners.get(SYSTEM_CONNECTION_STATUS_CHANNEL);
            for (const listener of set ?? []) {
                listener({}, 'disconnected');
            }
            expect(cbA).toHaveBeenCalledOnce();
            expect(cbA).toHaveBeenCalledWith('disconnected');
            expect(cbB).toHaveBeenCalledOnce();
            expect(cbB).toHaveBeenCalledWith('disconnected');

            // Unsubscribing A keeps B subscribed.
            cbA.mockClear();
            cbB.mockClear();
            unsubA();
            const remaining = stub.listeners.get(SYSTEM_CONNECTION_STATUS_CHANNEL);
            for (const listener of remaining ?? []) {
                listener({}, 'connecting');
            }
            expect(cbA).not.toHaveBeenCalled();
            expect(cbB).toHaveBeenCalledOnce();
            expect(cbB).toHaveBeenCalledWith('connecting');
        });
    });

    describe('onI18nTokenMode()', () => {
        it('registers a listener on chimera:system:i18n-token-mode and forwards the boolean', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const callback = vi.fn<(enabled: boolean) => void>();

            api.onI18nTokenMode(callback);

            const registered = stub.listeners.get(SYSTEM_I18N_TOKEN_MODE_CHANNEL);
            expect(registered?.size).toBe(1);

            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, true);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(true);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const callback = vi.fn<(enabled: boolean) => void>();

            const unsubscribe = api.onI18nTokenMode(callback);
            const beforeUnsub = stub.listeners.get(SYSTEM_I18N_TOKEN_MODE_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(SYSTEM_I18N_TOKEN_MODE_CHANNEL)?.size).toBe(0);
        });
    });

    describe('getDeviceInfo()', () => {
        const validDeviceInfo: DeviceInfo = {
            os: 'macos',
            osVersion: '14.5.0',
            arch: 'arm64',
            electronVer: '33.2.0',
            chromiumVer: '130.0.0.0',
            locale: 'en-US',
            formFactor: 'unknown',
            screens: [
                { id: 1, width: 1920, height: 1080, pixelRatio: 2, refreshHz: 60, primary: true },
            ],
            windowSizeClass: 'large',
            inputs: ['mouse', 'keyboard'],
            primaryInput: 'mouse',
            battery: null,
        };

        it('invokes chimera:system:device-info channel', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(SYSTEM_DEVICE_INFO_CHANNEL, validDeviceInfo);
            const api = createSystemApi(stub.port);

            await api.getDeviceInfo();

            expect(stub.invocations).toEqual([SYSTEM_DEVICE_INFO_CHANNEL]);
        });

        it('returns the validated DeviceInfo payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(SYSTEM_DEVICE_INFO_CHANNEL, validDeviceInfo);
            const api = createSystemApi(stub.port);

            const result = await api.getDeviceInfo();

            expect(result).toEqual(validDeviceInfo);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            // Missing required fields — violates DeviceInfoSchema.
            stub.invokeResults.set(SYSTEM_DEVICE_INFO_CHANNEL, { os: 'macos' });
            const api = createSystemApi(stub.port);

            await expect(api.getDeviceInfo()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('onDeviceInfoChange()', () => {
        const deviceInfo: DeviceInfo = {
            os: 'linux',
            osVersion: '6.1.0',
            arch: 'x64',
            electronVer: '33.2.0',
            chromiumVer: '130.0.0.0',
            locale: 'en-US',
            formFactor: 'unknown',
            screens: [
                { id: 1, width: 1920, height: 1080, pixelRatio: 1, refreshHz: 60, primary: true },
            ],
            windowSizeClass: 'large',
            inputs: ['mouse', 'keyboard'],
            primaryInput: 'mouse',
            battery: null,
        };

        it('registers a listener on chimera:system:device-info-change and forwards DeviceInfo', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const callback = vi.fn<(info: DeviceInfo) => void>();

            api.onDeviceInfoChange(callback);

            const registered = stub.listeners.get(SYSTEM_DEVICE_INFO_CHANGE_CHANNEL);
            expect(registered?.size).toBe(1);

            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, deviceInfo);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(deviceInfo);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const callback = vi.fn<(info: DeviceInfo) => void>();

            const unsubscribe = api.onDeviceInfoChange(callback);
            const beforeUnsub = stub.listeners.get(SYSTEM_DEVICE_INFO_CHANGE_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(SYSTEM_DEVICE_INFO_CHANGE_CHANNEL)?.size).toBe(0);
        });

        it('throws PreloadIpcValidationError when main pushes a malformed DeviceInfo payload', () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);
            const callback = vi.fn<(info: DeviceInfo) => void>();

            api.onDeviceInfoChange(callback);

            const registered = stub.listeners.get(SYSTEM_DEVICE_INFO_CHANGE_CHANNEL);
            const listener = [...(registered ?? [])][0];

            // Push a payload missing required fields — should throw before reaching callback.
            expect(() => listener?.({ sender: 'fake-webcontents' }, { os: 'macos' })).toThrow(
                PreloadIpcValidationError,
            );
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('toggleDebugInspector()', () => {
        it('sends on the chimera:debug:toggle-inspector channel and performs no invoke', async () => {
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);

            await api.toggleDebugInspector();

            expect(stub.sends).toEqual([DEBUG_TOGGLE_INSPECTOR_CHANNEL]);
            expect(stub.invocations).toEqual([]);
        });

        it('resolves without throwing when no IPC handler is registered (production no-op)', async () => {
            // The stub wires no handler for the channel — exactly like
            // production, where debug-bridge.ts never registers its
            // ipcMain.on listener. A fire-and-forget send cannot reject.
            const stub = makeIpcStub();
            const api = createSystemApi(stub.port);

            await expect(api.toggleDebugInspector()).resolves.toBeUndefined();
        });
    });
});
