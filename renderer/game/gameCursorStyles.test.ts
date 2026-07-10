// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetWarmedGameImagesForTests } from './GameImageWarmup';
import { applyGameCursorOverrides } from './gameCursorStyles';

class FakeImage {
    public src = '';
    public decode = vi.fn(async (): Promise<void> => {
        events.push(`decode:${this.src}`);
    });

    public constructor() {
        fakeImages.push(this);
    }
}

const fakeImages: FakeImage[] = [];
const events: string[] = [];

describe('gameCursorStyles', () => {
    let setProperty: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fakeImages.length = 0;
        events.length = 0;
        resetWarmedGameImagesForTests();
        vi.stubGlobal('Image', FakeImage);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        setProperty = vi
            .spyOn(document.documentElement.style, 'setProperty')
            .mockImplementation((name: string): void => {
                events.push(`set:${name}`);
            });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('overrides each declared cursor token with the resolved texture, hotspot, and role fallback', async () => {
        await applyGameCursorOverrides('tactics', {
            default: { image: 'cursors/default.png' },
            pointer: { image: 'cursors/pointer.png', hotspot: { x: 4, y: 7 } },
            disabled: { image: 'cursors/disabled.png' },
        });

        expect(setProperty).toHaveBeenCalledTimes(3);
        expect(setProperty).toHaveBeenCalledWith(
            '--ch-cursor-default',
            'url(chimera://renderer/game-assets/tactics/cursors/default.png) 0 0, auto',
        );
        expect(setProperty).toHaveBeenCalledWith(
            '--ch-cursor-pointer',
            'url(chimera://renderer/game-assets/tactics/cursors/pointer.png) 4 7, pointer',
        );
        expect(setProperty).toHaveBeenCalledWith(
            '--ch-cursor-disabled',
            'url(chimera://renderer/game-assets/tactics/cursors/disabled.png) 0 0, not-allowed',
        );
    });

    it('overrides only the declared roles, leaving the other cursor tokens untouched', async () => {
        await applyGameCursorOverrides('tactics', {
            pointer: { image: 'cursors/pointer.png' },
        });

        expect(setProperty).toHaveBeenCalledTimes(1);
        expect(setProperty).toHaveBeenCalledWith(
            '--ch-cursor-pointer',
            'url(chimera://renderer/game-assets/tactics/cursors/pointer.png) 0 0, pointer',
        );
    });

    it('is a strict no-op without a declaration: no token writes, no textures warmed', async () => {
        await applyGameCursorOverrides('tactics', undefined);
        await applyGameCursorOverrides('tactics', {});

        expect(setProperty).not.toHaveBeenCalled();
        expect(fakeImages).toHaveLength(0);
    });

    it('warms (fetches + decodes) every declared texture before any token override applies', async () => {
        await applyGameCursorOverrides('tactics', {
            default: { image: 'cursors/default.png' },
            pointer: { image: 'cursors/pointer.png' },
        });

        const lastDecode = events.map((e) => e.startsWith('decode:')).lastIndexOf(true);
        const firstSet = events.map((e) => e.startsWith('set:')).indexOf(true);
        expect(lastDecode).toBeGreaterThanOrEqual(1);
        expect(firstSet).toBeGreaterThan(lastDecode);
    });

    it('still applies the overrides when a texture fails to decode (CSS fallback covers it)', async () => {
        class FlakyImage extends FakeImage {
            public override decode = vi.fn(async (): Promise<void> => {
                throw new Error('broken cursor texture');
            });
        }
        vi.stubGlobal('Image', FlakyImage);

        await applyGameCursorOverrides('tactics', {
            default: { image: 'cursors/default.png' },
        });

        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(setProperty).toHaveBeenCalledWith(
            '--ch-cursor-default',
            'url(chimera://renderer/game-assets/tactics/cursors/default.png) 0 0, auto',
        );
    });

    it.each([
        '/absolute/cursor.png',
        '//host/cursor.png',
        'https://cdn.example.com/cursor.png',
        '../escape.png',
        '',
    ])('rejects non-local cursor image %j without warming or writing any token', async (image) => {
        await expect(
            applyGameCursorOverrides('tactics', {
                default: { image: 'cursors/default.png' },
                pointer: { image },
            }),
        ).rejects.toThrow(`Game cursor source must be a local game asset ref: ${image}`);

        expect(setProperty).not.toHaveBeenCalled();
        expect(fakeImages).toHaveLength(0);
    });

    it('overwrites previous overrides when called again (game reload / re-injection)', async () => {
        await applyGameCursorOverrides('tactics', {
            pointer: { image: 'cursors/pointer.png' },
        });
        await applyGameCursorOverrides('tactics', {
            pointer: { image: 'cursors/pointer.png', hotspot: { x: 15, y: 1 } },
        });

        expect(setProperty).toHaveBeenLastCalledWith(
            '--ch-cursor-pointer',
            'url(chimera://renderer/game-assets/tactics/cursors/pointer.png) 15 1, pointer',
        );
    });

    it('is a no-op outside a DOM environment (no document)', async () => {
        vi.stubGlobal('document', undefined);

        await expect(
            applyGameCursorOverrides('tactics', {
                default: { image: 'cursors/default.png' },
            }),
        ).resolves.toBeUndefined();
        expect(fakeImages).toHaveLength(0);
    });
});
