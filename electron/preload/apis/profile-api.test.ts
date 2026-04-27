import { buildAssetRef, type TextureAsset } from '@chimera/simulation/content/AssetRef.js';
import { describe, expect, it, vi } from 'vitest';
import {
    PROFILE_DIRECTORY_CHANGED_CHANNEL,
    PROFILE_GET_LOBBY_DIRECTORY_CHANNEL,
    PROFILE_GET_LOCAL_CHANNEL,
    PROFILE_UPDATE_LOCAL_CHANNEL,
    createProfileApi,
    type ProfileApiIpcPort,
} from './profile-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import type { EngineProfile, PlayerProfile, PlayerId } from '../api-types.js';
import type { IpcListener } from '../shared/listener.js';

// ─── IPC stub ─────────────────────────────────────────────────────────────────

function makeIpcStub(): {
    readonly port: ProfileApiIpcPort;
    readonly invocations: { channel: string; args: readonly unknown[] }[];
    readonly listeners: Map<string, Set<IpcListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const listeners = new Map<string, Set<IpcListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: ProfileApiIpcPort = {
        invoke: (channel, ...args) => {
            invocations.push({ channel, args });
            return Promise.resolve(invokeResults.get(channel));
        },
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<IpcListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };

    return { port, invocations, listeners, invokeResults };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
    return {
        localProfileId: 'local-1',
        displayName: 'Alice',
        avatar: { kind: 'builtin', ref: buildAssetRef<TextureAsset>('avatar', 'default') },
        locale: 'en-US',
        ...overrides,
    };
}

