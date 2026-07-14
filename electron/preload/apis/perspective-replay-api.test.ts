import { describe, expect, it } from 'vitest';
import {
    PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL,
    PERSPECTIVE_REPLAY_DELETE_CHANNEL,
    PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
    PERSPECTIVE_REPLAY_LIST_CHANNEL,
    PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
    PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
    PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL,
    PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL,
    createPerspectiveReplayApi,
    type PerspectiveReplayApiIpcPort,
} from './perspective-replay-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import type { PerspectiveReplayPlaybackInfo, PlayerSnapshot } from '../api-types.js';

/**
 * Recording stub for the narrow `PerspectiveReplayApiIpcPort` slice. The
 * perspective surface only invokes (no push subscription — the renderer reuses
 * the deterministic `replay.onNavigate`), so the stub captures `invoke` calls.
 * Mirrors `replay-api.test.ts`.
 */
function makeIpcStub(): {
    readonly port: PerspectiveReplayApiIpcPort;
    readonly invocations: { channel: string; args: unknown[] }[];
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; args: unknown[] }[] = [];
    const invokeResults = new Map<string, unknown>();

    const port: PerspectiveReplayApiIpcPort = {
        invoke: (channel, ...args) => {
            invocations.push({ channel, args });
            return Promise.resolve(invokeResults.get(channel));
        },
    };

    return { port, invocations, invokeResults };
}

