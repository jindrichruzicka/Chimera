import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { ComponentType } from 'react';
import type {
    GameMainMenuDefinition,
    GameFontFace,
    GameMenuCommandId,
    GameSettingsPageDefinition,
} from '@chimera/simulation/foundation/game-shell-contract.js';
import type { GameLobbyScreenProps } from '@chimera/simulation/foundation/game-lobby-contract.js';
import {
    _resetRendererGameRegistryForTest,
    getDefaultRendererGameId,
    getRendererGameMenuCommand,
    loadRendererGame,
    loadRendererGameShell,
    NoDefaultRendererGameError,
    registerRendererGame,
    type LoadedRendererGame,
    type LoadedRendererGameShell,
    type RendererGameContribution,
    UnknownRendererGameError,
} from './rendererGameRegistry';

const FAKE_BOARD: LoadedRendererGame['registry']['board'] = () => null;

function fakeGame(overrides?: Partial<LoadedRendererGame>): LoadedRendererGame {
    return {
        registry: { board: FAKE_BOARD },
        assetManifest: { gameId: 'fake', entries: [] },
        inputActions: [
            { id: 'game:fake-action', description: 'Fake', category: 'Test', oneShot: true },
        ],
        shell: { mainMenu: { buttons: [] } },
        ...overrides,
    };
}

function fakeShell(overrides?: Partial<LoadedRendererGameShell>): LoadedRendererGameShell {
    return {
        mainMenu: { buttons: [] },
        menuCommands: {},
        ...overrides,
    };
}

function registerFake(overrides?: Partial<RendererGameContribution>): void {
    const game = fakeGame();
    registerRendererGame({
        gameId: 'fake',
        loadGame: () => Promise.resolve(game),
        loadShell: () => Promise.resolve(game.shell ?? fakeShell()),
        isDefault: true,
        ...overrides,
    });
}

describe('rendererGameRegistry', () => {
    beforeEach(() => {
        _resetRendererGameRegistryForTest();
    });

    afterEach(() => {
        _resetRendererGameRegistryForTest();
    });

    it('loads a registered renderer game through the injection seam', async () => {
        registerFake();

        const game = await loadRendererGame('fake');

        expect(game.registry.board).toBeDefined();
        expect(game.assetManifest?.gameId).toBe('fake');
        expect(game.inputActions?.map((action) => action.id)).toContain('game:fake-action');
    });

    it('loads a registered renderer game shell through the injection seam', async () => {
        const shell = fakeShell({ shellBackground: () => null });
        registerRendererGame({
            gameId: 'fake',
            loadGame: () => Promise.resolve(fakeGame({ shell })),
            loadShell: () => Promise.resolve(shell),
            isDefault: true,
        });

        const loaded = await loadRendererGameShell('fake');

        expect(loaded.shellBackground).toBeDefined();
        expect(loaded.menuCommands).toEqual({});
    });

    it('rejects unknown game ids', async () => {
        registerFake();

        await expect(loadRendererGame('missing-game')).rejects.toThrow(UnknownRendererGameError);
    });

    it('rejects unknown game ids when loading a shell bundle', async () => {
        registerFake();

        await expect(loadRendererGameShell('missing-game')).rejects.toThrow(
            UnknownRendererGameError,
        );
    });

    it('rejects every game id before any game is registered', async () => {
        await expect(loadRendererGame('fake')).rejects.toThrow(UnknownRendererGameError);
        await expect(loadRendererGameShell('fake')).rejects.toThrow(UnknownRendererGameError);
    });

    describe('getDefaultRendererGameId', () => {
        it('returns the id of the contribution registered as default', () => {
            registerFake({ gameId: 'fake', isDefault: true });

            expect(getDefaultRendererGameId()).toBe('fake');
        });

        it('throws NoDefaultRendererGameError when no default is registered', () => {
            registerFake({ isDefault: false });

            expect(() => getDefaultRendererGameId()).toThrow(NoDefaultRendererGameError);
        });

        it('throws NoDefaultRendererGameError before any game is registered', () => {
            expect(() => getDefaultRendererGameId()).toThrow(NoDefaultRendererGameError);
        });
    });

    describe('LoadedRendererGame.shell type contract (#617)', () => {
        it('shell.mainMenu is typed as GameMainMenuDefinition | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['mainMenu']>().toEqualTypeOf<
                GameMainMenuDefinition | undefined
            >();
        });

        it('shell.menuCommands is typed as Partial<Record<GameMenuCommandId, () => void>> | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['menuCommands']>().toEqualTypeOf<
                Partial<Record<GameMenuCommandId, () => void>> | undefined
            >();
        });

        it('shell.settings is typed as GameSettingsPageDefinition | undefined (#626)', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['settings']>().toEqualTypeOf<
                GameSettingsPageDefinition | undefined
            >();
        });

        it('shell.shellBackground is typed as ComponentType | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['shellBackground']>().toEqualTypeOf<
                ComponentType | undefined
            >();
        });

        it('shell.fonts is typed as readonly GameFontFace[] | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['fonts']>().toEqualTypeOf<
                readonly GameFontFace[] | undefined
            >();
        });

        it('shell.LobbyScreen is typed as ComponentType<GameLobbyScreenProps> | undefined (#708)', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['LobbyScreen']>().toEqualTypeOf<
                ComponentType<GameLobbyScreenProps> | undefined
            >();
        });

        it('shell.menuCommands lookup is typed as (() => void) | undefined', () => {
            type Commands = NonNullable<NonNullable<LoadedRendererGame['shell']>['menuCommands']>;
            expectTypeOf<Commands[GameMenuCommandId]>().toEqualTypeOf<(() => void) | undefined>();
        });

        it('RendererGameContribution carries the loaders and an optional default flag', () => {
            expectTypeOf<RendererGameContribution['gameId']>().toEqualTypeOf<string>();
            expectTypeOf<RendererGameContribution['loadGame']>().toEqualTypeOf<
                () => Promise<LoadedRendererGame>
            >();
            expectTypeOf<RendererGameContribution['loadShell']>().toEqualTypeOf<
                () => Promise<LoadedRendererGameShell>
            >();
            expectTypeOf<RendererGameContribution['isDefault']>().toEqualTypeOf<
                boolean | undefined
            >();
        });
    });

    describe('getRendererGameMenuCommand', () => {
        it('returns undefined when shell is absent', () => {
            const game: LoadedRendererGame = { registry: { board: FAKE_BOARD } };
            const commandId = 'tactics:missing' as GameMenuCommandId;

            expect(getRendererGameMenuCommand(game, commandId)).toBeUndefined();
        });

        it('returns undefined when command id is not registered', () => {
            const game: LoadedRendererGame = {
                registry: { board: FAKE_BOARD },
                shell: {
                    menuCommands: {
                        ['tactics:play' as GameMenuCommandId]: () => undefined,
                    },
                },
            };
            const commandId = 'tactics:missing' as GameMenuCommandId;

            expect(getRendererGameMenuCommand(game, commandId)).toBeUndefined();
        });

        it('returns the registered command when present', () => {
            const execute = (): void => undefined;
            const commandId = 'tactics:play' as GameMenuCommandId;
            const game: LoadedRendererGame = {
                registry: { board: FAKE_BOARD },
                shell: {
                    menuCommands: {
                        [commandId]: execute,
                    },
                },
            };

            expect(getRendererGameMenuCommand(game, commandId)).toBe(execute);
        });
    });
});
