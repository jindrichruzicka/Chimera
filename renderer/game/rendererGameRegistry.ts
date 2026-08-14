import { isValidElement, type ComponentType } from 'react';
import type { GameLobbyScreenProps } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type {
    GameFontFace,
    GameMainMenuDefinition,
    GameMenuCommandId,
    GameSettingsPageDefinition,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type {
    GameCursorImage,
    GameCursorRole,
    GameLanguage,
} from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { GameIconSet } from '../components/ui/icons/registry.js';
import type { TranslationBundle } from '../i18n/translation-bundle.js';
import type { InputAction } from '../input/InputAction.js';
import { emitRendererWarning, readRendererLogsApi } from '../logging/rendererLogger.js';
import { loadGameFonts } from './GameFontLoader';
import { warmGameImages } from './GameImageWarmup';
import { applyGameCursorOverrides } from './gameCursorStyles';

/**
 * A game's contributed UI translations, forwarded verbatim through the renderer
 * shell registration. This is the boundary-safe path for a game's per-locale
 * bundles to reach the {@link I18nProvider}: no `renderer/` → `apps/*`
 * static import (Invariants #80/#94) — the data enters only as registration
 * payload, exactly like {@link LoadedRendererGameShell.cursor}.
 *
 * `languages` mirrors the game's declared, resolved `GameManifest.languages`
 * (see `resolveGameLanguages`), carried alongside the bundles so the registry
 * loader can dev-warn on a bundle locale that matches no declared language (a
 * typo guard). `bundles` are per-locale flat token maps that may re-key engine
 * tokens (override) and/or add game-namespaced tokens; the provider's fallback
 * chain (game override → engine default → raw key) does the rest.
 */
export interface GameTranslations {
    /** The game's declared UI languages (resolved), for locale cross-checking. */
    readonly languages: readonly GameLanguage[];
    /** locale code (BCP-47) → flat token bundle. */
    readonly bundles: Readonly<Record<string, TranslationBundle>>;
}

export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
    readonly settings?: GameSettingsPageDefinition;
    readonly shellBackground?: ComponentType;
    /**
     * Optional game-provided lobby screen. When present, the lobby page renders
     * it in place of the engine-default `ActiveLobbyPanel`, passing the
     * {@link GameLobbyScreenProps} contract. Loaded via this registry only — the
     * lobby page never imports `apps/*` directly (Invariant #94).
     */
    readonly LobbyScreen?: ComponentType<GameLobbyScreenProps>;
    readonly fonts?: readonly GameFontFace[];
    /**
     * Optional shell images to warm when the game (shell) loads — local game
     * asset refs (`<gameId>/<relativePath>`), the same form as font `src`.
     * Each is fetched and decoded during the load, so shell screens (main menu
     * heroes, backgrounds) paint them in a single frame instead of streaming
     * them in progressively. Warm-up is best-effort: a broken ref warns and
     * never blocks the shell, and the wait is capped by
     * {@link GAME_SHELL_WARMUP_BUDGET_MS}.
     */
    readonly preloadImages?: readonly string[];
    /**
     * Optional hardware-cursor declaration — the game's `GameManifest.cursor`
     * field, forwarded verbatim (game-asset-relative image paths + optional
     * hotspots). When the game (shell) loads, each texture is resolved through
     * the game-asset protocol, pre-decoded via the image warm-up seam, and
     * injected over the engine's `--ch-cursor-<role>` tokens (Invariant #93).
     * Absent ⇒ the tokens are left untouched. Explicit `undefined` is admitted
     * so a game can forward `manifest.cursor` verbatim whether or not the
     * manifest declares one.
     */
    readonly cursor?: Partial<Record<GameCursorRole, GameCursorImage>> | undefined;
    /**
     * Optional game-contributed UI translation bundles (see {@link GameTranslations}).
     * The app root feeds the active-locale bundle into `<I18nProvider>` as the
     * `gameOverride` layer through this registry seam (wiring lives with the
     * provider-mount task). Absent ⇒ the provider gets no override layer ⇒
     * engine English only (the single-language path). Passed through the loaded
     * shell unmodified; the loader only dev-warns on a bundle locale that
     * matches no declared language.
     */
    readonly translations?: GameTranslations;
    /**
     * Optional game-contributed UI icon glyphs (see {@link GameIconSet}). The
     * app root feeds these into the app-wide `<IconProvider>` through this
     * registry seam (via `useActiveGameIcons`), so `<Icon name="game.<id>.*">`
     * resolves a game glyph with the engine's currentColor + `--ch-size-icon`
     * styling — behaving exactly like a built-in inside an `<IconButton>`.
     * Absent ⇒ engine icons only. Passed through the loaded shell unmodified;
     * unlike fonts/images/cursor it needs no async decode, so the loader performs
     * no dispatch — the provider reads `shell.icons` directly. The loader only
     * dev-warns on a malformed set.
     */
    readonly icons?: GameIconSet;
}

