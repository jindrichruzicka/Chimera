import { parseAssetRef } from '@chimera/shared/asset-ref-parse.js';
import type { AssetRef } from '@chimera/simulation/content/AssetRef.js';

export interface AssetResolver {
    resolve(ref: AssetRef): string;
}

export const DEFAULT_RENDERER_ASSET_BASE_URL = 'chimera://renderer/assets';

export function createDevResolver(projectRoot: string): AssetResolver {
    return {
        resolve(ref: AssetRef): string {
            const { gameId, relativePath } = parseAssetRef(ref);
            return `file://${projectRoot}/games/${gameId}/assets/${relativePath}`;
        },
    };
}

export function createProductionResolver(resourcesPath: string): AssetResolver {
    return {
        resolve(ref: AssetRef): string {
            const { gameId, relativePath } = parseAssetRef(ref);
            return `file://${resourcesPath}/assets/${gameId}/${relativePath}`;
        },
    };
}

export function createRendererProtocolAssetResolver(
    baseUrl: string = DEFAULT_RENDERER_ASSET_BASE_URL,
): AssetResolver {
    const normalisedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return {
        resolve(ref: AssetRef): string {
            const { gameId, relativePath } = parseAssetRef(ref);
            const encodedGameId = encodeURIComponent(gameId);
            const encodedRelativePath = relativePath.split('/').map(encodeURIComponent).join('/');
            return `${normalisedBaseUrl}/${encodedGameId}/${encodedRelativePath}`;
        },
    };
}
