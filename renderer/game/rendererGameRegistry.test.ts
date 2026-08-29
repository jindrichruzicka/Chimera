import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createElement, type ComponentType } from 'react';
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
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import type { GameIconSet } from '../components/ui/icons/registry.js';
import type { InputAction } from '../input/InputAction.js';
import type { TranslationBundle } from '../i18n/translation-bundle.js';
import { CRITICAL_ASSET_PRELOAD_BUDGET_MS } from '../assets/criticalAssetPreload.js';
import { SCENE_PRELOAD_BUDGET_MS } from '../components/scene/scenePreload.js';
import {
    _resetRendererGameRegistryForTest,
    GAME_SHELL_WARMUP_BUDGET_MS,
    getRendererGameMenuCommand,
    loadRendererGame,
    loadRendererGameShell,
    registerRendererGame,
    type GameShellMusicBed,
    type GameTranslations,
    type LoadedRendererGame,
    type LoadedRendererGameShell,
    type RendererGameContribution,
    UnknownRendererGameError,
} from './rendererGameRegistry';
import * as registryModule from './rendererGameRegistry';

const FAKE_PLAYFIELD: LoadedRendererGame['registry']['playfield'] = () => null;

function fakeGame(overrides?: Partial<LoadedRendererGame>): LoadedRendererGame {
    return {
        registry: { playfield: FAKE_PLAYFIELD },
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

        expect(game.registry.playfield).toBeDefined();
        expect(game.assetManifest?.gameId).toBe('fake');
        expect(game.inputActions?.map((action) => action.id)).toContain('game:fake-action');
    });

    it('loads a registered renderer game shell through the injection seam', async () => {
        const shell = fakeShell({ shellBackground: () => null });
        registerRendererGame({
            gameId: 'fake',
            loadGame: () => Promise.resolve(fakeGame({ shell })),
            loadShell: () => Promise.resolve(shell),
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

    describe('shell.cursor hardware-cursor override injection', () => {
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

    // ── the warm-up budget ────────────────────────────────────────────────────
    //
    // Both loaders await a shell's fonts, preload images and cursor textures
    // before resolving, and each of those is a `chimera://` fetch. A fetch that
    // is answered — with bytes or with a 404 — settles, and the load either
    // proceeds or rejects into the crash fallback. A fetch that is never
    // answered settles neither way, and before this budget existed it held
    // `loadRendererGame` open with no ceiling: `/game` renders nothing until the
    // load resolves, so the player sat on the black screen the lobby→game fade
    // left behind, past both preload budgets, forever.
    describe('shell warm-up budget', () => {
        /** A texture whose decode never settles — the wedge, in one class. */
        class StalledImage {
            public src = '';
            public readonly decode = vi.fn((): Promise<void> => new Promise<void>(() => undefined));

            public constructor() {
                constructedImages.push(this);
            }
        }
        /** A texture that decodes at once, for the healthy-path cases. */
        class WarmImage {
            public src = '';
            public readonly decode = vi.fn(async (): Promise<void> => undefined);

            public constructor() {
                constructedImages.push(this);
            }
        }
        /** A face whose load never settles — the same wedge, one step earlier. */
        class StalledFontFace {
            public readonly load = vi.fn(
                (): Promise<unknown> => new Promise<unknown>(() => undefined),
            );
        }

        const constructedImages: (StalledImage | WarmImage)[] = [];
        const emitted: Record<string, unknown>[] = [];

        const preloadImageShell = (): LoadedRendererGameShell =>
            fakeShell({ preloadImages: ['fake/images/menu-hero.png'] });

        function registerShell(shell: LoadedRendererGameShell): void {
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
            });
        }

        beforeEach(async () => {
            vi.useFakeTimers();
            constructedImages.length = 0;
            emitted.length = 0;
            vi.stubGlobal('Image', StalledImage);
            vi.stubGlobal('FontFace', StalledFontFace);
            vi.stubGlobal('document', {
                documentElement: { style: { setProperty: vi.fn() } },
                fonts: { add: vi.fn() },
            });
            (globalThis as Record<string, unknown>)['__chimera'] = {
                logs: {
                    emit: (entry: Record<string, unknown>) => {
                        emitted.push(entry);
                    },
                },
            };
            const { resetWarmedGameImagesForTests } = await import('./GameImageWarmup');
            const { resetLoadedGameFontsForTests } = await import('./GameFontLoader');
            resetWarmedGameImagesForTests();
            resetLoadedGameFontsForTests();
        });

        afterEach(() => {
            delete (globalThis as Record<string, unknown>)['__chimera'];
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            vi.useRealTimers();
        });

        it('is five seconds', () => {
            expect(GAME_SHELL_WARMUP_BUDGET_MS).toBe(5_000);
        });

        it('composes with the route-entry gate under the deadline the game e2e allows the canvas', () => {
            // `/game` awaits this budget and THEN `useCriticalAssetPreloadGate`'s,
            // so the two add up on a maximally unlucky entry. The e2e allows the
            // canvas 15 s (`CANVAS_TIMEOUT_MS`, apps/tactics/e2e/tests/
            // in-game-menu-leave.spec.ts). A sum equal to that consumes the whole
            // allowance on exactly the path these fail-opens exist to rescue, and
            // CI runners are an order of magnitude slower than a developer
            // machine. Asserted here so a future bump to either budget reds in
            // this file rather than as an e2e flake.
            const GAME_CANVAS_TIMEOUT_MS = 15_000;

            expect(GAME_SHELL_WARMUP_BUDGET_MS + CRITICAL_ASSET_PRELOAD_BUDGET_MS).toBeLessThan(
                GAME_CANVAS_TIMEOUT_MS,
            );
        });

        it('resolves loadRendererGame when a declared warm-up never settles', async () => {
            registerShell(preloadImageShell());

            const load = loadRendererGame('fake');
            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS);

            await expect(load).resolves.toMatchObject({ registry: { playfield: FAKE_PLAYFIELD } });
            // The wedge was entered rather than skipped: the budget is what
            // released the load, not a warm-up that never ran.
            expect(constructedImages[0]?.decode).toHaveBeenCalledTimes(1);
        });

        it('holds the load for the whole budget before failing open', async () => {
            registerShell(preloadImageShell());
            let resolved = false;
            const load = loadRendererGame('fake').then(() => {
                resolved = true;
            });

            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS - 1);
            expect(resolved).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            await load;
            expect(resolved).toBe(true);
        });

        it('releases loadRendererGameShell on the same budget', async () => {
            // The shell loader is the one /main-menu, /lobby and /settings await,
            // and it runs the identical warm-up. A budget on only the game loader
            // would leave those three routes wedgeable.
            registerShell(preloadImageShell());

            const load = loadRendererGameShell('fake');
            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS);

            await expect(load).resolves.toMatchObject({ mainMenu: { buttons: [] } });
        });

        it('reports once, naming the game id and every step the wedge left undone', async () => {
            // The steps run in sequence, so a wedged FIRST step also stops the two
            // behind it from starting. A report naming only the step in flight
            // would understate what did not load by two thirds.
            registerShell(
                fakeShell({
                    fonts: [{ family: 'Fake', src: 'fake/fonts/fake.woff2' }],
                    preloadImages: ['fake/images/menu-hero.png'],
                    cursor: { default: { image: 'cursors/default.png' } },
                }),
            );

            const load = loadRendererGame('fake');
            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS * 3);
            await load;

            expect(emitted).toHaveLength(1);
            expect(emitted[0]).toMatchObject({
                level: 'warn',
                message:
                    '[assets] game shell warm-up exceeded its budget; loading the game without it',
                source: { process: 'renderer', module: 'game-registry' },
                context: {
                    gameId: 'fake',
                    budgetMs: GAME_SHELL_WARMUP_BUDGET_MS,
                    pending: ['fonts', 'preloadImages', 'cursor'],
                },
            });
        });

        it('names only the steps still outstanding when an earlier one finished', async () => {
            // The fonts step completes, the images step wedges: the report must
            // drop the finished one rather than list the whole declaration. The
            // twin above covers the other direction — a report naming only the
            // step in flight would drop the two it never let start.
            class WarmFontFace {
                public readonly load = vi.fn(async (): Promise<unknown> => ({}));
            }
            vi.stubGlobal('FontFace', WarmFontFace);
            registerShell(
                fakeShell({
                    fonts: [{ family: 'Fake', src: 'fake/fonts/fake.woff2' }],
                    preloadImages: ['fake/images/menu-hero.png'],
                }),
            );

            const load = loadRendererGame('fake');
            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS);
            await load;

            expect(emitted[0]).toMatchObject({ context: { pending: ['preloadImages'] } });
        });

        it('does not collapse under NEXT_PUBLIC_CHIMERA_E2E', async () => {
            // Invariant #133's clause, for the same reason it gives: the e2e build
            // is where a never-releasing wait is observable, so a budget that
            // shrank or vanished there would make its own spec pass vacuously.
            // What is measured is the boundary itself under the flag set.
            vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
            registerShell(preloadImageShell());
            let resolved = false;
            const load = loadRendererGame('fake').then(() => {
                resolved = true;
            });

            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS - 1);
            expect(resolved).toBe(false);
            expect(emitted).toHaveLength(0);

            await vi.advanceTimersByTimeAsync(1);
            await load;
            expect(resolved).toBe(true);
            expect(emitted).toHaveLength(1);
        });

        it('arms no budget for a shell with nothing to warm', async () => {
            // A shell declaring no fonts, images or cursor costs what it cost
            // before this budget existed. Asserted on the ARMING rather than on
            // a timer count after the load: an empty step list settles in
            // microtasks, so a budget armed and cleared inside the same load
            // leaves a count of zero behind it either way.
            const armed = vi.spyOn(globalThis, 'setTimeout');
            registerFake();

            await loadRendererGameShell('fake');

            expect(armed).not.toHaveBeenCalled();
            expect(emitted).toHaveLength(0);
        });

        it('gives each concurrent load its own budget', async () => {
            // Overlapping shell loads are the ordinary case, not an edge one:
            // /main-menu alone drives several `loadRendererGameShell` calls at
            // once. Each run owns its own timer handle, so one run settling can
            // never disarm another's budget and strand it unreleased. Two games
            // with DISTINCT refs, because a shared ref is deduplicated by the
            // warm-up's own cache and the second run would settle at once.
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame()),
                loadShell: () =>
                    Promise.resolve(fakeShell({ preloadImages: ['fake/images/one.png'] })),
            });
            registerRendererGame({
                gameId: 'other',
                loadGame: () => Promise.resolve(fakeGame()),
                loadShell: () =>
                    Promise.resolve(fakeShell({ preloadImages: ['other/images/two.png'] })),
            });

            const first = loadRendererGameShell('fake');
            const second = loadRendererGameShell('other');
            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS);

            await expect(first).resolves.toBeDefined();
            await expect(second).resolves.toBeDefined();
            expect(
                emitted.map((entry) => (entry['context'] as { gameId: string }).gameId).sort(),
            ).toEqual(['fake', 'other']);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('loads a game that contributes no shell at all', async () => {
            // The shape the blank scaffold ships: `loadGame` returns a registry
            // and no `shell` key at all. The warm-up must be skipped on that
            // path, never entered with nothing to read.
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve({ registry: { playfield: FAKE_PLAYFIELD } }),
                loadShell: () => Promise.resolve(fakeShell()),
            });
            const armed = vi.spyOn(globalThis, 'setTimeout');

            await expect(loadRendererGame('fake')).resolves.toMatchObject({
                registry: { playfield: FAKE_PLAYFIELD },
            });
            expect(armed).not.toHaveBeenCalled();
            expect(emitted).toHaveLength(0);
        });

        it('runs the warm-up ahead of the dev-time guards, so a rejecting one costs them', async () => {
            // The order both loaders have always run: the asset work first, the
            // two synchronous guards after it. A warm-up that rejects therefore
            // reaches neither guard — measured here rather than left to a
            // comment, because the two orders differ only in what gets warned.
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            registerShell(
                fakeShell({
                    cursor: { default: { image: '/absolute/default.png' } },
                    translations: { languages: [], bundles: { 'xx-XX': {} } },
                }),
            );

            await expect(loadRendererGame('fake')).rejects.toThrow(
                'Game cursor source must be a local game asset ref',
            );

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('clears the budget and reports nothing when the warm-up settles in time', async () => {
            vi.stubGlobal('Image', WarmImage);
            registerShell(preloadImageShell());

            await loadRendererGame('fake');

            expect(constructedImages[0]?.decode).toHaveBeenCalledTimes(1);
            expect(emitted).toHaveLength(0);
            // The budget timer is cleared on the healthy path, not left to fire
            // its warning into a load that already resolved.
            expect(vi.getTimerCount()).toBe(0);
        });

        it('still rejects when a warm-up step fails inside the budget', async () => {
            // A rejection is a SETTLED outcome and already reaches the player as
            // the crash fallback. The budget bounds the wedge; it must not
            // turn a broken declaration into a silent fail-open.
            registerShell(fakeShell({ cursor: { default: { image: '/absolute/default.png' } } }));

            await expect(loadRendererGame('fake')).rejects.toThrow(
                'Game cursor source must be a local game asset ref',
            );
            expect(emitted).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('adds no second report when a step fails after the budget already failed open', async () => {
            // The budget releases the load, and only then does the outstanding
            // fetch come back a failure. Nothing may re-open that: the report has
            // been made and names the step, and a second entry would double-count
            // one broken declaration.
            let rejectFont: (error: Error) => void = () => undefined;
            class DeferredFontFace {
                public readonly load = vi.fn(
                    (): Promise<unknown> =>
                        new Promise<unknown>((_resolve, reject) => {
                            rejectFont = reject;
                        }),
                );
            }
            vi.stubGlobal('FontFace', DeferredFontFace);
            registerShell(fakeShell({ fonts: [{ family: 'Fake', src: 'fake/fonts/fake.woff2' }] }));

            const load = loadRendererGame('fake');
            await vi.advanceTimersByTimeAsync(GAME_SHELL_WARMUP_BUDGET_MS);
            await expect(load).resolves.toMatchObject({ registry: { playfield: FAKE_PLAYFIELD } });

            rejectFont(new Error('font fetch aborted'));
            await vi.advanceTimersByTimeAsync(0);

            expect(emitted).toHaveLength(1);
            expect(emitted[0]).toMatchObject({ context: { pending: ['fonts'] } });
        });
    });

    describe('shell.translations game-contribution seam', () => {
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
            // The id this guard attributes the bundle to reaches it as a
            // parameter, so a stale locale can only be reported under the game
            // that actually contributed it.
            expect(String(message)).toContain("game 'fake'");
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
            });

            await loadRendererGame('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            const [message] = warnSpy.mock.calls[0] ?? [];
            expect(String(message)).toContain('cs-CZ');
            expect(String(message)).toContain("game 'fake'");
        });

        it('a shell without translations warns nothing', async () => {
            registerFake();

            await loadRendererGameShell('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    describe('shell.icons game-contribution seam (#113)', () => {
        const goodGlyph: GameIconSet[string] = {
            viewBox: '0 0 24 24',
            content: createElement('path', { d: 'M0 0h24v24H0z' }),
        };

        let warnSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        function registerIconsShell(icons: GameIconSet): void {
            const shell = fakeShell({ icons });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
            });
        }

        it('exposes the contributed icons on the loaded shell, unmodified', async () => {
            const icons: GameIconSet = { 'game.fake.banner': goodGlyph };
            registerIconsShell(icons);

            const loaded = await loadRendererGameShell('fake');

            // Passed through by reference — the registry never clones or merges.
            expect(loaded.icons).toBe(icons);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('leaves icons undefined when the shell contributes none', async () => {
            registerFake();

            const loaded = await loadRendererGameShell('fake');

            expect(loaded.icons).toBeUndefined();
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns and still loads when a glyph is malformed (missing viewBox)', async () => {
            registerIconsShell({
                'game.fake.bad': { content: createElement('path') },
            } as unknown as GameIconSet);

            await expect(loadRendererGameShell('fake')).resolves.toBeDefined();

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain('game.fake.bad');
            // The glyph name above is the set's own key; this is the id the
            // guard was handed, which is the part the extraction re-threaded.
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain("game 'fake'");
        });

        it('warns and does not throw when the icons set is not a plain object', async () => {
            registerIconsShell(null as unknown as GameIconSet);

            await expect(loadRendererGameShell('fake')).resolves.toBeDefined();
            expect(warnSpy).toHaveBeenCalledTimes(1);
        });

        it('warns for a malformed glyph when icons arrive via loadRendererGame', async () => {
            const shell = fakeShell({
                icons: {
                    'game.fake.bad': { viewBox: '', content: createElement('path') },
                } as unknown as GameIconSet,
            });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(fakeGame({ shell })),
                loadShell: () => Promise.resolve(shell),
            });

            await loadRendererGame('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
        });

        it('a shell without icons warns nothing', async () => {
            registerFake();

            await loadRendererGameShell('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    describe('registry.loadingScreens key validation (§4.36)', () => {
        let warnSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        function registerLoadingScreens(
            loadingScreens: NonNullable<LoadedRendererGame['registry']['loadingScreens']>,
            screens?: LoadedRendererGame['registry']['screens'],
        ): void {
            const game = fakeGame({
                registry: {
                    playfield: FAKE_PLAYFIELD,
                    loadingScreens,
                    ...(screens === undefined ? {} : { screens }),
                },
            });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(game),
                loadShell: () => Promise.resolve(game.shell ?? fakeShell()),
            });
        }

        it('warns once, naming the key, for a cover that names no known screen', async () => {
            registerLoadingScreens({ 'tech-tree': 'spinner' });

            await loadRendererGame('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain('tech-tree');
        });

        it('still loads the game — a stale key mid-refactor is a warning, never a throw', async () => {
            registerLoadingScreens({ 'tech-tree': 'spinner' });

            await expect(loadRendererGame('fake')).resolves.toBeDefined();
        });

        it("accepts 'playfield', the always-present slot, without warning", async () => {
            registerLoadingScreens({ playfield: 'spinner' });

            await loadRendererGame('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('accepts a key naming a registered screen without warning', async () => {
            registerLoadingScreens({ 'tech-tree': 'spinner' }, { 'tech-tree': FAKE_PLAYFIELD });

            await loadRendererGame('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns for each unknown key and stays silent about the known ones', async () => {
            registerLoadingScreens(
                { playfield: 'spinner', 'tech-tree': 'spinner', summary: 'progress' },
                { 'tech-tree': FAKE_PLAYFIELD },
            );

            await loadRendererGame('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain('summary');
        });

        it('warns nothing when the registry declares no per-key covers', async () => {
            registerFake();

            await loadRendererGame('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns and does not throw when loadingScreens is not a plain object', async () => {
            // Same code-authored cast escape hatch the sibling translations and
            // icons guards defend: Object.keys(null) would throw and cost the game.
            registerLoadingScreens(
                null as unknown as NonNullable<LoadedRendererGame['registry']['loadingScreens']>,
            );

            await expect(loadRendererGame('fake')).resolves.toBeDefined();
            expect(warnSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('registry.loadingScreenMinVisibleMs validation (§4.36)', () => {
        let warnSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        function registerMinimum(loadingScreenMinVisibleMs: number): void {
            const game = fakeGame({
                registry: { playfield: FAKE_PLAYFIELD, loadingScreenMinVisibleMs },
            });
            registerRendererGame({
                gameId: 'fake',
                loadGame: () => Promise.resolve(game),
                loadShell: () => Promise.resolve(game.shell ?? fakeShell()),
            });
        }

        it('warns once, naming the field, for a negative minimum — and still loads', async () => {
            registerMinimum(-250);

            await expect(loadRendererGame('fake')).resolves.toBeDefined();

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain('loadingScreenMinVisibleMs');
        });

        it('tells the author what an invalid minimum actually resolves to', async () => {
            // An invalid declaration falls back to the engine default, and the
            // warn has to say so: one that misreports the outcome sends the
            // author looking for a cover that is on screen the whole time.
            //
            // Asserted on the OUTCOME the author acts on, not on the whole
            // sentence: pinning the prose verbatim makes every rewording a
            // failing test without making any of them a wrong one. The opt-down
            // is named too, because it is the only way to ask for no floor and
            // an author reading this warn is looking for exactly that.
            registerMinimum(-250);

            await loadRendererGame('fake');

            const message = String(warnSpy.mock.calls[0]?.[0]);
            expect(message).toContain('engine default');
            expect(message).toContain('Declare 0');
            expect(message).not.toContain('as 0');
        });

        it('warns once for a NaN minimum', async () => {
            registerMinimum(Number.NaN);

            await loadRendererGame('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain('loadingScreenMinVisibleMs');
        });

        it('warns once for an Infinity minimum, as invalid rather than merely over budget', async () => {
            registerMinimum(Number.POSITIVE_INFINITY);

            await loadRendererGame('fake');

            // The invalid-value warn, not the over-budget one: dropping the
            // finiteness conjunct would send Infinity down the budget branch.
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain('finite');
            expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('budget');
        });

        it('warns once for a minimum above SCENE_PRELOAD_BUDGET_MS and honors it unclamped', async () => {
            registerMinimum(SCENE_PRELOAD_BUDGET_MS + 1);

            const game = await loadRendererGame('fake');

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0]?.[0])).toContain('budget');
            expect(game.registry.loadingScreenMinVisibleMs).toBe(SCENE_PRELOAD_BUDGET_MS + 1);
        });

        it('does not warn at exactly SCENE_PRELOAD_BUDGET_MS — only above the budget', async () => {
            registerMinimum(SCENE_PRELOAD_BUDGET_MS);

            await loadRendererGame('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('does not warn for a positive in-budget minimum', async () => {
            registerMinimum(400);

            const game = await loadRendererGame('fake');

            expect(warnSpy).not.toHaveBeenCalled();
            expect(game.registry.loadingScreenMinVisibleMs).toBe(400);
        });

        it("does not warn for zero — the explicit today's-behaviour value", async () => {
            registerMinimum(0);

            await loadRendererGame('fake');

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns nothing when the registry declares no minimum', async () => {
            registerFake();

            await loadRendererGame('fake');

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

    it('exposes no way to ask the registry which game to use', () => {
        // The engine names and derives no game: every lookup takes an explicit
        // gameId supplied from outside (the URL). A "which game am I?" query
        // would reintroduce an implied default — the seam this registry removed.
        registerFake({ gameId: 'fake' });

        const registryApi = Object.keys(registryModule);

        expect(registryApi).not.toContain('getRegisteredRendererGameId');
        expect(registryApi).not.toContain('getDefaultRendererGameId');
    });

    describe('LoadedRendererGame.shell type contract', () => {
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

        it('shell.settings is typed as GameSettingsPageDefinition | undefined', () => {
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

        it('shell.shellBackgroundAssets is typed as AssetManifest | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['shellBackgroundAssets']>().toEqualTypeOf<
                AssetManifest | undefined
            >();
        });

        it('shell.shellAudioAssets is typed as AssetManifest | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['shellAudioAssets']>().toEqualTypeOf<
                AssetManifest | undefined
            >();
        });

        it('shell.shellMusicBed is typed as GameShellMusicBed | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['shellMusicBed']>().toEqualTypeOf<
                GameShellMusicBed | undefined
            >();
        });

        it('a music bed names an audio clip ref and nothing else is required', () => {
            // The bed is DECLARATION, not a call: `ref` alone is a complete one, and
            // both knobs beside it stay optional so a game that just wants a menu
            // loop writes one field.
            expectTypeOf<GameShellMusicBed['ref']>().toEqualTypeOf<AssetRef<AudioClipAsset>>();
            expectTypeOf<GameShellMusicBed['volume']>().toEqualTypeOf<number | undefined>();
            expectTypeOf<GameShellMusicBed['fadeInMs']>().toEqualTypeOf<number | undefined>();
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

        it('shell.cursor is typed as Partial<Record<GameCursorRole, GameCursorImage>> | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['cursor']>().toEqualTypeOf<
                Partial<Record<GameCursorRole, GameCursorImage>> | undefined
            >();
        });

        it('shell.LobbyScreen is typed as ComponentType<GameLobbyScreenProps> | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['LobbyScreen']>().toEqualTypeOf<
                ComponentType<GameLobbyScreenProps> | undefined
            >();
        });

        it('shell.translations is typed as GameTranslations | undefined', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['translations']>().toEqualTypeOf<
                GameTranslations | undefined
            >();
        });

        it('shell.icons is typed as GameIconSet | undefined (#113)', () => {
            type ShellShape = NonNullable<LoadedRendererGame['shell']>;
            expectTypeOf<ShellShape['icons']>().toEqualTypeOf<GameIconSet | undefined>();
        });

        it('shell.menuCommands lookup is typed as (() => void) | undefined', () => {
            type Commands = NonNullable<NonNullable<LoadedRendererGame['shell']>['menuCommands']>;
            expectTypeOf<Commands[GameMenuCommandId]>().toEqualTypeOf<(() => void) | undefined>();
        });

        it('RendererGameContribution carries the id and the two loaders', () => {
            expectTypeOf<RendererGameContribution['gameId']>().toEqualTypeOf<string>();
            expectTypeOf<RendererGameContribution['loadGame']>().toEqualTypeOf<
                () => Promise<LoadedRendererGame>
            >();
            expectTypeOf<RendererGameContribution['loadShell']>().toEqualTypeOf<
                () => Promise<LoadedRendererGameShell>
            >();
            expectTypeOf<keyof RendererGameContribution>().toEqualTypeOf<
                'gameId' | 'loadGame' | 'loadShell'
            >();
        });
    });

    describe('getRendererGameMenuCommand', () => {
        it('returns undefined when shell is absent', () => {
            const game: LoadedRendererGame = { registry: { playfield: FAKE_PLAYFIELD } };
            const commandId = 'tactics:missing' as GameMenuCommandId;

            expect(getRendererGameMenuCommand(game, commandId)).toBeUndefined();
        });

        it('returns undefined when command id is not registered', () => {
            const game: LoadedRendererGame = {
                registry: { playfield: FAKE_PLAYFIELD },
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
                registry: { playfield: FAKE_PLAYFIELD },
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

describe('shell.inputActions carriage', () => {
    const SHELL_ACTION: InputAction = {
        id: 'game:select',
        description: 'Select',
        category: 'Game',
        oneShot: true,
    };

    it('exposes the declared input actions on the loaded shell, by reference', async () => {
        const inputActions = [SHELL_ACTION];
        const shell = fakeShell({ inputActions });
        registerRendererGame({
            gameId: 'fake',
            loadGame: () => Promise.resolve(fakeGame({ shell })),
            loadShell: () => Promise.resolve(shell),
        });

        const loaded = await loadRendererGameShell('fake');

        // By reference: the registry never clones the table, so the app-boot
        // registrar and `GameShell` can be handed the SAME objects and the
        // identity assert on a re-register is trivially satisfied.
        expect(loaded.inputActions).toBe(inputActions);
    });

    it('leaves inputActions undefined when the shell declares none', async () => {
        registerFake();

        const loaded = await loadRendererGameShell('fake');

        expect(loaded.inputActions).toBeUndefined();
    });

    it('carries the actions through a full game load that reuses its own shell', async () => {
        const inputActions = [SHELL_ACTION];
        const shell = fakeShell({ inputActions });
        registerRendererGame({
            gameId: 'fake',
            loadGame: () => Promise.resolve(fakeGame({ shell, inputActions })),
            loadShell: () => Promise.resolve(shell),
        });

        const game = await loadRendererGame('fake');

        expect(game.shell?.inputActions).toBe(game.inputActions);
    });
});

describe('shell.shellBackgroundInteractive carriage', () => {
    it('exposes the declared opt-in on the loaded shell', async () => {
        const shell = fakeShell({ shellBackgroundInteractive: true });
        registerRendererGame({
            gameId: 'fake',
            loadGame: () => Promise.resolve(fakeGame({ shell })),
            loadShell: () => Promise.resolve(shell),
        });

        const loaded = await loadRendererGameShell('fake');

        expect(loaded.shellBackgroundInteractive).toBe(true);
    });

    // Absent is the inert-decor default every game that never mentions it stays
    // on. `undefined` rather than `false`, so the host's own `=== true` gate is
    // what turns interaction on and nothing here can turn it on by accident.
    it('leaves the opt-in undefined when the shell declares none', async () => {
        registerFake();

        const loaded = await loadRendererGameShell('fake');

        expect(loaded.shellBackgroundInteractive).toBeUndefined();
    });
});
