// renderer/shell/shellRoutes.ts
//
// The pure route vocabulary the shell-route consumers share (§4.37.17): the
// path normalizer, the engine's own route tree, and the declared-route matcher.
// Kept out of the components so `ShellBackgroundHost` (a background mount) and
// `GameStoreBootstrap` (a navigation gate) decide membership by ONE definition
// rather than two comparisons that could drift apart.
//
// Why a normalizer at all: the renderer is a Next static export with
// `trailingSlash: true`, so the pathname the router reports for a game page
// declared as `'/credits'` is `/credits/` — and the packaged app can also serve
// it as `/credits/index.html`. A naive `'/credits' === pathname` check would
// silently never match, which is exactly the failure a missing background or a
// stranded match would look like.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract

/**
 * Every route the ENGINE's own `renderer/app/` tree ships. A game's declared
 * shell route is by definition a page the engine does not ship, so membership
 * here is what lets a consumer decide whether a route could be a game page
 * BEFORE the shell payload carrying the declaration has resolved.
 *
 * Pinned against the real `renderer/app/` page tree by
 * `tools/shell-page-routes.test.ts` — an added or removed engine route that
 * skips this set fails there rather than quietly changing what counts as a
 * candidate game page.
 */
export const ENGINE_OWNED_ROUTES: ReadonlySet<string> = new Set([
    '/',
    '/component-gallery',
    '/debug',
    '/game',
    '/lobby',
    '/logo-screen',
    '/main-menu',
    '/replays',
    '/replays/player',
    '/saves',
    '/settings',
]);

/** The suffix the packaged static export appends when a route is served as a file. */
const EXPORT_INDEX_SUFFIX = '/index.html';

/**
 * One canonical spelling for a route path: no trailing slash, no
 * `/index.html`, and `'/'` for an absent path. Both sides of every shell-route
 * comparison go through this.
 */
export function normalizeRoutePath(pathname: string | null | undefined): string {
    if (pathname === null || pathname === undefined || pathname.length === 0) {
        return '/';
    }

    const withoutIndexHtml = pathname.endsWith(EXPORT_INDEX_SUFFIX)
        ? pathname.slice(0, -EXPORT_INDEX_SUFFIX.length)
        : pathname;

    if (withoutIndexHtml.length === 0) {
        return '/';
    }

    return withoutIndexHtml.length > 1 && withoutIndexHtml.endsWith('/')
        ? withoutIndexHtml.slice(0, -1)
        : withoutIndexHtml;
}

/** Whether the route is one the engine's own app tree ships (any spelling). */
export function isEngineOwnedRoute(pathname: string | null | undefined): boolean {
    return ENGINE_OWNED_ROUTES.has(normalizeRoutePath(pathname));
}

/**
 * Whether the current path is one of the game's declared shell routes.
 * BOTH sides are normalized: a game may declare `'/credits'` or `'/credits/'`,
 * and the router may report either — all four combinations must agree.
 */
export function matchesDeclaredShellRoute(
    pathname: string | null | undefined,
    shellRoutes: readonly string[] | undefined,
): boolean {
    if (
        shellRoutes === undefined ||
        shellRoutes.length === 0 ||
        pathname === null ||
        pathname === undefined
    ) {
        return false;
    }

    const routePath = normalizeRoutePath(pathname);
    return shellRoutes.some((declared) => normalizeRoutePath(declared) === routePath);
}
