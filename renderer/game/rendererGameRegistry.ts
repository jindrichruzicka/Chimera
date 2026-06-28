import type { ComponentType } from 'react';
import type { GameLobbyScreenProps } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type {
    GameFontFace,
    GameMainMenuDefinition,
    GameMenuCommandId,
    GameSettingsPageDefinition,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { InputAction } from '../input/InputAction.js';
import { loadGameFonts } from './GameFontLoader';

export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
    readonly settings?: GameSettingsPageDefinition;
    readonly shellBackground?: ComponentType;
    /**
     * Optional game-provided lobby screen. When present, the lobby page renders
     * it in place of the engine-default `ActiveLobbyPanel`, passing the
     * {@link GameLobbyScreenProps} contract. Loaded via this registry only — the
     * lobby page never imports `games/*` directly (Invariant #94).
     */
    readonly LobbyScreen?: ComponentType<GameLobbyScreenProps>;
    readonly fonts?: readonly GameFontFace[];
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

/**
 * Thrown when {@link getDefaultRendererGameId} is read before any consumer app
 * has registered a default renderer game. The renderer ships no game-specific
 * code, so it has no fallback game to offer — fail loud rather than guess.
 */
export class NoDefaultRendererGameError extends Error {
    constructor() {
        super(
            'No default renderer game registered. A consumer app must register a renderer game contribution (isDefault: true) before the shell reads the default.',
        );
        this.name = 'NoDefaultRendererGameError';
    }
}

/** Async factory producing a fully loaded renderer game bundle. */
export type RendererGameLoader = () => Promise<LoadedRendererGame>;
/** Async factory producing only a renderer game's shell bundle. */
export type RendererGameShellLoader = () => Promise<LoadedRendererGameShell>;

/**
 * A consumer app's renderer-side contribution, injected at the renderer
 * composition root (the F62 `MainGameContribution` twin). The renderer host
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
    /** When true, this game becomes the renderer default (lobby/menus pick it). */
    readonly isDefault?: boolean;
}

// Mutable, module-singleton registry populated at runtime by the consumer app's
// renderer composition root (`apps/<game>/renderer/register.ts`). Replaces the
// previous hard-coded loader records: the renderer no longer names any game.
const rendererGameLoaders = new Map<string, RendererGameLoader>();
const rendererGameShellLoaders = new Map<string, RendererGameShellLoader>();
let defaultRendererGameId: string | null = null;

/**
 * Register a consumer app's renderer contribution. Called once at startup from
 * the renderer composition root, selected by build config (a `next.config`
 * alias) — never imported by `renderer/**` source, which stays game-agnostic.
 */
export function registerRendererGame(contribution: RendererGameContribution): void {
    rendererGameLoaders.set(contribution.gameId, contribution.loadGame);
    rendererGameShellLoaders.set(contribution.gameId, contribution.loadShell);
    if (contribution.isDefault === true) {
        defaultRendererGameId = contribution.gameId;
    }
}

/**
 * The renderer's default game id — selected by the lobby/menus when no explicit
 * `gameId` is supplied. Read at call time (not module-eval) so it resolves after
 * the consumer app has registered its contribution at startup.
 *
 * @throws {NoDefaultRendererGameError} when no default has been registered yet.
 */
export function getDefaultRendererGameId(): string {
    if (defaultRendererGameId === null) {
        throw new NoDefaultRendererGameError();
    }
    return defaultRendererGameId;
}

export async function loadRendererGame(gameId: string): Promise<LoadedRendererGame> {
    const loader = rendererGameLoaders.get(gameId);
    if (loader === undefined) {
        throw new UnknownRendererGameError(gameId);
    }

    const game = await loader();
    if (game.shell?.fonts !== undefined) {
        await loadGameFonts(game.shell.fonts);
    }
    return game;
}

export async function loadRendererGameShell(gameId: string): Promise<LoadedRendererGameShell> {
    const loader = rendererGameShellLoaders.get(gameId);
    if (loader === undefined) {
        throw new UnknownRendererGameError(gameId);
    }

    const shell = await loader();
    if (shell.fonts !== undefined) {
        await loadGameFonts(shell.fonts);
    }
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
    defaultRendererGameId = null;
}
