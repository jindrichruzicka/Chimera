import { describe, expect, it } from 'vitest';

import {
    SPECTATE_SET_TARGET_CHANNEL,
    createSpectatorApi,
    type SpectatorApiIpcPort,
} from './spectator-api.js';
import { playerId } from '../api-types.js';

// ─── IPC stub ─────────────────────────────────────────────────────────────────

function makeIpcStub(): {
    readonly port: SpectatorApiIpcPort;
    readonly sends: { channel: string; args: readonly unknown[] }[];
} {
    const sends: { channel: string; args: readonly unknown[] }[] = [];
    const port: SpectatorApiIpcPort = {
        send: (channel, ...args) => {
            sends.push({ channel, args });
        },
    };
    return { port, sends };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createSpectatorApi', () => {
    describe('setFollowedTarget()', () => {
        it('sends chimera:spectate:set-target with { targetPlayerId }', () => {
            const stub = makeIpcStub();
            const api = createSpectatorApi(stub.port);

            api.setFollowedTarget(playerId('seat-2'));

            expect(stub.sends).toEqual([
                {
                    channel: SPECTATE_SET_TARGET_CHANNEL,
                    args: [{ targetPlayerId: playerId('seat-2') }],
                },
            ]);
        });

        it('returns void', () => {
            const stub = makeIpcStub();
            const api = createSpectatorApi(stub.port);

            expect(api.setFollowedTarget(playerId('seat-2'))).toBeUndefined();
        });
    });
});
