import { parseAssetRef } from '@chimera/shared/asset-ref-parse.js';
import type { AssetRef } from '@chimera/simulation/content/AssetRef.js';

export interface AssetResolver {
    resolve(ref: AssetRef): string;
}

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
