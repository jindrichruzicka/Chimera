/**
 * e2e/helpers/route-trace.ts
 *
 * An in-page recorder for the routes a window VISITS.
 *
 * WHY A RECORDER RATHER THAN URL ASSERTIONS. `expect(page).toHaveURL()` samples
 * the URL that is current when the assertion runs, so a route entered and left
 * again within one commit never appears in any sample an out-of-process spec
 * can take. That is exactly the shape of the claim a lobby-less start has to
 * make: not "the window ends up in the match" — which a route sampled at the
 * end proves — but "the lobby was never passed THROUGH on the way".
 *
 * The verbs are WRAPPED rather than polled for the same reason. Next's app
 * router moves the window by calling `history.pushState` / `history.replaceState`,
 * so wrapping them records every hop at the moment it happens, where a
 * `requestAnimationFrame` sampler would miss any hop shorter than a frame — and
 * a missed hop reads exactly like a route that was never visited.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 *
 * Module boundary: `@playwright/test` types only. The recorder below is shipped
 * into the renderer as SOURCE TEXT by Playwright, so it must close over nothing
 * — every global it needs is reached through structural interfaces (this
 * program carries no DOM lib).
 */

import type { Page } from '@playwright/test';

interface RouteTraceStore {
    readonly urls: string[];
}

interface RouteTraceHost {
    __chimeraRouteTrace?: RouteTraceStore;
}

interface BrowserHistoryAccess {
    pushState(data: unknown, unused: string, url?: string | null): void;
    replaceState(data: unknown, unused: string, url?: string | null): void;
}

interface BrowserGlobalAccess {
    readonly location: { readonly pathname: string; readonly search: string };
    readonly history: BrowserHistoryAccess;
    addEventListener(type: string, listener: () => void): void;
}

/**
 * Installed into the page. Self-contained by necessity — Playwright ships this
 * function's source, so a reference to anything in this module would be
 * undefined at the far end.
 *
 * Idempotent, and load-bearingly so: a second install that wrapped the history
 * verbs again would append two entries per hop, turning one visit into two.
 */
function recordRouteTrace(): void {
    const browser = globalThis as unknown as BrowserGlobalAccess & RouteTraceHost;
    if (browser.__chimeraRouteTrace !== undefined) {
        return;
    }
    const store: RouteTraceStore = { urls: [] };
    browser.__chimeraRouteTrace = store;

    // Consecutive duplicates are dropped: a router that replaces the entry it
    // is already on has not moved the window, and counting it would make a
    // route look revisited. A genuine revisit still records, because the entry
    // before it is a different URL.
    const record = (): void => {
        const url = `${browser.location.pathname}${browser.location.search}`;
        if (store.urls[store.urls.length - 1] === url) {
            return;
        }
        store.urls.push(url);
    };

    record();

    const history = browser.history;
    const pushState = history.pushState.bind(history);
    const replaceState = history.replaceState.bind(history);
    // Recorded AFTER calling through, so `location` already holds the new URL.
    history.pushState = (data: unknown, unused: string, url?: string | null): void => {
        pushState(data, unused, url);
        record();
    };
    history.replaceState = (data: unknown, unused: string, url?: string | null): void => {
        replaceState(data, unused, url);
        record();
    };
    // Back/forward move the window without going through either verb. No
    // 'hashchange' listener beside it: the recorded URL is pathname + search, so
    // a fragment change records nothing a listener could add.
    browser.addEventListener('popstate', record);
}

/**
 * Arm the recorder in `page`'s CURRENT document, seeding the trace with the URL
 * the window is already on.
 *
 * A route that RELOADS the document drops the recorder, and nothing here would
 * say so — so no spec may assume one is armed across a navigation it did not
 * check. Every hop these specs record is a client-side push.
 */
export async function installRouteTrace(page: Page): Promise<void> {
    await page.evaluate(recordRouteTrace);
}

/** Read the recorded URLs out of `page`, in visit order. */
export async function readRouteTrace(page: Page): Promise<readonly string[]> {
    return page.evaluate(() => {
        const browser = globalThis as unknown as RouteTraceHost;
        const store = browser.__chimeraRouteTrace;
        if (store === undefined) {
            throw new Error(
                'The route trace recorder was not installed in this page — ' +
                    'installRouteTrace() must run before the navigation being measured.',
            );
        }
        return store.urls.slice();
    });
}

/**
 * The recorded URLs as bare route paths: query string dropped, the static
 * export's trailing slash dropped, and consecutive duplicates collapsed again —
 * two entries that differed only by `?gameId=` are one route.
 *
 * Kept separate from the recorder so a spec can assert on either: the raw trace
 * still carries the query, which is where `?gameId=` preservation is visible.
 */
export function visitedRoutePaths(trace: readonly string[]): readonly string[] {
    const paths: string[] = [];
    for (const url of trace) {
        const withoutQuery = url.split('?')[0] ?? '';
        const path =
            withoutQuery.length > 1 && withoutQuery.endsWith('/')
                ? withoutQuery.slice(0, -1)
                : withoutQuery;
        if (paths[paths.length - 1] === path) {
            continue;
        }
        paths.push(path);
    }
    return paths;
}