export interface LoadedRendererGame {
    readonly registry: GameScreenRegistry;
    readonly assetManifest?: AssetManifest;
    readonly inputActions?: readonly InputAction[];
    readonly shell?: LoadedRendererGameShell;
}

export class UnknownRendererGameError extends Error {
    constructor(gameId: string) {
        super(`No renderer game registered for game '${gameId}'.`);
        this.name = 'UnknownRendererGameError';
    }
}

/** Async factory producing a fully loaded renderer game bundle. */
export type RendererGameLoader = () => Promise<LoadedRendererGame>;
/** Async factory producing only a renderer game's shell bundle. */
export type RendererGameShellLoader = () => Promise<LoadedRendererGameShell>;

/**
 * A consumer app's renderer-side contribution, injected at the renderer
 * composition root (the `MainGameContribution` twin). The renderer host
 * (`@chimera-engine/renderer`) ships no game-specific renderer code; a game enters the
 * renderer exclusively by registering one of these through
 * {@link registerRendererGame}. The two loaders keep the heavy game modules
 * behind dynamic `import()` so registration stays a cheap, eager side effect
 * while the bundles remain code-split.
 */
export interface RendererGameContribution {
    readonly gameId: string;
    readonly loadGame: RendererGameLoader;
    readonly loadShell: RendererGameShellLoader;
}

// Mutable, module-singleton registry populated at runtime by the consumer app's
// renderer composition root (`apps/<game>/renderer/register.ts`). The renderer
// itself names no game.
const rendererGameLoaders = new Map<string, RendererGameLoader>();
const rendererGameShellLoaders = new Map<string, RendererGameShellLoader>();

/**
 * Register a consumer app's renderer contribution. Called once at startup from
 * the renderer composition root, selected by build config (a `next.config`
 * alias) — never imported by `renderer/**` source, which stays game-agnostic.
 */
export function registerRendererGame(contribution: RendererGameContribution): void {
    rendererGameLoaders.set(contribution.gameId, contribution.loadGame);
    rendererGameShellLoaders.set(contribution.gameId, contribution.loadShell);
}

/**
 * Light, dev-time validation for a game's contributed translations. The data is
 * code-authored, so this is a typo-catching safety net, never a hard error:
 * every check degrades to a `console.warn` and the shell still loads. Warns when
 * the bundle map is not a plain object, and for each bundle locale that matches
 * no declared {@link GameLanguage} code (the provider simply won't select it). A
 * non-array `languages` is tolerated the same way — it yields an empty declared
 * set, so every bundle locale reads as undeclared and warns rather than throwing.
 */
function warnOnUndeclaredTranslationLocales(gameId: string, translations: GameTranslations): void {
    const { bundles, languages } = translations;
    if (typeof bundles !== 'object' || bundles === null) {
        console.warn(
            `[chimera] game '${gameId}' contributed a translations bundle map that is not an object; ignoring.`,
        );
        return;
    }
    // `languages` is statically typed as an array, but this helper defends the
    // code-authored cast escape hatch the sibling `bundles` guard also covers:
    // a non-array must yield an empty declared set, never throw on `.map`.
    const declaredLanguages: readonly GameLanguage[] = Array.isArray(languages) ? languages : [];
    const declaredCodes = new Set(declaredLanguages.map((language) => language.code));
    for (const locale of Object.keys(bundles)) {
        if (!declaredCodes.has(locale)) {
            console.warn(
                `[chimera] game '${gameId}' contributes a translation bundle for locale '${locale}' with no matching declared language; the provider will not select it.`,
            );
        }
    }
}

/**
 * Light, dev-time validation for a game's contributed icons. Like the sibling
 * translations guard, this is a typo-catching safety net, never a hard error:
 * every check degrades to a `console.warn` and the shell still loads (`<Icon>`'s
 * own render guard covers a bad entry). Warns when the set is not a plain object,
 * and for each entry missing a non-empty string `viewBox` or a valid React
 * `content` element.
 */
