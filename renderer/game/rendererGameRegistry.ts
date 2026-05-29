import type { ComponentType } from 'react';
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

const rendererGameLoaders: Readonly<Record<string, RendererGameLoader>> = {
    tactics: loadTacticsRendererGame,
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
        import('@chimera/games/tactics/screens/index.js'),
        import('@chimera/games/tactics/asset-manifest.js'),
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
    await import('@chimera/games/tactics/styles/register-token-overrides.js');

    const [mainMenuModule, settingsPageModule, backgroundModule, fontsModule] = await Promise.all([
        import('@chimera/games/tactics/shell/main-menu.js'),
        import('@chimera/games/tactics/shell/settings-page.js'),
        import('@chimera/games/tactics/shell/TacticsShellBackground.js'),
        import('@chimera/games/tactics/shell/fonts.js'),
    ]);

    await loadGameFonts(fontsModule.tacticsFonts);

    return {
        mainMenu: mainMenuModule.tacticsMainMenuDefinition,
        menuCommands: mainMenuModule.tacticsMenuCommands,
        settings: settingsPageModule.tacticsSettingsPageDefinition,
        shellBackground: backgroundModule.TacticsShellBackground,
        fonts: fontsModule.tacticsFonts,
    };
}
