import { describe, expect, it } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { LobbyPage } from './LobbyPage';

interface WaitOptions {
    readonly state?: 'visible' | 'hidden' | 'attached' | 'detached';
}

type IndexRecorder = (index: number) => void;

interface BuildPageDoubleResult {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly clickedTestIds: string[];
    readonly filledValues: { readonly testId: string; readonly value: string }[];
    readonly waitedTestIds: string[];
    readonly nthSelections: { readonly testId: string; readonly index: number }[];
}

const buildPageDouble = (
    textByTestId: Readonly<Record<string, string>> = {},
): BuildPageDoubleResult => {
    const requestedTestIds: string[] = [];
    const clickedTestIds: string[] = [];
    const filledValues: { readonly testId: string; readonly value: string }[] = [];
    const waitedTestIds: string[] = [];
    const nthSelections: { readonly testId: string; readonly index: number }[] = [];

    const createLocator = (testId: string): Locator => {
        const recordNthSelection: IndexRecorder = (index: number): void => {
            nthSelections.push({ testId, index });
        };

        const locatorLike = {
            click: async (): Promise<void> => {
                clickedTestIds.push(testId);
            },
            fill: async (value: string): Promise<void> => {
                filledValues.push({ testId, value });
            },
            waitFor: async (_options?: WaitOptions): Promise<void> => {
                waitedTestIds.push(testId);
            },
            innerText: async (): Promise<string> => textByTestId[testId] ?? '',
            nth: (index: number): Locator => {
                recordNthSelection(index);
                return createLocator(testId);
            },
        };

        return locatorLike as Locator;
    };

    const page = {
        getByTestId: (testId: string): Locator => {
            requestedTestIds.push(testId);
            return createLocator(testId);
        },
    };

    return {
        page: page as Page,
        requestedTestIds,
        clickedTestIds,
        filledValues,
        waitedTestIds,
        nthSelections,
    };
};

describe('LobbyPage', () => {
    it('binds all lobby locators using test ids', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const lobbyPage = new LobbyPage(page);

        expect(lobbyPage.hostButton).toBeDefined();
        expect(lobbyPage.joinButton).toBeDefined();
        expect(lobbyPage.readyButton).toBeDefined();
        expect(lobbyPage.startButton).toBeDefined();
        expect(lobbyPage.playerList).toBeDefined();
        expect(lobbyPage.playerListItems).toBeDefined();
        expect(lobbyPage.connectionStatus).toBeDefined();
        expect(lobbyPage.addressInput).toBeDefined();
        expect(lobbyPage.confirmJoinButton).toBeDefined();
        expect(lobbyPage.sessionId).toBeDefined();

        expect(requestedTestIds).toEqual([
            'host-lobby',
            'join-lobby',
            'ready-toggle',
            'start-match',
            'player-list',
            'player-list-item',
            'connection-status',
            'address-input',
            'confirm-join',
            'lobby-session-id',
        ]);
    });

    it('reads the host-issued lobby code from the current lobby', async () => {
        const { page, waitedTestIds } = buildPageDouble({
            'lobby-session-id': '127.0.0.1:54321:abc123',
        });
        const lobbyPage = new LobbyPage(page);

        await expect(lobbyPage.lobbyCode()).resolves.toBe('127.0.0.1:54321:abc123');
        expect(waitedTestIds).toEqual(['lobby-session-id']);
    });

    it('hosts a lobby and waits for visible connection status', async () => {
        const { page, clickedTestIds, waitedTestIds } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.hostLobby();

        expect(clickedTestIds).toEqual(['host-lobby']);
        expect(waitedTestIds).toEqual(['connection-status']);
    });

    it('joins a lobby and waits for visible connection status', async () => {
        const { page, clickedTestIds, filledValues, waitedTestIds } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.joinLobby('ws://localhost:7779');

        expect(clickedTestIds).toEqual(['join-lobby', 'confirm-join']);
        expect(filledValues).toEqual([{ testId: 'address-input', value: 'ws://localhost:7779' }]);
        expect(waitedTestIds).toEqual(['connection-status']);
    });

    it('waits for the nth player list item to become visible', async () => {
        const { page, waitedTestIds, nthSelections } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.waitForPlayerCount(3);

        expect(nthSelections).toEqual([{ testId: 'player-list-item', index: 2 }]);
        expect(waitedTestIds).toEqual(['player-list-item']);
    });

    it('throws when waitForPlayerCount is called with count less than 1', async () => {
        const { page } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await expect(lobbyPage.waitForPlayerCount(0)).rejects.toThrow(
            'waitForPlayerCount requires count >= 1',
        );
        await expect(lobbyPage.waitForPlayerCount(-1)).rejects.toThrow(
            'waitForPlayerCount requires count >= 1',
        );
    });
});