function warnOnMalformedGameIcons(gameId: string, icons: GameIconSet): void {
    if (typeof icons !== 'object' || icons === null) {
        console.warn(
            `[chimera] game '${gameId}' contributed an icons set that is not an object; ignoring.`,
        );
        return;
    }
    for (const [name, glyph] of Object.entries(icons)) {
        const shape = glyph !== null && typeof glyph === 'object' ? glyph : undefined;
        const viewBox = (shape as { viewBox?: unknown } | undefined)?.viewBox;
        const content = (shape as { content?: unknown } | undefined)?.content;
        if (typeof viewBox !== 'string' || viewBox.length === 0 || !isValidElement(content)) {
            console.warn(
                `[chimera] game '${gameId}' contributed a malformed icon glyph '${name}'; <Icon> will render nothing for it.`,
            );
        }
    }
}

/**
 * Light, dev-time validation of a game's per-screen loading covers (§4.36).
 * Like the sibling translations and icons guards this is a typo-catching safety
 * net, never a hard error: a game mid-refactor must keep loading. Warns once per
 * key that names neither `'playfield'` (the always-present slot, Invariant #81)
 * nor an entry in `registry.screens`. A non-object map is tolerated the same way,
 * since `Object.keys(null)` would throw and cost the whole game load.
 */
function warnOnUnknownLoadingScreenKeys(gameId: string, registry: GameScreenRegistry): void {
    const { loadingScreens, screens } = registry;
    if (typeof loadingScreens !== 'object' || loadingScreens === null) {
        console.warn(
            `[chimera] game '${gameId}' contributed a loadingScreens map that is not an object; ignoring.`,
        );
        return;
    }
    for (const screenKey of Object.keys(loadingScreens)) {
        if (screenKey === 'playfield' || screens?.[screenKey] !== undefined) {
            continue;
        }
        console.warn(
            `[chimera] game '${gameId}' declares a loadingScreens cover for '${screenKey}', which names neither 'playfield' nor a registered screen.`,
        );
    }
}

/** Log module name, so a warm-up report is attributable rather than 'global'. */
const WARM_UP_LOG_MODULE = 'game-registry';

/**
 * How long a loaded shell's asset warm-up — fonts, preload images, cursor
 * textures — may hold a registry load before the load resolves without it.
 *
 * 5 s, and a rescue rather than a schedule, exactly like the two preload
 * budgets it precedes (`CRITICAL_ASSET_PRELOAD_BUDGET_MS` = 8 s,
 * `SCENE_PRELOAD_BUDGET_MS` = 5 s; Invariant #133). Every one of these fetches
 * has a degraded form the shell can render — a warmed image is a decode the
 * first paint would have done anyway, and a cursor token left unwritten is the
 * engine's stock cursor — so what an elapsed budget costs is a frame of
 * fallback, and what it buys is a route that cannot be held open by a
 * `chimera://` fetch that never answers.
 *
 * This budget and the route-entry gate's are sequential on a `/game` entry:
 * this one runs first, so the pair costs at most 13 s, and
 * `rendererGameRegistry.test.ts` asserts that sum stays strictly under the 15 s
 * the game-route e2e allows the canvas.
 *
 * What is NOT budgeted is the `RendererGameLoader` call above the warm-up — the
 * game's own dynamic `import()`. It cannot fail open: there is no degraded form
 * of an absent `GameScreenRegistry`, so the only settle a budget could add
 * there is a throw, which turns a slow module into a refused route. Its own
 * ceiling is the bundler's: the shipped webpack runtime arms a 120 s timeout on
 * the chunk `<script>` and rejects with `ChunkLoadError`, and that rejection
 * reaches the player as the crash fallback. The stylesheet sibling of the same
 * chunk carries no such timeout — see `docs/core-components/asset-reference-system.md`.
 */
export const GAME_SHELL_WARMUP_BUDGET_MS = 5_000;

/** One awaited step of the warm-up, named so a budget report can list it. */
interface ShellWarmUpStep {
    readonly name: string;
    run(): Promise<void>;
}

/**
 * The asset work a loaded shell owes before it is handed to a surface, as a
 * list rather than three `if`s so the budget below can name what a wedged step
 * left undone — including the steps it never let start.
 */
function shellWarmUpSteps(
    gameId: string,
    shell: LoadedRendererGameShell,
): readonly ShellWarmUpStep[] {
    const { fonts, preloadImages, cursor } = shell;
    const steps: ShellWarmUpStep[] = [];
    if (fonts !== undefined) {
        steps.push({ name: 'fonts', run: () => loadGameFonts(fonts) });
    }
    if (preloadImages !== undefined) {
        steps.push({ name: 'preloadImages', run: () => warmGameImages(preloadImages) });
    }
    if (cursor !== undefined) {
        steps.push({ name: 'cursor', run: () => applyGameCursorOverrides(gameId, cursor) });
    }
    return steps;
}

