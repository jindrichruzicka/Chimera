import { describe, expect, it } from 'vitest';
import {
    CONTENT_GET_COLLECTIONS_CHANNEL,
    createContentApi,
    type ContentApiIpcPort,
} from './content-api.js';
import { PreloadIpcValidationError } from '../shared/schemas.js';
import type { GameContent } from '../api-types.js';

function makeIpcStub(): {
    readonly port: ContentApiIpcPort;
    readonly invocations: { channel: string; arg: unknown }[];
    readonly invokeResults: Map<string, unknown>;
} {
    const invocations: { channel: string; arg: unknown }[] = [];
    const invokeResults = new Map<string, unknown>();
    const port: ContentApiIpcPort = {
        invoke: (channel, arg) => {
            invocations.push({ channel, arg });
            return Promise.resolve(invokeResults.get(channel));
        },
    };
    return { port, invocations, invokeResults };
}

const SAMPLE: GameContent = {
    'player-colors': [{ id: 'blue', name: 'Blue', hex: '#2563eb' }],
    'board-colors': [{ id: 'slate', name: 'Slate', hex: '#3f3f46' }],
};

describe('createContentApi', () => {
    describe('getCollections()', () => {
        it('invokes chimera:content:get-collections with the gameId and resolves to the collections', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(CONTENT_GET_COLLECTIONS_CHANNEL, SAMPLE);
            const api = createContentApi(stub.port);

            const result = await api.getCollections('tactics');

            expect(stub.invocations).toEqual([
                { channel: CONTENT_GET_COLLECTIONS_CHANNEL, arg: { gameId: 'tactics' } },
            ]);
            expect(result).toStrictEqual(SAMPLE);
        });

        it('resolves to null when the game declares no content', async () => {
            const stub = makeIpcStub();
            stub.invokeResults.set(CONTENT_GET_COLLECTIONS_CHANNEL, null);
            const api = createContentApi(stub.port);

            await expect(api.getCollections('tic-tac-toe')).resolves.toBeNull();
        });

        it('rejects with PreloadIpcValidationError when main returns a malformed payload', async () => {
            const stub = makeIpcStub();
            // An item missing the required string `id` fails the structural schema.
            stub.invokeResults.set(CONTENT_GET_COLLECTIONS_CHANNEL, {
                'player-colors': [{ name: 'Blue' }],
            });
            const api = createContentApi(stub.port);

            await expect(api.getCollections('tactics')).rejects.toBeInstanceOf(
                PreloadIpcValidationError,
            );
        });
    });
});
