// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameFontFace } from '@chimera/simulation/foundation/game-shell-contract.js';

import {
    loadGameFonts,
    resetLoadedGameFontsForTests,
    resolveGameFontSource,
} from './GameFontLoader';

class FakeFontFace {
    public readonly load = vi.fn(async (): Promise<FakeFontFace> => this);

    public constructor(
        public readonly family: string,
        public readonly source: string,
        public readonly descriptors: FontFaceDescriptors,
    ) {
        fakeFontFaces.push(this);
    }
}

const fakeFontFaces: FakeFontFace[] = [];
const addFontFace = vi.fn();

describe('GameFontLoader', () => {
    beforeEach(() => {
        fakeFontFaces.length = 0;
        addFontFace.mockReset();
        resetLoadedGameFontsForTests();
        vi.stubGlobal('FontFace', FakeFontFace);
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { add: addFontFace },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves self-hosted game font sources through the renderer asset protocol', () => {
        expect(resolveGameFontSource('tactics/fonts/Cinzel Regular.woff2')).toBe(
            'chimera://renderer/game-assets/tactics/fonts/Cinzel%20Regular.woff2',
        );
    });

    it('loads declared game fonts with the FontFace API', async () => {
        await loadGameFonts([
            {
                family: 'Cinzel',
                src: 'tactics/fonts/Cinzel-Regular.woff2',
                weight: '700',
                style: 'normal',
                display: 'swap',
            },
        ]);

        expect(fakeFontFaces).toHaveLength(1);
        expect(fakeFontFaces[0]?.family).toBe('Cinzel');
        expect(fakeFontFaces[0]?.source).toBe(
            'url("chimera://renderer/game-assets/tactics/fonts/Cinzel-Regular.woff2") format("woff2")',
        );
        expect(fakeFontFaces[0]?.descriptors).toEqual({
            weight: '700',
            style: 'normal',
            display: 'swap',
        });
        expect(addFontFace).toHaveBeenCalledWith(fakeFontFaces[0]);
    });

    it('uses renderer defaults when optional descriptors are omitted', async () => {
        await loadGameFonts([{ family: 'Cinzel', src: 'tactics/fonts/Cinzel-Regular.woff2' }]);

        expect(fakeFontFaces[0]?.descriptors).toEqual({
            weight: '400',
            style: 'normal',
            display: 'swap',
        });
    });

    it('deduplicates repeated font faces by family, source, weight, and style', async () => {
        const font: GameFontFace = {
            family: 'Cinzel',
            src: 'tactics/fonts/Cinzel-Regular.woff2',
            weight: '400',
        };

        await loadGameFonts([font, font]);
        await loadGameFonts([font]);

        expect(fakeFontFaces).toHaveLength(1);
        expect(addFontFace).toHaveBeenCalledTimes(1);
    });

    it('rejects external Google font URLs at runtime', async () => {
        await expect(
            loadGameFonts([
                {
                    family: 'Cinzel',
                    src: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900',
                },
            ]),
        ).rejects.toThrow('Game font source must be a local game asset ref');
    });

    it('rejects protocol-relative and path-traversal font sources', async () => {
        await expect(
            loadGameFonts([{ family: 'Cinzel', src: '//fonts.gstatic.com/cinzel.woff2' }]),
        ).rejects.toThrow('Game font source must be a local game asset ref');

        await expect(
            loadGameFonts([{ family: 'Cinzel', src: 'tactics/../Cinzel-Regular.woff2' }]),
        ).rejects.toThrow('Game font source must be a local game asset ref');
    });

    it('does nothing when the browser font API is unavailable', async () => {
        vi.unstubAllGlobals();
        resetLoadedGameFontsForTests();
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: undefined,
        });

        await expect(
            loadGameFonts([{ family: 'Cinzel', src: 'tactics/fonts/Cinzel-Regular.woff2' }]),
        ).resolves.toBeUndefined();
        expect(fakeFontFaces).toHaveLength(0);
    });
});
