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
    readonly attributeReads: { readonly testId: string; readonly name: string }[];
    readonly evaluateCount: () => number;
}

const buildPageDouble = (
    options: {
        readonly textByTestId?: Readonly<Record<string, string>>;
        readonly attributesByTestId?: Readonly<Record<string, Readonly<Record<string, string>>>>;
        readonly evaluateResult?: unknown;
    } = {},
): BuildPageDoubleResult => {
    const { textByTestId = {}, attributesByTestId = {}, evaluateResult } = options;
    const requestedTestIds: string[] = [];
    const clickedTestIds: string[] = [];
    const filledValues: { readonly testId: string; readonly value: string }[] = [];
    const waitedTestIds: string[] = [];
    const nthSelections: { readonly testId: string; readonly index: number }[] = [];
    const attributeReads: { readonly testId: string; readonly name: string }[] = [];
    const evaluateState = { count: 0 };

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
            getAttribute: async (name: string): Promise<string | null> => {
                attributeReads.push({ testId, name });
                return attributesByTestId[testId]?.[name] ?? null;
            },
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
        evaluate: async (): Promise<unknown> => {
            evaluateState.count += 1;
            return evaluateResult;
        },
    };

    return {
        page: page as unknown as Page,
        requestedTestIds,
        clickedTestIds,
        filledValues,
        waitedTestIds,
        nthSelections,
        attributeReads,
        evaluateCount: (): number => evaluateState.count,
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
        expect(lobbyPage.lobbyScreen).toBeDefined();
        expect(lobbyPage.playerListItems).toBeDefined();
        expect(lobbyPage.connectionStatus).toBeDefined();
        expect(lobbyPage.addressInput).toBeDefined();
        expect(lobbyPage.confirmJoinButton).toBeDefined();
        expect(lobbyPage.leaveButton).toBeDefined();

        expect(requestedTestIds).toEqual([
            'host-lobby',
            'join-lobby',
            'tactics-ready-toggle',
            'start-game',
            'tactics-lobby-screen',
            'tactics-lobby-player',
            'connection-status',
            'address-input',
            'confirm-join',
            'lobby-leave-btn',
        ]);
    });

    it('reads the host-issued lobby code from the lobby bridge', async () => {
        const { page, evaluateCount } = buildPageDouble({
            evaluateResult: '127.0.0.1:54321:abc123',
        });
        const lobbyPage = new LobbyPage(page);

        await expect(lobbyPage.lobbyCode()).resolves.toBe('127.0.0.1:54321:abc123');
        expect(evaluateCount()).toBe(1);
    });

    it('throws when no hosted lobby code is available from the bridge', async () => {
        const { page } = buildPageDouble({ evaluateResult: null });
        const lobbyPage = new LobbyPage(page);

        await expect(lobbyPage.lobbyCode()).rejects.toThrow(
            'Lobby code is unavailable; no active hosted lobby was found.',
        );
    });

    it('reads the local player id from the lobby bridge', async () => {
        const { page, evaluateCount } = buildPageDouble({ evaluateResult: 'player-7' });
        const lobbyPage = new LobbyPage(page);

        await expect(lobbyPage.localPlayerId()).resolves.toBe('player-7');
        expect(evaluateCount()).toBe(1);
    });

    it('hosts a lobby and waits for the tactics lobby screen', async () => {
        const { page, clickedTestIds, waitedTestIds } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.hostLobby();

        expect(clickedTestIds).toEqual(['host-lobby']);
        expect(waitedTestIds).toEqual(['tactics-lobby-screen']);
    });

    it('joins a lobby and waits for the tactics lobby screen', async () => {
        const { page, clickedTestIds, filledValues, waitedTestIds } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.joinLobby('ws://localhost:7779');

        expect(clickedTestIds).toEqual(['join-lobby', 'confirm-join']);
        expect(filledValues).toEqual([{ testId: 'address-input', value: 'ws://localhost:7779' }]);
        expect(waitedTestIds).toEqual(['tactics-lobby-screen']);
    });

    it('toggles the local player ready state from the ready button', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.toggleReady();

        expect(clickedTestIds).toEqual(['tactics-ready-toggle']);
    });

    it('reads the data-ready attribute from the indexed roster row', async () => {
        const { page, waitedTestIds, nthSelections, attributeReads } = buildPageDouble({
            attributesByTestId: {
                'tactics-lobby-player': {
                    'data-ready': 'true',
                },
            },
        });
        const lobbyPage = new LobbyPage(page);

        await expect(lobbyPage.playerReadyStatus(1)).resolves.toBe('true');

        expect(nthSelections).toEqual([{ testId: 'tactics-lobby-player', index: 1 }]);
        expect(waitedTestIds).toEqual(['tactics-lobby-player']);
        expect(attributeReads).toEqual([{ testId: 'tactics-lobby-player', name: 'data-ready' }]);
    });

    it('waits for the nth roster row to become visible', async () => {
        const { page, waitedTestIds, nthSelections } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.waitForPlayerCount(3);

        expect(nthSelections).toEqual([{ testId: 'tactics-lobby-player', index: 2 }]);
        expect(waitedTestIds).toEqual(['tactics-lobby-player']);
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

    it('leaves a lobby by clicking the leave button then waiting for the pre-lobby screen', async () => {
        const { page, clickedTestIds, waitedTestIds } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.leaveLobby();

        expect(clickedTestIds).toEqual(['lobby-leave-btn']);
        expect(waitedTestIds).toEqual(['host-lobby']);
    });

    it('waitForPreLobbyScreen waits for the host-lobby button to become visible', async () => {
        const { page, waitedTestIds } = buildPageDouble();
        const lobbyPage = new LobbyPage(page);

        await lobbyPage.waitForPreLobbyScreen();

        expect(waitedTestIds).toEqual(['host-lobby']);
    });
});
