// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    resetWarmedGameImagesForTests,
    resolveGameImageSource,
    warmGameImages,
} from './GameImageWarmup';

class FakeImage {
    public src = '';
    public decode = vi.fn(async (): Promise<void> => undefined);

    public constructor() {
        fakeImages.push(this);
    }
}

const fakeImages: FakeImage[] = [];

describe('GameImageWarmup', () => {
    beforeEach(() => {
        fakeImages.length = 0;
        resetWarmedGameImagesForTests();
        vi.stubGlobal('Image', FakeImage);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('resolves game image sources through the renderer asset protocol', () => {
        expect(resolveGameImageSource('tactics/images/menu hero.png')).toBe(
            'chimera://renderer/game-assets/tactics/images/menu%20hero.png',
        );
    });

    it.each(['/absolute/logo.png', '//host/logo.png', 'https://cdn.example.com/logo.png'])(
        'rejects non-local image source %s',
        (src) => {
            expect(() => resolveGameImageSource(src)).toThrow(
                `Game image source must be a local game asset ref: ${src}`,
            );
        },
    );

    it('warms each declared image: fetch starts via src and the bitmap is decoded', async () => {
        await warmGameImages(['tactics/images/hero.png', 'tactics/images/banner.png']);

        expect(fakeImages.map((image) => image.src)).toEqual([
            'chimera://renderer/game-assets/tactics/images/hero.png',
            'chimera://renderer/game-assets/tactics/images/banner.png',
        ]);
        for (const image of fakeImages) {
            expect(image.decode).toHaveBeenCalledTimes(1);
        }
    });

    it('deduplicates already-warmed sources across calls', async () => {
        await warmGameImages(['tactics/images/hero.png']);
        await warmGameImages(['tactics/images/hero.png', 'tactics/images/banner.png']);

        expect(fakeImages.map((image) => image.src)).toEqual([
            'chimera://renderer/game-assets/tactics/images/hero.png',
            'chimera://renderer/game-assets/tactics/images/banner.png',
        ]);
    });

    it('a failed decode is soft (warns, resolves) and the source is retried on the next call', async () => {
        let shouldFail = true;
        class FlakyImage extends FakeImage {
            public override decode = vi.fn(async (): Promise<void> => {
                if (shouldFail) {
                    throw new Error('broken image');
                }
            });
        }
        vi.stubGlobal('Image', FlakyImage);

        await expect(warmGameImages(['tactics/images/hero.png'])).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalledTimes(1);

        shouldFail = false;
        await warmGameImages(['tactics/images/hero.png']);
        expect(fakeImages).toHaveLength(2);
    });

    it('is a no-op outside a browser image environment (no Image constructor)', async () => {
        vi.stubGlobal('Image', undefined);
        await expect(warmGameImages(['tactics/images/hero.png'])).resolves.toBeUndefined();
    });
});
