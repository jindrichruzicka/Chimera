import { describe, expect, it } from 'vitest';
import { CONTENT_GET_COLLECTIONS_CHANNEL } from '../../preload/apis/content-api.js';
import type { GameContent } from '@chimera/shared/game-content-contract.js';
import {
    registerContentHandlers,
    type ContentProviderPort,
    type LobbyHandlersIpcMain,
    type LobbyInvokeHandler,
} from './ipc-handlers.js';
import { IpcRequestValidationError } from './ipc-schemas.js';

const TACTICS_CONTENT: GameContent = {
    'player-colors': [{ id: 'blue', name: 'Blue', hex: '#2563eb' }],
    'board-colors': [{ id: 'slate', name: 'Slate', hex: '#3f3f46' }],
};

function makeIpcMainStub(): {
    readonly ipcMain: LobbyHandlersIpcMain;
    readonly handled: Map<string, LobbyInvokeHandler>;
} {
    const handled = new Map<string, LobbyInvokeHandler>();
    const ipcMain: LobbyHandlersIpcMain = {
        handle: (channel, handler) => {
            handled.set(channel, handler);
        },
    };
    return { ipcMain, handled };
}

const contentProvider: ContentProviderPort = {
    getCollections: (gameId) => (gameId === 'tactics' ? TACTICS_CONTENT : null),
};

describe('registerContentHandlers', () => {
    it('returns the game content collections for a known gameId', async () => {
        const stub = makeIpcMainStub();
        registerContentHandlers({ ipcMain: stub.ipcMain, contentProvider });

        const handler = stub.handled.get(CONTENT_GET_COLLECTIONS_CHANNEL);
        expect(handler).toBeDefined();

        const result = await Promise.resolve(handler?.({}, { gameId: 'tactics' }));
        expect(result).toStrictEqual(TACTICS_CONTENT);
    });

    it('returns null for a game that declares no content', async () => {
        const stub = makeIpcMainStub();
        registerContentHandlers({ ipcMain: stub.ipcMain, contentProvider });

        const handler = stub.handled.get(CONTENT_GET_COLLECTIONS_CHANNEL);
        const result = await Promise.resolve(handler?.({}, { gameId: 'tic-tac-toe' }));
        expect(result).toBeNull();
    });

    it('rejects a malformed request (missing gameId) with IpcRequestValidationError', () => {
        const stub = makeIpcMainStub();
        registerContentHandlers({ ipcMain: stub.ipcMain, contentProvider });

        const handler = stub.handled.get(CONTENT_GET_COLLECTIONS_CHANNEL);
        expect(() => handler?.({}, {})).toThrow(IpcRequestValidationError);
    });
});