/**
 * Runs a loaded shell's warm-up on {@link GAME_SHELL_WARMUP_BUDGET_MS}, and
 * fails open when it elapses. Nothing is ABORTED there: the sequence runs on in
 * the background and its effects still land — a font that arrives late is still
 * added to the document, a cursor token is still written — they simply stop
 * being something the load waits for.
 *
 * The steps stay SEQUENTIAL, exactly as the three `await`s they replace were:
 * this bounds the warm-up, it does not re-order it. So at most one step is ever
 * in flight, the ones behind it have not started, and the report names both.
 *
 * A step that REJECTS still rejects the load: that is a settled outcome, it
 * already reaches the player as the crash fallback, and a budget adds nothing
 * to it. Only the wedge — a fetch that neither resolves nor rejects — is what
 * this bounds.
 */
async function warmLoadedShell(gameId: string, shell: LoadedRendererGameShell): Promise<void> {
    const steps = shellWarmUpSteps(gameId, shell);
    if (steps.length === 0) {
        // Nothing to warm: no timer is armed, so a shell that declares no assets
        // costs exactly what it cost before this budget existed.
        return;
    }

    // The index of the first step that has not finished — the one in flight, and
    // the cut point for everything it has not let start. Read only from the
    // budget callback, which runs while `warmUp` below is parked on `await`.
    let firstUnfinishedStep = 0;
    const warmUp = (async () => {
        for (const step of steps) {
            await step.run();
            firstUnfinishedStep += 1;
        }
    })();

    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
        budgetTimer = setTimeout(() => {
            emitRendererWarning(
                readRendererLogsApi(),
                '[assets] game shell warm-up exceeded its budget; loading the game without it',
                {
                    gameId,
                    budgetMs: GAME_SHELL_WARMUP_BUDGET_MS,
                    pending: steps.slice(firstUnfinishedStep).map((step) => step.name),
                },
                WARM_UP_LOG_MODULE,
            );
            resolve();
        }, GAME_SHELL_WARMUP_BUDGET_MS);
    });

    try {
        // `Promise.race` attaches to BOTH inputs, so a step that rejects after
        // the budget already won is handled there and the fail-open stands — a
        // late failure never un-resolves a load that has already been released.
        await Promise.race([warmUp, budget]);
    } finally {
        // Cleared on every path, the rejecting one included: a rejection that
        // escaped the `await` would otherwise leave the timer armed to warn
        // about steps pending on a load that had already failed.
        clearTimeout(budgetTimer);
    }
}

/**
 * The registration side effects a loaded shell carries, in the order both
 * loaders have always run them: the budgeted asset warm-up first, then the two
 * synchronous dev-time guards, which are cheap enough to run even on the path
 * where the warm-up was cut short.
 */
async function applyLoadedShell(gameId: string, shell: LoadedRendererGameShell): Promise<void> {
    await warmLoadedShell(gameId, shell);
    if (shell.translations !== undefined) {
        warnOnUndeclaredTranslationLocales(gameId, shell.translations);
    }
    if (shell.icons !== undefined) {
        warnOnMalformedGameIcons(gameId, shell.icons);
    }
}

export async function loadRendererGame(gameId: string): Promise<LoadedRendererGame> {
    const loader = rendererGameLoaders.get(gameId);
    if (loader === undefined) {
        throw new UnknownRendererGameError(gameId);
    }

    // Deliberately unbudgeted — see GAME_SHELL_WARMUP_BUDGET_MS above.
    const game = await loader();
    if (game.registry.loadingScreens !== undefined) {
        warnOnUnknownLoadingScreenKeys(gameId, game.registry);
    }
    if (game.shell !== undefined) {
        await applyLoadedShell(gameId, game.shell);
    }
    return game;
}

export async function loadRendererGameShell(gameId: string): Promise<LoadedRendererGameShell> {
    const loader = rendererGameShellLoaders.get(gameId);
    if (loader === undefined) {
        throw new UnknownRendererGameError(gameId);
    }

    // Deliberately unbudgeted — see GAME_SHELL_WARMUP_BUDGET_MS above.
    const shell = await loader();
    await applyLoadedShell(gameId, shell);
    return shell;
}

export function getRendererGameMenuCommand(
    game: LoadedRendererGame,
    commandId: GameMenuCommandId,
): (() => void) | undefined {
    return game.shell?.menuCommands?.[commandId];
}

/**
 * Test-only: clear the injected registry so each test starts from the
 * game-agnostic empty state. Never called by production code.
 */
export function _resetRendererGameRegistryForTest(): void {
    rendererGameLoaders.clear();
    rendererGameShellLoaders.clear();
}
