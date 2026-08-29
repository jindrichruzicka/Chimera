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
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import { SCENE_PRELOAD_BUDGET_MS } from '../components/scene/scenePreload.js';
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

/**
 * A game's menu music bed: the loop the engine plays for as long as the player is
 * on a shell surface, and hands off when a match starts (§4.25).
 *
 * A DECLARATION rather than a call, for the same reason `shellBackground` is one:
 * the bed has to outlive every individual shell screen — it plays across
 * `/main-menu → /settings → /saves` as one voice — and no component that renders
 * on any one of those screens has that lifetime. It also has to survive a game
 * that contributes no shell component at all, which a hook could not.
 *
 * Inert without {@link LoadedRendererGameShell.shellAudioAssets}: the ref resolves
 * through the shell session's manifest, and there is nothing to resolve it against.
 */
export interface GameShellMusicBed {
    /** The looping clip, named as an entry of the shell audio manifest. */
    readonly ref: AssetRef<AudioClipAsset>;
    /**
     * Bed volume within the `music` bus, defaulting to `1`. The bus itself
     * carries the player's `audio.musicVolume`, `audio.masterVolume` and
     * `audio.muted` (§4.13), so this is the game's mix against its own match
     * music — never a way around a setting.
     */
    readonly volume?: number;
    /** Fade-in from silence when the bed starts. Absent ⇒ it starts at `volume`. */
    readonly fadeInMs?: number;
}

export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
    readonly settings?: GameSettingsPageDefinition;
    readonly shellBackground?: ComponentType;
    /**
     * Optional asset manifest for the {@link shellBackground} component. When
     * present, `ShellBackgroundHost` wraps the background in the same
     * `GameAssetSession` a game-owned page uses, so `useAsset` /
     * `useModelInstance` / `useAnimationSheet` resolve on shell routes against an
     * inventory the game declared for them (§4.10, Invariant #21). Without it
     * those hooks reach the app-level manager instead, and what that reaches is
     * whatever is bound to it at the time.
     *
     * Absent ⇒ no session is opened and the host's markup is unchanged, which
     * is the path every game that renders a plain DOM background stays on.
     * Declared WITHOUT a `shellBackground` is inert for the same reason: a
     * session with no subtree to publish to is never built.
     *
     * What the session's lifetime is — and what it deliberately is not — is
     * §4.37.9's.
     */
    readonly shellBackgroundAssets?: AssetManifest;
    /**
     * Opt in to a background the player can CLICK (§4.37.9). Absent or `false`
     * keeps the inert-decor contract exactly: `pointer-events: none` and
     * `aria-hidden="true"` on the host, which is what every game that renders a
     * painted backdrop stays on.
     *
     * `true` does two things to the host and nothing else: the host stops
     * refusing pointer events, and it stops hiding itself from assistive tech —
     * an interactive region behind `aria-hidden` is a region a screen-reader
     * user cannot reach, so the two flip together rather than separately.
     *
     * What it does NOT do is clear a path to the background. The engine's own
     * layers sit above it and each is a hit target over its whole box whether
     * or not it paints anything, so a click lands on the topmost of them
     * regardless of this flag. Under the opt-in the engine makes its own layers
     * click-through and restores `pointer-events: auto` on the controls
     * themselves — `ShellContentLayer` for the app-level frame, the main menu
     * for its own full-viewport container — and a game-owned page owns that
     * construction for its own route, because it is the top layer there and the
     * engine cannot know its markup.
     *
     * Declared WITHOUT a `shellBackground` is inert: there is no subtree to
     * receive the events.
     */
    readonly shellBackgroundInteractive?: boolean;
    /**
     * Optional asset manifest for what the game SOUNDS on shell surfaces (§4.25).
     * When present, `ShellAudioSession` builds a manager over it and registers it
     * as the app-level `DelegatingAssetManager` delegate for as long as a shell
     * surface with this game in context is mounted — so `useSound` and
     * `useMusicTrack`, which resolve their clips through the app-level
     * `AudioManager` (Invariant #64), play on `/main-menu` instead of dying in a
     * swallowed `NoActiveGameSessionError`.
     *
     * Separate from {@link shellBackgroundAssets} because the two publish to
     * different places: the background's manager is published to the background
     * SUBTREE through `AssetManagerContext`, which the app-level `AudioManager`
     * is not inside. A game may point both fields at the same
     * `shell-asset-manifest.ts` value, and `validate-assets` covers that file by
     * NAME, so neither field needs a build-time gate of its own.
     *
     * Absent ⇒ no session is opened and no delegate is ever registered from a
     * shell surface, which is the path every game with a silent menu stays on.
     */
    readonly shellAudioAssets?: AssetManifest;
    /**
     * Optional menu music bed (see {@link GameShellMusicBed}), played by the
     * shell audio session across the shell surfaces and handed off when a match
     * starts. Declared WITHOUT {@link shellAudioAssets} is inert: the session
     * that would resolve the ref is never opened.
     */
    readonly shellMusicBed?: GameShellMusicBed;
    /**
     * Optional game-provided lobby screen. When present, the lobby page renders
     * it in place of the engine-default `ActiveLobbyPanel`, passing the
     * {@link GameLobbyScreenProps} contract. Loaded via this registry only — the
     * lobby page never imports `apps/*` directly (Invariant #94).
     */
    readonly LobbyScreen?: ComponentType<GameLobbyScreenProps>;
    /**
     * Optional game-owned Next routes promoted to first-class shell pages
     * (§4.37.17). Each entry names a PHYSICAL page in the game's own host tree
     * (`apps/<game>/renderer/app/<route>/page.tsx`) — the logo-screen and
     * model-showcase precedent turned into a supported pattern — declared with a
     * leading slash and no trailing one (`'/credits'`).
     *
     * One declaration, three effects:
     *
     *   1. A declared route classifies as the `page` shell surface, which is a
     *      background surface — so the pinned same-instance background persists
     *      across `/main-menu → /<page> → /settings` (§4.37.18).
     *   2. `GameStoreBootstrap`'s snapshot → `/game` gate admits that surface, so
     *      a match started from a custom page carries the player into the match
     *      instead of stranding them on the page.
     *   3. Menu `navigate` reaches them as an ordinary instant hop with the
     *      `?gameId=` context preserved.
     *
     * The classification normalizes both sides (`normalizeRoutePath`): the static export
     * sets `trailingSlash: true`, so the router reports `/credits/` for a route
     * declared as `'/credits'`, and the packaged app can serve it as
     * `/credits/index.html`.
     *
     * A declared route with no physical page is a Next 404 the engine never
     * observes at runtime, so it is caught statically instead — see
     * `tools/shell-page-routes.test.ts`.
     */
    readonly shellRoutes?: readonly `/${string}`[];
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
    /**
     * The game's named input actions, declared on the SHELL payload so they can
     * be registered at app boot — before a lobby exists and before any match
     * has run (§4.26).
     *
     * The same table {@link LoadedRendererGame.inputActions} carries: a game
     * declares it once and hands the same array to both payloads, so the
     * app-boot registrar and `GameShell` register identical objects and the
     * second call is a no-op. They are NOT required to be the same array —
     * `registerInputActions` compares metadata, not identity — but a game that
     * ships DIFFERENT metadata under one id gets a thrown error rather than
     * last-write-win.
     *
     * Carried here rather than read off the game payload because the shell
     * payload is what a menu route loads: resolving `inputActions` through
     * `loadRendererGame` would pull the game's screens and asset manifest into
     * the main menu's bundle to read a table of action metadata.
     *
     * Absent ⇒ nothing is registered from this payload, which is the path every
     * game with no rebindable action stays on.
     *
     * Registration is app-lifetime and has no shell-scoped teardown: an action
     * registered on the menu is still registered in the match. What that buys
     * is `GameShell`'s registration becoming a proven no-op, and Settings >
     * Controls listing game actions on a shell route.
     */
    readonly inputActions?: readonly InputAction[];
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

