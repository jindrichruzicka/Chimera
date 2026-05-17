import type { AssetManifest } from '@chimera/simulation/content/AssetManifest.js';
import type { GameScreenRegistry } from '@chimera/shared/game-screen-contract.js';

export interface LoadedRendererGame {
    readonly registry: GameScreenRegistry;
    readonly assetManifest?: AssetManifest;
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

async function loadTacticsRendererGame(): Promise<LoadedRendererGame> {
    const [screenModule, assetManifestModule] = await Promise.all([
        import('@chimera/games/tactics/screens/index.js'),
        import('@chimera/games/tactics/asset-manifest.js'),
    ]);

    return {
        registry: screenModule.TacticsGameScreenRegistry,
        assetManifest: assetManifestModule.tacticsAssetManifest,
    };
}
