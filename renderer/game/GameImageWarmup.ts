// Warm-up loader for game-declared shell images (`LoadedRendererGameShell.
// preloadImages`) — the image twin of GameFontLoader. Sources are local game
// asset refs resolved onto the renderer asset protocol; each is fetched AND
// fully decoded (`img.decode()`), so by the time a shell screen renders the
// picture the compositor paints it in a single frame instead of streaming it
// in progressively. Warm-up is best-effort: a broken declaration warns and
// resolves — a decorative picture must never block the shell from loading.

import { DEFAULT_RENDERER_GAME_ASSET_BASE_URL } from '../assets/AssetResolver';
import { resolveGameShellAssetSource } from './gameShellAssetSource';

const warmedImageSources = new Set<string>();

export function resolveGameImageSource(
    src: string,
    baseUrl: string = DEFAULT_RENDERER_GAME_ASSET_BASE_URL,
): string {
    return resolveGameShellAssetSource(src, 'image', baseUrl);
}

export async function warmGameImages(sources: readonly string[]): Promise<void> {
    if (typeof Image !== 'function') {
        return;
    }

    const resolvedSources = sources.map((src) => resolveGameImageSource(src));
    const sourcesToWarm = resolvedSources.filter((resolvedSource) => {
        if (warmedImageSources.has(resolvedSource)) {
            return false;
        }
        warmedImageSources.add(resolvedSource);
        return true;
    });

    await Promise.all(
        sourcesToWarm.map(async (resolvedSource) => {
            const image = new Image();
            image.src = resolvedSource;
            try {
                if (typeof image.decode === 'function') {
                    await image.decode();
                }
            } catch (error: unknown) {
                // Drop the failed source from the warmed set so a later shell
                // load retries it instead of permanently trusting a cold cache.
                warmedImageSources.delete(resolvedSource);
                console.warn(
                    `[chimera] warmGameImages: failed to warm '${resolvedSource}': ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }),
    );
}

export function resetWarmedGameImagesForTests(): void {
    warmedImageSources.clear();
}
