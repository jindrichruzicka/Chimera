// renderer/shell/shellRoutes.ts
//
// The pure route vocabulary the shell-route consumers share (§4.37.17): the
// path normalizer, the engine's own route tree, and the declared-route matcher.
// Kept out of the components because the surface a route IS has exactly one
// definition (`classifyShellSurface` below) and exactly one caller
// (`ShellStateBridge`), which publishes the answer on the shell-state store for
// the background mount, the navigation gate and a game's own pages to read.
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
 * What the player is looking at, as a closed vocabulary rather than a pathname
 * (§4.37.18). This is the shape a game's background or page reacts to, so it
 * names screens and not files: a game that wants to dim on the settings screen
 * asks for `'settings'` and stays correct if that route is ever re-pathed.
 *
 * Two members carry more than their name suggests, and both are deliberate:
 *
 *   - `'replay-player'` is split from `'replays'` because the reverse
 *     navigation gate acts on the PLAYER route (a post-game replay opened over
 *     a still-live session) and not on the browser. One member for both would
 *     widen a gate that was scoped on purpose.
 *   - `'boot'` is the catch-all: the pre-classification initial state, the
 *     boot routes (`/`, `/logo-screen`), the engine developer routes
 *     (`/debug`, `/component-gallery`), and any non-engine route the active
 *     game has NOT declared. What they share is that no shell surface belongs
 *     to them — a background does not mount, and the navigation gate does not
 *     admit them.
 */
export type ShellSurface =
    | 'boot'
    | 'main-menu'
    | 'settings'
    | 'lobby'
    | 'saves'
    | 'replays'
    | 'replay-player'
    | 'page'
    | 'match';

/**
 * Which surface each engine route IS. The single definition of both facts the
 * shell needs about the engine's own tree: what a route classifies as, and
 * — through `ENGINE_OWNED_ROUTES` below, whose members are exactly this map's
 * keys — whether a route is one the engine ships at all. Adding an engine page
 * therefore forces a surface decision rather than letting it default to a
 * declared-page candidate.
 */
export const ENGINE_ROUTE_SURFACES: ReadonlyMap<string, ShellSurface> = new Map([
    ['/', 'boot'],
    ['/component-gallery', 'boot'],
    ['/debug', 'boot'],
    ['/game', 'match'],
    ['/lobby', 'lobby'],
    ['/logo-screen', 'boot'],
    ['/main-menu', 'main-menu'],
    ['/replays', 'replays'],
    ['/replays/player', 'replay-player'],
    ['/saves', 'saves'],
    ['/settings', 'settings'],
]);

/**
 * Every route the ENGINE's own `renderer/app/` tree ships — the keys of the
 * map above, so the two cannot disagree. A game's declared shell route is by
 * definition a page the engine does not ship, so membership here is what lets a
 * consumer decide whether a route could be a game page BEFORE the shell payload
 * carrying the declaration has resolved.
 *
 * Pinned against the real `renderer/app/` page tree by
 * `tools/shell-page-routes.test.ts` — an added or removed engine route that
 * skips this set fails there rather than quietly changing what counts as a
 * candidate game page.
 */
export const ENGINE_OWNED_ROUTES: ReadonlySet<string> = new Set(ENGINE_ROUTE_SURFACES.keys());

/**
 * The surfaces that carry the shell background (§4.37.9): the three engine
 * screens it has always mounted on, plus every game-declared page — which is
 * what keeps ONE pinned background instance alive across
 * `/main-menu → /<game page> → /settings`.
 *
 * A set of SURFACES rather than of routes, so reading it is not a
 * classification: the pathname has already been turned into a surface by the
 * time anything consults this.
 */
export const SHELL_BACKGROUND_SURFACES: ReadonlySet<ShellSurface> = new Set<ShellSurface>([
    'main-menu',
    'settings',
    'lobby',
    'page',
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

/**
 * The route classification, as ONE function: which shell surface `pathname`
 * is, given what the active game declares.
 *
 * An engine route answers from {@link ENGINE_ROUTE_SURFACES} alone — no
 * declaration can turn `/game` into a game page, which is also why the answer
 * for one is available BEFORE the shell payload carrying `shellRoutes` has
 * resolved. Everything else is a `'page'` when the game declared it and
 * `'boot'` when it did not: an undeclared route is a page the engine knows
 * nothing about, so it gets no background and no navigation gate.
 *
 * `ShellStateBridge` is the only caller in renderer source — pinned by
 * `renderer/shell/__tests__/route-classification-census.test.ts`.
 */
export function classifyShellSurface(
    pathname: string | null | undefined,
    shellRoutes: readonly string[] | undefined,
): ShellSurface {
    const routePath = normalizeRoutePath(pathname);
    const engineSurface = ENGINE_ROUTE_SURFACES.get(routePath);
    if (engineSurface !== undefined) {
        return engineSurface;
    }
    return matchesDeclaredShellRoute(routePath, shellRoutes) ? 'page' : 'boot';
}
