import type { ComponentType } from 'react';
import type { GameLobbyScreenProps } from '@chimera/shared/game-lobby-contract.js';
import type { GameScreenRegistry } from '@chimera/shared/game-screen-contract.js';
import type {
    GameFontFace,
    GameMainMenuDefinition,
    GameMenuCommandId,
    GameSettingsPageDefinition,
} from '@chimera/shared/game-shell-contract.js';
import type { AssetManifest } from '@chimera/simulation/content/AssetManifest.js';
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

type RendererGameLoader = () => Promise<LoadedRendererGame>;
type RendererGameShellLoader = () => Promise<LoadedRendererGameShell>;

/**
 * The renderer's default game id — selected by the lobby/menus when no explicit
 * `gameId` is supplied. This registry is the renderer-owned source of truth for
 * which games exist (it alone may import `games/*`), so game-agnostic shell pages
 * read the default from here instead of importing a game package directly
 * (Invariant #94). Currently tactics is both the only registered game and the
 * default.
 */
export const DEFAULT_RENDERER_GAME_ID = 'tactics';

const rendererGameLoaders: Readonly<Record<string, RendererGameLoader>> = {
    [DEFAULT_RENDERER_GAME_ID]: loadTacticsRendererGame,
};

const rendererGameShellLoaders: Readonly<Record<string, RendererGameShellLoader>> = {
    tactics: loadTacticsRendererGameShell,
};

export async function loadRendererGame(gameId: string): Promise<LoadedRendererGame> {
    const loader = rendererGameLoaders[gameId];
    if (loader === undefined) {
        throw new UnknownRendererGameError(gameId);
    }

    return loader();
}

export async function loadRendererGameShell(gameId: string): Promise<LoadedRendererGameShell> {
    const loader = rendererGameShellLoaders[gameId];
    if (loader === undefined) {
        throw new UnknownRendererGameError(gameId);
    }

    return loader();
}

export function getRendererGameMenuCommand(
    game: LoadedRendererGame,
    commandId: GameMenuCommandId,
): (() => void) | undefined {
    return game.shell?.menuCommands?.[commandId];
}

async function loadTacticsRendererGame(): Promise<LoadedRendererGame> {
    const [screenModule, assetManifestModule, shell] = await Promise.all([
        import('@chimera/tactics/screens/index.js'),
        import('@chimera/tactics/asset-manifest.js'),
        loadTacticsRendererGameShell(),
    ]);

    return {
        registry: screenModule.TacticsGameScreenRegistry,
        assetManifest: assetManifestModule.tacticsAssetManifest,
        inputActions: screenModule.TACTICS_INPUT_ACTIONS,
        shell,
    };
}

async function loadTacticsRendererGameShell(): Promise<LoadedRendererGameShell> {
    await import('@chimera/tactics/styles/register-token-overrides.js');

    const [mainMenuModule, settingsPageModule, backgroundModule, lobbyScreenModule, fontsModule] =
        await Promise.all([
            import('@chimera/tactics/shell/main-menu.js'),
            import('@chimera/tactics/shell/settings-page.js'),
            import('@chimera/tactics/shell/TacticsShellBackground.js'),
            import('@chimera/tactics/shell/TacticsLobbyScreen.js'),
            import('@chimera/tactics/shell/fonts.js'),
        ]);

    await loadGameFonts(fontsModule.tacticsFonts);

    return {
        mainMenu: mainMenuModule.tacticsMainMenuDefinition,
        menuCommands: mainMenuModule.tacticsMenuCommands,
        settings: settingsPageModule.tacticsSettingsPageDefinition,
        shellBackground: backgroundModule.TacticsShellBackground,
        LobbyScreen: lobbyScreenModule.TacticsLobbyScreen,
        fonts: fontsModule.tacticsFonts,
    };
}
