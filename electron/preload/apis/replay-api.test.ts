import { describe, expect, it, vi } from 'vitest';
import {
    REPLAY_DELETE_CHANNEL,
    REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
    REPLAY_LIST_CHANNEL,
    REPLAY_NAVIGATE_CHANNEL,
    REPLAY_OPEN_IN_PLAYER_CHANNEL,
    createReplayApi,
    type ReplayApiIpcPort,
} from './replay-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import type { IpcListener } from '../shared/listener.js';
import type { ReplayListItem } from '../api-types.js';

/**
 * Recording stub for the narrow `ReplayApiIpcPort` slice. Captures every call
 * so tests can assert the exact channel / payload protocol without pulling in
 * a real Electron `ipcRenderer`. Mirrors `saves-api.test.ts`.
 */
function makeIpcStub(): {
    readonly port: ReplayApiIpcPort;
    readonly invocations: { channel: string; args: unknown[] }[];
    readonly listeners: Map<string, Set<IpcListener>>;
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; args: unknown[] }[] = [];
    const listeners = new Map<string, Set<IpcListener>>();
    const invokeResults = new Map<string, unknown>();

    const port: ReplayApiIpcPort = {
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

function makeItem(overrides: Partial<ReplayListItem> = {}): ReplayListItem {
    return {
        path: '/replays/tactics/abc.chimera-replay',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        engineVersion: '0.1.0',
        recordedAt: '2026-06-02T10:00:00.000Z',
        durationTicks: 9,
        playerIds: ['p1', 'p2'],
        ...overrides,
    };
}

describe('createReplayApi', () => {
    describe('list()', () => {
        it('invokes chimera:replay:list with the gameId and resolves to ReplayListItem[]', async () => {
            const stub = makeIpcStub();
            const expected = [
                makeItem(),
                makeItem({ path: '/replays/tactics/def.chimera-replay' }),
            ];
            stub.invokeResults.set(REPLAY_LIST_CHANNEL, expected);
            const api = createReplayApi(stub.port);

            const result = await api.list('tactics');

            expect(stub.invocations).toEqual([{ channel: REPLAY_LIST_CHANNEL, args: ['tactics'] }]);
            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(REPLAY_LIST_CHANNEL, 'not-an-array');
            const api = createReplayApi(stub.port);

            await expect(api.list('tactics')).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('exportCurrentMatch()', () => {
        it('invokes chimera:replay:export-current-match with no argument and resolves to the saved path', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(
                REPLAY_EXPORT_CURRENT_MATCH_CHANNEL,
                '/replays/tactics/abc.chimera-replay',
            );
            const api = createReplayApi(stub.port);

            const result = await api.exportCurrentMatch();

            expect(stub.invocations).toEqual([
                { channel: REPLAY_EXPORT_CURRENT_MATCH_CHANNEL, args: [] },
            ]);
            expect(result).toBe('/replays/tactics/abc.chimera-replay');
        });

        it('rejects with PreloadIpcValidationError when main returns a non-string path', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(REPLAY_EXPORT_CURRENT_MATCH_CHANNEL, 42);
            const api = createReplayApi(stub.port);

            await expect(api.exportCurrentMatch()).rejects.toBeInstanceOf(
                PreloadIpcValidationError,
            );
        });
    });

    describe('openInPlayer()', () => {
        it('invokes chimera:replay:open-in-player with the path and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createReplayApi(stub.port);

            await expect(
                api.openInPlayer('/replays/tactics/abc.chimera-replay'),
            ).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([
                {
                    channel: REPLAY_OPEN_IN_PLAYER_CHANNEL,
                    args: ['/replays/tactics/abc.chimera-replay'],
                },
            ]);
        });
    });

    describe('delete()', () => {
        it('invokes chimera:replay:delete with the path and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createReplayApi(stub.port);

            await expect(
                api.delete('/replays/tactics/abc.chimera-replay'),
            ).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([
                { channel: REPLAY_DELETE_CHANNEL, args: ['/replays/tactics/abc.chimera-replay'] },
            ]);
        });
    });

    describe('onNavigate()', () => {
        it('registers a listener on chimera:replay:navigate and forwards only the path payload', () => {
            const stub = makeIpcStub();
            const api = createReplayApi(stub.port);
            const callback = vi.fn<(path: string) => void>();

            api.onNavigate(callback);

            const registered = stub.listeners.get(REPLAY_NAVIGATE_CHANNEL);
            expect(registered?.size).toBe(1);

            const listener = [...(registered ?? [])][0];
            listener?.({ sender: 'fake-webcontents' }, '/replays/tactics/abc.chimera-replay');

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith('/replays/tactics/abc.chimera-replay');
        });

        it('returns an Unsubscribe that removes only the wrapped listener', () => {
            const stub = makeIpcStub();
            const api = createReplayApi(stub.port);
            const callback = vi.fn<(path: string) => void>();

            const unsubscribe = api.onNavigate(callback);
            const beforeUnsub = stub.listeners.get(REPLAY_NAVIGATE_CHANNEL)?.size;
            unsubscribe();

            expect(beforeUnsub).toBe(1);
            expect(stub.listeners.get(REPLAY_NAVIGATE_CHANNEL)?.size).toBe(0);
        });
    });
});