/**
 * Light, dev-time validation of a game's declared minimum-visible cover time
 * (§4.36). Like the sibling guards this is a typo-catching safety net, never a
 * hard error, and it never rewrites the registry. Warns once for a value that
 * is not a finite non-negative number (the floor resolver falls back to the
 * engine default; a declared `0` is valid and opts down to gate-settle-only),
 * and warns
 * once — honoring the value, never clamping it — for a minimum above
 * `SCENE_PRELOAD_BUDGET_MS`: a cosmetic knob above a release budget quietly
 * becomes the player's worst-case wait, which deserves a sentence at
 * registration rather than silence.
 */
function warnOnInvalidLoadingScreenMinVisible(gameId: string, registry: GameScreenRegistry): void {
    const declared = registry.loadingScreenMinVisibleMs;
    if (typeof declared !== 'number' || !Number.isFinite(declared) || declared < 0) {
        console.warn(
            `[chimera] game '${gameId}' declares loadingScreenMinVisibleMs = ${String(declared)}, which is not a finite non-negative number of milliseconds; the floor resolver falls back to the engine default. Declare 0 to opt down to gate-settle-only.`,
        );
        return;
    }
    if (declared > SCENE_PRELOAD_BUDGET_MS) {
        console.warn(
            `[chimera] game '${gameId}' declares loadingScreenMinVisibleMs = ${declared}ms, above the ${SCENE_PRELOAD_BUDGET_MS}ms scene preload budget; the floor is honored unclamped, so the loading screen can outlive the wait it explains.`,
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
    if (game.registry.loadingScreenMinVisibleMs !== undefined) {
        warnOnInvalidLoadingScreenMinVisible(gameId, game.registry);
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
