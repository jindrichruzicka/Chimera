/**
 * §4.37.15 logo-screen.spec.ts
 * Issue #858 — Write Playwright E2E coverage for the game logo screen
 * Part of: #852 F70 — Game Logo Screen
 *
 * The packaged-only boot gate (`app.isPackaged && resolveGameLogoScreen(manifest)`
 * in electron/main/index.ts) keeps `/logo-screen` out of every default E2E boot,
 * so this spec drives the route directly instead of relying on boot routing.
 *
 * Assertions are limited to presence, skip, and navigation per the issue's
 * scope — no video playback frames, audio, or real-timeout timing.
 *
 * Invariant #96: the spec exercises the engine page only through the app's
 * `apps/tactics/renderer/app/logo-screen/page.tsx` shell re-export — it never
 * imports renderer internals directly.
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';
import {
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
} from '../../../../electron/main/renderer-url';
import { MainMenuPage } from '../pages/MainMenuPage';

const NAV_TIMEOUT_MS = 20_000;
const SHELL_LOAD_TIMEOUT_MS = 15_000;

function logoScreenUrl(gameId: string): string {
    const url = new URL(`${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/logo-screen/`);
    url.searchParams.set('gameId', gameId);
    return url.toString();
}

/**
 * Installs a pre-load init script that stops LogoVideoScreen from auto-advancing
 * off the media exit triggers, so the screen stays mounted for a presence/source
 * assertion instead of racing a fast decode `error`. Patches `HTMLMediaElement`
 * before any page script runs (so it lands before React attaches listeners):
 * `addEventListener` drops `ended`/`error` registrations, and `play()` resolves
 * so the autoplay-rejection skip path never fires. The e2e tsconfig ships no DOM
 * lib, so the browser globals are reached through a structural cast.
 */
async function freezeLogoVideoAutoAdvance(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const browser = globalThis as unknown as {
            HTMLMediaElement?: {
                prototype: {
                    addEventListener: (type: string, ...rest: unknown[]) => void;
                    play: () => Promise<void>;
                };
            };
        };
        const proto = browser.HTMLMediaElement?.prototype;
        if (proto === undefined) {
            return;
        }
        const originalAddEventListener = proto.addEventListener;
        proto.addEventListener = function patchedAddEventListener(
            type: string,
            ...rest: unknown[]
        ): void {
            if (type === 'ended' || type === 'error') {
                return;
            }
            originalAddEventListener.call(this, type, ...rest);
        };
        proto.play = function patchedPlay(): Promise<void> {
            return Promise.resolve();
        };
    });
}

test.describe('Game logo screen (§4.37 / #858)', () => {
    test('logo route mounts the brand video sourced from /chimera_logo.mp4', async ({
        mainWindow,
    }) => {
        // Scope is presence + source only (per the issue's "must NOT" list): no
        // playback-frame, audio, or real-timeout assertions.
        //
        // The logo screen is inherently transient: LogoVideoScreen auto-advances
        // (unmounting the element) on the video's `ended`/`error` events or a
        // rejected `play()`. The real 6s brand video usually leaves ample time,
        // but an intermittent decode `error` in headless Electron fires
        // `beginExit` in under a second — detaching the element before the
        // assertions run. Neutralise the media exit triggers before the page
        // loads so the screen stays mounted long enough to observe: drop the
        // element-level `ended`/`error` listeners React wires, and resolve
        // `play()` so the autoplay-rejection path stays silent. Only the 10s
        // watchdog timeout remains, well beyond these millisecond reads.
        await freezeLogoVideoAutoAdvance(mainWindow);
        await mainWindow.goto(logoScreenUrl('tactics'));

        await expect(mainWindow.getByTestId('logo-video-screen')).toBeVisible({
            timeout: NAV_TIMEOUT_MS,
        });

        const video = mainWindow.getByTestId('logo-video');
        await expect(video).toBeVisible();
        await expect(video).toHaveAttribute('src', '/chimera_logo.mp4');
    });

    test('hides the OS cursor while the brand screen is on-screen', async ({ mainWindow }) => {
        // The logo screen must show no cursor while it plays (RC polish); every
        // other screen keeps its system/game cursor. The suppression is a
        // computed CSS property (`cursor: none` via --ch-cursor-hidden), so it is
        // observable through getComputedStyle even though the OS cursor plane
        // itself is not captured in screenshots. Freeze the media exit triggers
        // first so the element stays mounted for the read.
        await freezeLogoVideoAutoAdvance(mainWindow);
        await mainWindow.goto(logoScreenUrl('tactics'));

        const logoScreen = mainWindow.getByTestId('logo-video-screen');
        await expect(logoScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });

        // The e2e tsconfig ships no DOM lib, so browser globals are reached
        // through a narrow structural cast.
        const cursor = await logoScreen.evaluate((element) => {
            const el = element as unknown as {
                readonly ownerDocument: {
                    readonly defaultView: {
                        getComputedStyle(target: unknown): { readonly cursor: string };
                    } | null;
                };
            };
            const view = el.ownerDocument.defaultView;
            if (!view) throw new Error('logo screen document has no defaultView');
            return view.getComputedStyle(element).cursor;
        });

        expect(cursor).toBe('none');
    });

    test('skip on input navigates to the main menu with gameId preserved', async ({
        mainWindow,
    }) => {
        await mainWindow.goto(logoScreenUrl('tactics'));
        await expect(mainWindow.getByTestId('logo-video-screen')).toBeVisible({
            timeout: NAV_TIMEOUT_MS,
        });

        // LogoVideoScreen wires the skip to a `window` 'keydown' listener only
        // (a mouse click must NOT skip), so dispatch the event on `window`
        // directly instead of a keyboard action on a locator. The real brand
        // video reaches its `ended`/`error` exit fast enough to race a keyboard
        // action (the screen fades out and detaches mid-action); a synchronous
        // `window`-level dispatch lands the skip the instant the screen is up,
        // before any auto-advance can win. The e2e tsconfig ships no DOM lib, so
        // browser globals are reached through a structural cast.
        await mainWindow.evaluate(() => {
            const browser = globalThis as unknown as {
                dispatchEvent: (event: unknown) => boolean;
                KeyboardEvent: new (
                    type: string,
                    init?: { bubbles?: boolean; key?: string },
                ) => unknown;
            };
            browser.dispatchEvent(
                new browser.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
            );
        });

        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=tactics$/, {
            timeout: NAV_TIMEOUT_MS,
        });

        const menu = new MainMenuPage(mainWindow);
        await expect
            .poll(() => menu.getButtonLabels(), { timeout: SHELL_LOAD_TIMEOUT_MS })
            .toContain('New Game');
    });

    test('unpackaged boot never lands on the logo route; the main menu resolves directly', async ({
        mainWindow,
    }) => {
        // The `mainWindow` fixture is the pristine, unnavigated default boot.
        // Under CHIMERA_E2E=1 the packaged-only boot gate (electron/main/
        // index.ts) never applies, so the window must not open on /logo-screen —
        // it boots to the root splash exactly as it did before F70.
        expect(mainWindow.url()).not.toContain('logo-screen');

        // And main-menu navigation still resolves straight to /main-menu.
        const menu = new MainMenuPage(mainWindow);
        await menu.goto();

        await expect(menu.menu).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        expect(mainWindow.url()).not.toContain('logo-screen');
        await expect(mainWindow).toHaveURL(/\/main-menu\/?$/);
    });
});
