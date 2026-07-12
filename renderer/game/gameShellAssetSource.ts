// Shared resolver for game-shell asset declarations (fonts, preload images,
// cursor textures). Shell contributions declare sources as local game asset
// refs (`<gameId>/<relativePath>`); this maps them onto the renderer asset
// protocol (`chimera://renderer/game-assets/...`) and rejects anything that is
// not a local game asset (absolute paths, protocol-relative URLs, URL schemes)
// so a shell declaration can never reach out of the packaged asset roots.

import {
    MalformedAssetRefError,
    parseAssetRef,
} from '@chimera-engine/simulation/foundation/asset-ref-parse.js';

import { DEFAULT_RENDERER_GAME_ASSET_BASE_URL } from '../assets/AssetResolver';

const urlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/** Kind label used in rejection messages ("Game font source…", "Game cursor source…"). */
export type GameShellAssetKind = 'font' | 'image' | 'cursor';

export function resolveGameShellAssetSource(
    src: string,
    kind: GameShellAssetKind,
    baseUrl: string = DEFAULT_RENDERER_GAME_ASSET_BASE_URL,
): string {
    if (isUnsafeShellAssetSource(src)) {
        throw new Error(`Game ${kind} source must be a local game asset ref: ${src}`);
    }

    try {
        const { gameId, relativePath } = parseAssetRef(src);
        const normalisedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const encodedGameId = encodeURIComponent(gameId);
        const encodedRelativePath = relativePath.split('/').map(encodeURIComponent).join('/');
        return `${normalisedBaseUrl}/${encodedGameId}/${encodedRelativePath}`;
    } catch (error: unknown) {
        if (error instanceof MalformedAssetRefError) {
            throw new Error(`Game ${kind} source must be a local game asset ref: ${src}`);
        }
        throw error;
    }
}

/**
 * Resolve a game-RELATIVE asset path (`cursors/default.png`, the
 * `GameManifest` convention) for a known `gameId`. The raw relative path is
 * checked against the unsafe-source policy BEFORE it is joined with the game
 * id — joining first would mask absolute/scheme'd values (`https://evil` →
 * `tactics/https://evil` no longer looks like a URL scheme).
 */
export function resolveGameShellAssetPath(
    gameId: string,
    relativePath: string,
    kind: GameShellAssetKind,
    baseUrl: string = DEFAULT_RENDERER_GAME_ASSET_BASE_URL,
): string {
    if (isUnsafeShellAssetSource(relativePath)) {
        throw new Error(`Game ${kind} source must be a local game asset ref: ${relativePath}`);
    }

    try {
        return resolveGameShellAssetSource(`${gameId}/${relativePath}`, kind, baseUrl);
    } catch {
        // Re-point the delegate's rejection at the path the game declared,
        // not the internally joined `<gameId>/<relativePath>` form.
        throw new Error(`Game ${kind} source must be a local game asset ref: ${relativePath}`);
    }
}

function isUnsafeShellAssetSource(src: string): boolean {
    return src.startsWith('/') || src.startsWith('//') || urlSchemePattern.test(src);
}
