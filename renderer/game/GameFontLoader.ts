import type { GameFontFace } from '@chimera-engine/simulation/foundation/game-shell-contract.js';

import { DEFAULT_RENDERER_GAME_ASSET_BASE_URL } from '../assets/AssetResolver';
import { resolveGameShellAssetSource } from './gameShellAssetSource';

interface ResolvedGameFontFace {
    readonly definition: GameFontFace;
    readonly key: string;
    readonly resolvedSource: string;
    readonly descriptors: FontFaceDescriptors;
}

const loadedFontKeys = new Set<string>();

export function resolveGameFontSource(
    src: string,
    baseUrl: string = DEFAULT_RENDERER_GAME_ASSET_BASE_URL,
): string {
    return resolveGameShellAssetSource(src, 'font', baseUrl);
}

export async function loadGameFonts(fonts: readonly GameFontFace[]): Promise<void> {
    const resolvedFonts = fonts.map((font) => resolveFont(font));
    const fontSet = getDocumentFontSet();
    if (typeof FontFace !== 'function' || fontSet === null) {
        return;
    }

    const fontsToLoad = resolvedFonts.filter((font) => {
        if (loadedFontKeys.has(font.key)) {
            return false;
        }
        loadedFontKeys.add(font.key);
        return true;
    });

    await Promise.all(
        fontsToLoad.map(async (font) => {
            try {
                const fontFace = new FontFace(
                    font.definition.family,
                    `url("${font.resolvedSource}") format("woff2")`,
                    font.descriptors,
                );
                const loadedFace = await fontFace.load();
                fontSet.add(loadedFace);
            } catch (error: unknown) {
                loadedFontKeys.delete(font.key);
                throw error;
            }
        }),
    );
}

export function resetLoadedGameFontsForTests(): void {
    loadedFontKeys.clear();
}

function resolveFont(font: GameFontFace): ResolvedGameFontFace {
    const resolvedSource = resolveGameFontSource(font.src);
    const weight = font.weight ?? '400';
    const style = font.style ?? 'normal';
    const display = font.display ?? 'swap';
    return {
        definition: font,
        resolvedSource,
        descriptors: { weight, style, display },
        key: `${font.family}:${font.src}:${weight}:${style}`,
    };
}

function getDocumentFontSet(): FontFaceSet | null {
    if (typeof document === 'undefined') {
        return null;
    }
    if (document.fonts === undefined || typeof document.fonts.add !== 'function') {
        return null;
    }
    return document.fonts;
}
