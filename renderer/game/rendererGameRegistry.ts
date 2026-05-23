import type { GameScreenRegistry } from '@chimera/shared/game-screen-contract.js';
import type {
    GameMainMenuDefinition,
    GameMenuCommandId,
} from '@chimera/shared/game-shell-contract.js';
import type { AssetManifest } from '@chimera/simulation/content/AssetManifest.js';
import type { InputAction } from '../input/InputAction.js';

export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
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

const rendererGameLoaders: Readonly<Record<string, RendererGameLoader>> = {
    tactics: loadTacticsRendererGame,
};

export async function loadRendererGame(gameId: string): Promise<LoadedRendererGame> {
    const loader = rendererGameLoaders[gameId];
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
    const [screenModule, assetManifestModule] = await Promise.all([
        import('@chimera/games/tactics/screens/index.js'),
        import('@chimera/games/tactics/asset-manifest.js'),
    ]);

    return {
        registry: screenModule.TacticsGameScreenRegistry,
        assetManifest: assetManifestModule.tacticsAssetManifest,
        inputActions: screenModule.TACTICS_INPUT_ACTIONS,
        // shell: contributed once T51.5 lands (games/tactics/shell/main-menu.ts)
    };
}
