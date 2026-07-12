import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import type {
    GameMainMenuDefinition,
    GameFontFace,
    GameMenuCommandId,
    GameSettingsPageDefinition,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type { GameLobbyScreenProps } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type {
    GameCursorImage,
    GameCursorRole,
    GameLanguage,
} from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import type { TranslationBundle } from '../i18n/translation-bundle.js';
import {
    _resetRendererGameRegistryForTest,
    getDefaultRendererGameId,
    getRendererGameMenuCommand,
    loadRendererGame,
    loadRendererGameShell,
    NoDefaultRendererGameError,
    registerRendererGame,
    type GameTranslations,
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

    describe('shell.preloadImages warm-up', () => {
        class FakeImage {
            public src = '';
            public decode = vi.fn(async (): Promise<void> => undefined);

            public constructor() {
                constructedImages.push(this);
            }
        }
        const constructedImages: FakeImage[] = [];

        beforeEach(async () => {
            constructedImages.length = 0;
            vi.stubGlobal('Image', FakeImage);
            const { resetWarmedGameImagesForTests } = await import('./GameImageWarmup');
            resetWarmedGameImagesForTests();
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('loadRendererGameShell warms declared preload images before resolving', async () => {
            const shell = fakeShell({ preloadImages: ['fake/images/menu-hero.png'] });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
                isDefault: true,
            });

            await loadRendererGameShell('fake');

            expect(constructedImages.map((image) => image.src)).toEqual([
                'chimera://renderer/game-assets/fake/images/menu-hero.png',
            ]);
            expect(constructedImages[0]?.decode).toHaveBeenCalledTimes(1);
        });

        it('loadRendererGame warms declared preload images before resolving', async () => {
            const shell = fakeShell({ preloadImages: ['fake/images/menu-hero.png'] });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
                isDefault: true,
            });

            await loadRendererGame('fake');

            expect(constructedImages.map((image) => image.src)).toEqual([
                'chimera://renderer/game-assets/fake/images/menu-hero.png',
            ]);
        });

        it('a shell without preloadImages warms nothing', async () => {
            registerFake();

            await loadRendererGameShell('fake');

            expect(constructedImages).toHaveLength(0);
        });
    });

    describe('shell.cursor hardware-cursor override injection (#847)', () => {
        class FakeImage {
            public src = '';
            public decode = vi.fn(async (): Promise<void> => undefined);

            public constructor() {
                constructedImages.push(this);
            }
        }
        const constructedImages: FakeImage[] = [];
        const setProperty = vi.fn();

        beforeEach(async () => {
            constructedImages.length = 0;
            setProperty.mockClear();
            vi.stubGlobal('Image', FakeImage);
            vi.stubGlobal('document', { documentElement: { style: { setProperty } } });
            const { resetWarmedGameImagesForTests } = await import('./GameImageWarmup');
            resetWarmedGameImagesForTests();
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        function registerCursorShell(): void {
            const shell = fakeShell({
                cursor: {
                    default: { image: 'cursors/default.png' },
                    pointer: { image: 'cursors/pointer.png', hotspot: { x: 4, y: 7 } },
                },
            });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
                isDefault: true,
            });
        }

        it('loadRendererGameShell warms the textures and overrides the declared cursor tokens', async () => {
            registerCursorShell();

            await loadRendererGameShell('fake');

            expect(constructedImages.map((image) => image.src)).toEqual([
                'chimera://renderer/game-assets/fake/cursors/default.png',
                'chimera://renderer/game-assets/fake/cursors/pointer.png',
            ]);
            expect(setProperty).toHaveBeenCalledWith(
                '--ch-cursor-default',
                'url(chimera://renderer/game-assets/fake/cursors/default.png) 0 0, auto',
            );
            expect(setProperty).toHaveBeenCalledWith(
                '--ch-cursor-pointer',
                'url(chimera://renderer/game-assets/fake/cursors/pointer.png) 4 7, pointer',
            );
        });

        it('loadRendererGame injects the same overrides from game.shell', async () => {
            registerCursorShell();

            await loadRendererGame('fake');

            expect(setProperty).toHaveBeenCalledWith(
                '--ch-cursor-pointer',
                'url(chimera://renderer/game-assets/fake/cursors/pointer.png) 4 7, pointer',
            );
        });

        it('a shell without a cursor declaration writes no tokens', async () => {
            registerFake();

            await loadRendererGameShell('fake');

            expect(setProperty).not.toHaveBeenCalled();
        });
    });

    describe('shell.translations game-contribution seam (#866)', () => {
        const EN: GameLanguage = { code: 'en-US', label: 'English' };
        const CS: GameLanguage = { code: 'cs-CZ', label: 'Čeština' };
        const EN_BUNDLE: TranslationBundle = { 'engine.menu.play': 'Play' };
        const CS_BUNDLE: TranslationBundle = { 'engine.menu.play': 'Hrát' };

        function makeTranslations(overrides?: Partial<GameTranslations>): GameTranslations {
            return {
                languages: [EN, CS],
                bundles: { 'en-US': EN_BUNDLE, 'cs-CZ': CS_BUNDLE },
                ...overrides,
            };
        }

        let warnSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        function registerTranslationsShell(translations: GameTranslations): void {
            const shell = fakeShell({ translations });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
                isDefault: true,
            });
        }

        it('exposes the contributed translations on the loaded shell, unmodified', async () => {
            const translations = makeTranslations();
            registerTranslationsShell(translations);

            const loaded = await loadRendererGameShell('fake');

            expect(loaded.translations).toEqual(translations);
            // Passed through by reference — the registry never clones or merges.
            expect(loaded.translations).toBe(translations);
        });

        it('leaves translations undefined when the shell contributes none', async () => {
            registerFake();

            const loaded = await loadRendererGameShell('fake');

            expect(loaded.translations).toBeUndefined();
        });

        it('warns for a bundle locale with no matching declared language', async () => {
            registerTranslationsShell(
                makeTranslations({
                    languages: [EN],
                    bundles: { 'en-US': EN_BUNDLE, 'cs-CZ': CS_BUNDLE },
                }),
            );

            await loadRendererGameShell('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            const [message] = warnSpy.mock.calls[0] ?? [];
            expect(String(message)).toContain('cs-CZ');
        });

        it('does not warn when every bundle locale matches a declared language', async () => {
            registerTranslationsShell(makeTranslations());

            await loadRendererGameShell('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns and does not throw when the bundle map is not a plain object', async () => {
            registerTranslationsShell(
                makeTranslations({
                    // A code-authored typo could hand us a non-object; light validation
                    // must degrade to a dev warning, never crash the shell load.
                    bundles: null as unknown as GameTranslations['bundles'],
                }),
            );

            await expect(loadRendererGameShell('fake')).resolves.toBeDefined();
            expect(warnSpy).toHaveBeenCalledTimes(1);
        });

        it('warns and does not throw when languages is not an array', async () => {
            registerTranslationsShell(
                makeTranslations({
                    // Same code-authored cast escape hatch as the bundle-map guard:
                    // a non-array languages must degrade to a warning, not crash the
                    // shell load with a TypeError on .map — every bundle locale is
                    // then undeclared, so each warns.
                    languages: null as unknown as GameTranslations['languages'],
                    bundles: { 'en-US': EN_BUNDLE, 'cs-CZ': CS_BUNDLE },
                }),
            );

            await expect(loadRendererGameShell('fake')).resolves.toBeDefined();
            expect(warnSpy).toHaveBeenCalledTimes(2);
            const messages = warnSpy.mock.calls.map((call) => String(call[0]));
            expect(messages.some((message) => message.includes('en-US'))).toBe(true);
            expect(messages.some((message) => message.includes('cs-CZ'))).toBe(true);
        });

        it('warns for an undeclared locale when translations arrive via loadRendererGame', async () => {
            const shell = fakeShell({
                translations: makeTranslations({
                    languages: [EN],
                    bundles: { 'en-US': EN_BUNDLE, 'cs-CZ': CS_BUNDLE },
                }),
            });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
                isDefault: true,
            });

            await loadRendererGame('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            const [message] = warnSpy.mock.calls[0] ?? [];
            expect(String(message)).toContain('cs-CZ');
        });

        it('a shell without translations warns nothing', async () => {
            registerFake();

            await loadRendererGameShell('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });
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

        it('shell.preloadImages is typed as readonly string[] | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['preloadImages']>().toEqualTypeOf<
                readonly string[] | undefined
            >();
        });

        it('shell.fonts is typed as readonly GameFontFace[] | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['fonts']>().toEqualTypeOf<
                readonly GameFontFace[] | undefined
            >();
        });

        it('shell.cursor is typed as Partial<Record<GameCursorRole, GameCursorImage>> | undefined (#847)', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['cursor']>().toEqualTypeOf<
                Partial<Record<GameCursorRole, GameCursorImage>> | undefined
            >();
        });

        it('shell.LobbyScreen is typed as ComponentType<GameLobbyScreenProps> | undefined (#708)', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['LobbyScreen']>().toEqualTypeOf<
                ComponentType<GameLobbyScreenProps> | undefined
            >();
        });

        it('shell.translations is typed as GameTranslations | undefined (#866)', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['translations']>().toEqualTypeOf<
                GameTranslations | undefined
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
