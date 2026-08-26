// @vitest-environment jsdom
/**
 * e2e/helpers/route-trace.test.ts
 *
 * Unit tests for the in-page route recorder — see `route-trace.ts` for why one
 * exists at all.
 *
 * What it can get silently wrong is pinned here rather than inside a 90 s
 * Playwright run: that every history verb the app router uses is recorded, that
 * a re-entry of the same URL is not counted twice, and that installing twice
 * neither restarts the trace nor double-wraps the history verbs (which would
 * append two entries per hop and make a single visit look like two).
 *
 * jsdom, because the recorder body is DOM code and needs a real document and a
 * real session history to run against.
 *
 * The Page double below does not call the recorder — it SERIALISES it and
 * evaluates the source, which is what Playwright does. That difference is the
 * point: called directly, a recorder that closed over a module-scope binding
 * would work here and throw `ReferenceError` in the renderer, and the
 * no-closure rule `route-trace.ts` states in its header would be pinned by
 * nothing. What the round-trip catches is a LIVE reference, which is the whole
 * of what can reach the renderer: the transform eliminates a dead one before
 * `toString()` ever sees it.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 *
 * Tests written FIRST (red confirmed before implementation).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { installRouteTrace, readRouteTrace, visitedRoutePaths } from './route-trace';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * A Page whose `evaluate` ships the callback's SOURCE and evaluates it in this
 * process, against jsdom's document — the way Playwright delivers it, rather
 * than the way a direct call would. See the file header: a reference to
 * anything outside the function body survives a direct call and throws in the
 * renderer, so the source round-trip is what makes that reachable here.
 */
function makePage(): Page {
    return {
        evaluate: vi.fn(async (fn: () => unknown) =>
            // @chimera-review: intentional Function construction — evaluating the
            //   recorder's SOURCE is exactly what Playwright does, and reproducing that
            //   is the property under test; the input is this repo's own module text,
            //   never anything a test subject supplies.
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            (new Function(`return (${fn.toString()})();`) as () => unknown)(),
        ),
        // @chimera-review: partial mock of Page (Playwright external class) — only evaluate() is exercised
    } as unknown as Page;
}

/**
 * The browser globals this file drives, reached structurally rather than
 * through the `dom` lib: `apps/tactics/e2e/**` is deliberately excluded from
 * the app's DOM/react program and type-checked by the root flat `tsc --noEmit`,
 * which carries no DOM lib. Same shape the recorder itself uses.
 */
interface TestHistory {
    pushState(data: unknown, unused: string, url?: string | null): void;
    replaceState(data: unknown, unused: string, url?: string | null): void;
    back(): void;
}

interface TestBrowser {
    readonly history: TestHistory;
    __chimeraRouteTrace?: unknown;
}

const browser = globalThis as unknown as TestBrowser;

beforeEach(() => {
    browser.history.replaceState({}, '', '/main-menu/?gameId=tactics');
});

afterEach(() => {
    Reflect.deleteProperty(browser, '__chimeraRouteTrace');
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

describe('installRouteTrace / readRouteTrace', () => {
    it('seeds the trace with the URL the window is already on', async () => {
        const page = makePage();

        await installRouteTrace(page);

        await expect(readRouteTrace(page)).resolves.toEqual(['/main-menu/?gameId=tactics']);
    });

    it('records a pushState hop, query string included', async () => {
        const page = makePage();
        await installRouteTrace(page);

        browser.history.pushState({}, '', '/game/?gameId=tactics');

        await expect(readRouteTrace(page)).resolves.toEqual([
            '/main-menu/?gameId=tactics',
            '/game/?gameId=tactics',
        ]);
    });

    it('records a replaceState hop — a router that replaces still moved the window', async () => {
        const page = makePage();
        await installRouteTrace(page);

        browser.history.replaceState({}, '', '/lobby/?gameId=tactics');

        await expect(readRouteTrace(page)).resolves.toEqual([
            '/main-menu/?gameId=tactics',
            '/lobby/?gameId=tactics',
        ]);
    });

    it('records a back navigation', async () => {
        const page = makePage();
        await installRouteTrace(page);
        browser.history.pushState({}, '', '/game/?gameId=tactics');

        browser.history.back();

        // Polled rather than slept on: a traversal is queued by the session
        // history, and a fixed sleep would be either flaky or slow.
        await vi.waitFor(async () => {
            await expect(readRouteTrace(page)).resolves.toEqual([
                '/main-menu/?gameId=tactics',
                '/game/?gameId=tactics',
                '/main-menu/?gameId=tactics',
            ]);
        });
    });

    it('does not count a re-entry of the URL already current as a second visit', async () => {
        const page = makePage();
        await installRouteTrace(page);

        browser.history.replaceState({}, '', '/main-menu/?gameId=tactics');
        browser.history.pushState({}, '', '/main-menu/?gameId=tactics');

        await expect(readRouteTrace(page)).resolves.toEqual(['/main-menu/?gameId=tactics']);
    });

    it('leaves the history verbs working — the wrapper calls through', async () => {
        const page = makePage();
        await installRouteTrace(page);

        browser.history.pushState({}, '', '/game/?gameId=tactics');

        // Read back through the recorder, which reads `location` — so a wrapper
        // that swallowed the call would show the OLD url here.
        await expect(readRouteTrace(page)).resolves.toContain('/game/?gameId=tactics');
    });

    it('is idempotent: a second install neither restarts the trace nor double-records', async () => {
        const page = makePage();
        await installRouteTrace(page);
        browser.history.pushState({}, '', '/game/?gameId=tactics');

        await installRouteTrace(page);
        browser.history.pushState({}, '', '/saves/?gameId=tactics');

        // Two entries for `/saves` would mean the history verb was wrapped
        // twice; a trace starting at `/game` would mean the store was replaced.
        await expect(readRouteTrace(page)).resolves.toEqual([
            '/main-menu/?gameId=tactics',
            '/game/?gameId=tactics',
            '/saves/?gameId=tactics',
        ]);
    });

    it('refuses to read a trace that was never installed', async () => {
        await expect(readRouteTrace(makePage())).rejects.toThrow(/installRouteTrace/);
    });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('visitedRoutePaths', () => {
    it('strips the query string and the export trailing slash', () => {
        expect(visitedRoutePaths(['/main-menu/?gameId=tactics', '/game/?gameId=tactics'])).toEqual([
            '/main-menu',
            '/game',
        ]);
    });

    it('keeps the root path, which is only a trailing slash', () => {
        expect(visitedRoutePaths(['/'])).toEqual(['/']);
    });

    it('accepts a path already written without the trailing slash', () => {
        expect(visitedRoutePaths(['/game'])).toEqual(['/game']);
    });

    it('collapses visits that differ only in the query — one route, one entry', () => {
        expect(
            visitedRoutePaths(['/settings/', '/settings/?gameId=tactics', '/main-menu/']),
        ).toEqual(['/settings', '/main-menu']);
    });

    it('keeps a route revisited after leaving it', () => {
        expect(visitedRoutePaths(['/main-menu/', '/game/', '/main-menu/'])).toEqual([
            '/main-menu',
            '/game',
            '/main-menu',
        ]);
    });
});
