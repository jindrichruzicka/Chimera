import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
    GameMainMenuDefinition,
    GameMenuCommandId,
} from '@chimera/shared/game-shell-contract.js';
import {
    getRendererGameMenuCommand,
    loadRendererGame,
    type LoadedRendererGame,
    UnknownRendererGameError,
} from './rendererGameRegistry';

describe('rendererGameRegistry', () => {
    it('loads the registered tactics renderer bundle', async () => {
        const game = await loadRendererGame('tactics');

        expect(game.registry.board).toBeDefined();
        expect(game.assetManifest?.gameId).toBe('tactics');
        expect(game.inputActions?.map((action) => action.id)).toContain('game:end-turn');
    });

    it('rejects unknown game ids', async () => {
        await expect(loadRendererGame('missing-game')).rejects.toThrow(UnknownRendererGameError);
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

        it('shell.menuCommands lookup is typed as (() => void) | undefined', () => {
            type Commands = NonNullable<NonNullable<LoadedRendererGame['shell']>['menuCommands']>;
            expectTypeOf<Commands[GameMenuCommandId]>().toEqualTypeOf<(() => void) | undefined>();
        });

        it('tactics loader leaves shell absent until T51.5', async () => {
            const game = await loadRendererGame('tactics');
            expect(game.shell).toBeUndefined();
        });
    });

    describe('getRendererGameMenuCommand', () => {
        it('returns undefined when shell is absent', async () => {
            const game = await loadRendererGame('tactics');
            const commandId = 'tactics:missing' as GameMenuCommandId;

            expect(getRendererGameMenuCommand(game, commandId)).toBeUndefined();
        });

        it('returns undefined when command id is not registered', () => {
            const game: LoadedRendererGame = {
                registry: { board: () => null },
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
                registry: { board: () => null },
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