describe('createPerspectiveReplayApi', () => {
    describe('list()', () => {
        it('invokes chimera:replay:perspective:list with the gameId and resolves to the items', async () => {
            const stub = makeIpcStub();
            const expected = [
                {
                    path: '/perspective-replays/tactics/a.chimera-perspective-replay',
                    name: 'My Point of View',
                },
                { path: '/perspective-replays/tactics/b.chimera-perspective-replay' },
            ];
            stub.invokeResults.set(PERSPECTIVE_REPLAY_LIST_CHANNEL, expected);
            const api = createPerspectiveReplayApi(stub.port);

            const result = await api.list('tactics');

            expect(stub.invocations).toEqual([
                { channel: PERSPECTIVE_REPLAY_LIST_CHANNEL, args: ['tactics'] },
            ]);
            expect(result).toStrictEqual(expected);
        });

        it('rejects with PreloadIpcValidationError when main returns a non-array payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PERSPECTIVE_REPLAY_LIST_CHANNEL, 'not-an-array');
            const api = createPerspectiveReplayApi(stub.port);

            await expect(api.list('tactics')).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('exportCurrent()', () => {
        it('invokes chimera:replay:perspective:export-current with an empty payload and resolves to the saved path', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(
                PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
                '/perspective-replays/tactics/a.chimera-perspective-replay',
            );
            const api = createPerspectiveReplayApi(stub.port);

            const result = await api.exportCurrent();

            // No name → an empty payload; main fail-safe-defaults it to unnamed.
            expect(stub.invocations).toEqual([
                { channel: PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL, args: [{}] },
            ]);
            expect(result).toBe('/perspective-replays/tactics/a.chimera-perspective-replay');
        });

        it('carries the user-entered name in the export payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(
                PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
                '/perspective-replays/tactics/a.chimera-perspective-replay',
            );
            const api = createPerspectiveReplayApi(stub.port);

            await api.exportCurrent('Client POV');

            expect(stub.invocations).toEqual([
                {
                    channel: PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
                    args: [{ name: 'Client POV' }],
                },
            ]);
        });

        it('rejects with PreloadIpcValidationError when main returns a non-string path', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL, 42);
            const api = createPerspectiveReplayApi(stub.port);

            await expect(api.exportCurrent()).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('openInPlayer()', () => {
        it('invokes chimera:replay:perspective:open-in-player with the path and a default saveable=false', async () => {
            const stub = makeIpcStub();
            const api = createPerspectiveReplayApi(stub.port);

            await expect(
                api.openInPlayer('/perspective-replays/tactics/a.chimera-perspective-replay'),
            ).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([
                {
                    channel: PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
                    args: ['/perspective-replays/tactics/a.chimera-perspective-replay', false],
                },
            ]);
        });

        it('forwards saveable=true for a just-finished match', async () => {
            const stub = makeIpcStub();
            const api = createPerspectiveReplayApi(stub.port);

            await expect(
                api.openInPlayer('/perspective-replays/tactics/a.chimera-perspective-replay', true),
            ).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([
                {
                    channel: PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
                    args: ['/perspective-replays/tactics/a.chimera-perspective-replay', true],
                },
            ]);
        });
    });

    describe('delete()', () => {
        it('invokes chimera:replay:perspective:delete with the path and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createPerspectiveReplayApi(stub.port);

            await expect(
                api.delete('/perspective-replays/tactics/a.chimera-perspective-replay'),
            ).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([
                {
                    channel: PERSPECTIVE_REPLAY_DELETE_CHANNEL,
                    args: ['/perspective-replays/tactics/a.chimera-perspective-replay'],
                },
            ]);
        });
    });

    describe('openPlayback()', () => {
        const info: PerspectiveReplayPlaybackInfo = {
            gameId: 'tactics',
            totalTicks: 9,
            viewerId: 'p1',
        };

        it('invokes chimera:replay:perspective:open-playback with the path and resolves to PerspectiveReplayPlaybackInfo', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL, info);
            const api = createPerspectiveReplayApi(stub.port);

            const result = await api.openPlayback(
                '/perspective-replays/tactics/a.chimera-perspective-replay',
            );

            expect(stub.invocations).toEqual([
                {
                    channel: PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
                    args: ['/perspective-replays/tactics/a.chimera-perspective-replay'],
                },
            ]);
            expect(result).toStrictEqual(info);
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL, { gameId: 'tactics' });
            const api = createPerspectiveReplayApi(stub.port);

            await expect(
                api.openPlayback('/perspective-replays/tactics/a.chimera-perspective-replay'),
            ).rejects.toBeInstanceOf(PreloadIpcValidationError);
        });
    });

    describe('snapshotAt()', () => {
        it('invokes chimera:replay:perspective:snapshot-at with the tick and resolves to the PlayerSnapshot', async () => {
            const stub = makeIpcStub();
            const snapshot = { tick: 3, viewerId: 'p1' } as unknown as PlayerSnapshot;
            stub.invokeResults.set(PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL, snapshot);
            const api = createPerspectiveReplayApi(stub.port);

            const result = await api.snapshotAt(3);

            expect(stub.invocations).toEqual([
                { channel: PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL, args: [3] },
            ]);
            expect(result).toBe(snapshot);
        });
    });

    describe('snapshotRange()', () => {
        it('invokes chimera:replay:perspective:snapshot-range with a {from,to} payload and resolves to the array', async () => {
            const stub = makeIpcStub();
            const snapshots = [
                { tick: 2, viewerId: 'p1' },
                { tick: 5, viewerId: 'p1' },
            ] as unknown as PlayerSnapshot[];
            stub.invokeResults.set(PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL, snapshots);
            const api = createPerspectiveReplayApi(stub.port);

            const result = await api.snapshotRange(2, 5);

            expect(stub.invocations).toEqual([
                { channel: PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL, args: [{ from: 2, to: 5 }] },
            ]);
            expect(result).toBe(snapshots);
        });
    });

    describe('closePlayback()', () => {
        it('invokes chimera:replay:perspective:close-playback with no argument and resolves to void', async () => {
            const stub = makeIpcStub();
            const api = createPerspectiveReplayApi(stub.port);

            await expect(api.closePlayback()).resolves.toBeUndefined();
            expect(stub.invocations).toEqual([
                { channel: PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL, args: [] },
            ]);
        });
    });
});