function makeDirectory(
    entries: [PlayerId, PlayerProfile][] = [],
): Readonly<Record<PlayerId, PlayerProfile>> {
    return Object.fromEntries(entries);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createProfileApi', () => {
    describe('getLocalProfile()', () => {
        it('invokes chimera:profile:get-local with no extra args', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_GET_LOCAL_CHANNEL, makeProfile());
            const api = createProfileApi(stub.port);

            await api.getLocalProfile();

            expect(stub.invocations).toEqual([{ channel: PROFILE_GET_LOCAL_CHANNEL, args: [] }]);
        });

        it('resolves to the PlayerProfile returned by main', async () => {
            const stub = makeIpcStub();
            const expected = makeProfile({ displayName: 'Bob' });
            stub.invokeResults.set(PROFILE_GET_LOCAL_CHANNEL, expected);
            const api = createProfileApi(stub.port);

            const result = await api.getLocalProfile();

            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a non-object', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_GET_LOCAL_CHANNEL, 'not-a-profile');
            const api = createProfileApi(stub.port);

            await expect(api.getLocalProfile()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });

        it('rejects with PreloadIpcValidationError when main returns a profile with missing fields', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_GET_LOCAL_CHANNEL, {
                localProfileId: 'p1',
                displayName: 'Alice',
                // avatar and locale are missing
            });
            const api = createProfileApi(stub.port);

            await expect(api.getLocalProfile()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });

        it('resolves to a profile with a custom avatar', async () => {
            const stub = makeIpcStub();
            const expected = makeProfile({
                avatar: { kind: 'custom', mimeType: 'image/png', base64: 'abc123' },
            });
            stub.invokeResults.set(PROFILE_GET_LOCAL_CHANNEL, expected);
            const api = createProfileApi(stub.port);

            const result = await api.getLocalProfile();

            expect(result.avatar).toEqual({
                kind: 'custom',
                mimeType: 'image/png',
                base64: 'abc123',
            });
        });
    });

    describe('updateLocal()', () => {
        it('invokes chimera:profile:update-local with the patch', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_UPDATE_LOCAL_CHANNEL, undefined);
            const api = createProfileApi(stub.port);
            const patch: Partial<EngineProfile> = { displayName: 'Charlie' };

            await api.updateLocal(patch);

            expect(stub.invocations).toEqual([
                { channel: PROFILE_UPDATE_LOCAL_CHANNEL, args: [patch] },
            ]);
        });

        it('resolves to undefined (Promise<void>)', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_UPDATE_LOCAL_CHANNEL, undefined);
            const api = createProfileApi(stub.port);

            const result = await api.updateLocal({ displayName: 'Dave' });

            expect(result).toBeUndefined();
        });

        it('forwards avatar-only patches', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_UPDATE_LOCAL_CHANNEL, undefined);
            const api = createProfileApi(stub.port);
            const patch: Partial<EngineProfile> = {
                avatar: { kind: 'custom', mimeType: 'image/jpeg', base64: 'xyz789' },
            };

            await api.updateLocal(patch);

            expect(stub.invocations[0]).toEqual({
                channel: PROFILE_UPDATE_LOCAL_CHANNEL,
                args: [patch],
            });
        });
    });

    describe('getLobbyDirectory()', () => {
        it('invokes chimera:profile:get-lobby-directory with no extra args', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL, makeDirectory());
            const api = createProfileApi(stub.port);

            await api.getLobbyDirectory();

            expect(stub.invocations).toEqual([
                { channel: PROFILE_GET_LOBBY_DIRECTORY_CHANNEL, args: [] },
            ]);
        });

        it('resolves to the directory record returned by main', async () => {
            const stub = makeIpcStub();
            const profile = makeProfile();
            const expected = makeDirectory([['player-1', profile]]);
            stub.invokeResults.set(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL, expected);
            const api = createProfileApi(stub.port);

            const result = await api.getLobbyDirectory();

            expect(result).toStrictEqual(expected);
        });

        it('resolves to an empty record when the lobby has no profiles', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL, {});
            const api = createProfileApi(stub.port);

            const result = await api.getLobbyDirectory();

            expect(result).toStrictEqual({});
        });

        it('rejects with PreloadIpcValidationError when main returns a non-object', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL, null);
            const api = createProfileApi(stub.port);

            await expect(api.getLobbyDirectory()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });

        it('rejects with PreloadIpcValidationError when a profile entry is malformed', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PROFILE_GET_LOBBY_DIRECTORY_CHANNEL, {
                'player-1': { displayName: 'Broken' }, // missing localProfileId, avatar, locale
            });
            const api = createProfileApi(stub.port);

            await expect(api.getLobbyDirectory()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('onDirectoryChanged()', () => {
        it('registers a listener on chimera:profile:directory-changed', () => {
            const stub = makeIpcStub();
            const api = createProfileApi(stub.port);
            const callback =
                vi.fn<(directory: Readonly<Record<PlayerId, PlayerProfile>>) => void>();

            api.onDirectoryChanged(callback);

            expect(stub.listeners.get(PROFILE_DIRECTORY_CHANGED_CHANNEL)?.size).toBe(1);
        });

        it('forwards the directory payload to the callback', () => {
            const stub = makeIpcStub();
            const api = createProfileApi(stub.port);
            const callback =
                vi.fn<(directory: Readonly<Record<PlayerId, PlayerProfile>>) => void>();

            api.onDirectoryChanged(callback);

            const directory = makeDirectory([['p1', makeProfile()]]);
            const listener = [...(stub.listeners.get(PROFILE_DIRECTORY_CHANGED_CHANNEL) ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, directory);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(directory);
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createProfileApi(stub.port);
            const callback =
                vi.fn<(directory: Readonly<Record<PlayerId, PlayerProfile>>) => void>();

            const unsubscribe = api.onDirectoryChanged(callback);
            const beforeUnsub = stub.listeners.get(PROFILE_DIRECTORY_CHANGED_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(PROFILE_DIRECTORY_CHANGED_CHANNEL)?.size).toBe(0);
        });

        it('supports multiple independent subscriptions', () => {
            const stub = makeIpcStub();
            const api = createProfileApi(stub.port);
            const cbA = vi.fn<(directory: Readonly<Record<PlayerId, PlayerProfile>>) => void>();
            const cbB = vi.fn<(directory: Readonly<Record<PlayerId, PlayerProfile>>) => void>();

            const unsubA = api.onDirectoryChanged(cbA);
            api.onDirectoryChanged(cbB);

            const directory = makeDirectory([['p1', makeProfile()]]);
            const listeners = [...(stub.listeners.get(PROFILE_DIRECTORY_CHANGED_CHANNEL) ?? [])];
            listeners.forEach((l) => l({ sender: 'fake' }, directory));

            expect(cbA).toHaveBeenCalledOnce();
            expect(cbB).toHaveBeenCalledOnce();

            unsubA();
            expect(stub.listeners.get(PROFILE_DIRECTORY_CHANGED_CHANNEL)?.size).toBe(1);
        });
    });
});
