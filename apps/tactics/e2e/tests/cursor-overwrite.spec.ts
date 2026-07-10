/**
 * Hardware-cursor placeholder-overwrite contract (F69 #848).
 *
 * The committed cursor PNGs are deliberate placeholders: the contract is
 * that overwriting one with different art — with ZERO code change — changes
 * the runtime cursor on the next launch. Two halves are locked here against
 * a launch whose game-assets root is a scratch copy of `apps/tactics/assets`
 * with `default.png` swapped for solid red:
 *
 *  1. the injected `--ch-cursor-default` token is byte-for-byte identical to
 *     the normal launch (the art swap needs no code change), and
 *  2. the texture served over the protocol carries the NEW bytes (pixel
 *     probe), while the untouched `pointer.png` stays the white placeholder.
 *
 * This also guards the mechanics the contract rests on: no cache headers on
 * the protocol handler and no cache-busting in the injected url.
 */
import { cpSync, writeFileSync } from 'node:fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { expect, launchE2eElectronApplication, test } from '../fixtures/electron.fixture';
import { encodeSolidPng } from '../helpers/solid-png';
import { MainMenuPage } from '../pages/MainMenuPage';

// The e2e tsconfig carries no DOM lib (suite convention): in-page access
// goes through narrow structural views of the browser globals.
interface BrowserInlineStyleAccess {
    getPropertyValue(name: string): string;
}

interface BrowserDecodableImage {
    src: string;
    readonly naturalWidth: number;
    readonly naturalHeight: number;
    decode(): Promise<void>;
}

interface BrowserCanvasContext2d {
    drawImage(image: BrowserDecodableImage, dx: number, dy: number): void;
    getImageData(
        x: number,
        y: number,
        width: number,
        height: number,
    ): { readonly data: ArrayLike<number> };
}

interface BrowserCanvasElement {
    width: number;
    height: number;
    getContext(contextId: '2d'): BrowserCanvasContext2d | null;
}

interface BrowserPixelProbeGlobal {
    readonly Image: new () => BrowserDecodableImage;
    readonly document: {
        readonly documentElement: { readonly style: BrowserInlineStyleAccess };
        createElement(tagName: 'canvas'): BrowserCanvasElement;
    };
}

const DEFAULT_CURSOR_URL = 'chimera://renderer/game-assets/tactics/cursors/default.png';
const POINTER_CURSOR_URL = 'chimera://renderer/game-assets/tactics/cursors/pointer.png';

interface CenterPixelProbe {
    readonly width: number;
    readonly height: number;
    readonly r: number;
    readonly g: number;
    readonly b: number;
}

/** Decode the texture in-page and sample its center pixel. */
async function probeCenterPixel(page: Page, url: string): Promise<CenterPixelProbe> {
    return page.evaluate(async (textureUrl) => {
        const browser = globalThis as unknown as BrowserPixelProbeGlobal;
        const image = new browser.Image();
        image.src = textureUrl;
        await image.decode();

        const canvas = browser.document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) {
            throw new Error('2d canvas context unavailable for cursor pixel probe');
        }
        context.drawImage(image, 0, 0);
        const center = context.getImageData(
            Math.floor(image.naturalWidth / 2),
            Math.floor(image.naturalHeight / 2),
            1,
            1,
        ).data;
        return {
            width: image.naturalWidth,
            height: image.naturalHeight,
            r: center[0] ?? -1,
            g: center[1] ?? -1,
            b: center[2] ?? -1,
        };
    }, url);
}

test.describe('Hardware cursor placeholder-overwrite contract', () => {
    // eslint-disable-next-line no-empty-pattern -- the spec launches its own app; no shared fixture is consumed
    test('overwriting a cursor PNG with different art changes the runtime cursor without a code change', async ({}, testInfo) => {
        // Scratch game-assets root mirroring <root>/tactics/{data,assets}.
        // BOTH subtrees are required: the main process fatally loads the
        // content DB from <root>/tactics/data at startup, and the protocol
        // handler serves textures from <root>/tactics/assets (injecting the
        // `assets` segment itself). The whole assets tree is copied so
        // fonts/audio keep resolving during shell boot.
        const scratchRoot = testInfo.outputPath('game-assets');
        cpSync(path.resolve(__dirname, '../../data'), path.join(scratchRoot, 'tactics', 'data'), {
            recursive: true,
        });
        cpSync(
            path.resolve(__dirname, '../../assets'),
            path.join(scratchRoot, 'tactics', 'assets'),
            { recursive: true },
        );
        writeFileSync(
            path.join(scratchRoot, 'tactics', 'assets', 'cursors', 'default.png'),
            encodeSolidPng(32, 32, { r: 255, g: 0, b: 0, a: 255 }),
        );

        const app = await launchE2eElectronApplication({
            port: '7781',
            gameAssetsRoot: scratchRoot,
        });
        try {
            const window = await app.firstWindow();
            await window.waitForLoadState('domcontentloaded');
            await new MainMenuPage(window).goto({ gameId: 'tactics' });

            // Half 1: the injected token is unchanged — same url, no busting.
            await expect
                .poll(
                    () =>
                        window.evaluate(() => {
                            const browser = globalThis as unknown as BrowserPixelProbeGlobal;
                            return browser.document.documentElement.style.getPropertyValue(
                                '--ch-cursor-default',
                            );
                        }),
                    { timeout: 15_000 },
                )
                .toBe(`url(${DEFAULT_CURSOR_URL}) 0 0, auto`);

            // Half 2: the served texture carries the swapped red art.
            // Thresholds instead of exact bytes — color management may drift
            // channel values slightly on decode.
            const swapped = await probeCenterPixel(window, DEFAULT_CURSOR_URL);
            expect(swapped.width, 'swapped default.png decodes at 32px').toBe(32);
            expect(swapped.height).toBe(32);
            expect(swapped.r, 'swapped art is red').toBeGreaterThan(200);
            expect(swapped.g).toBeLessThan(50);
            expect(swapped.b).toBeLessThan(50);

            // Negative control: the untouched pointer.png is still the solid
            // white placeholder.
            const untouched = await probeCenterPixel(window, POINTER_CURSOR_URL);
            expect(untouched.r, 'untouched placeholder stays white').toBeGreaterThan(200);
            expect(untouched.g).toBeGreaterThan(200);
            expect(untouched.b).toBeGreaterThan(200);
        } finally {
            await app.close();
        }
    });
});
