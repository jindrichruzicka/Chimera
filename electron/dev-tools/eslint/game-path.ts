/**
 * electron/dev-tools/eslint/game-path.ts
 *
 * "Is this import specifier a game?" — the one answer three `chimera/*` rules
 * share: `no-shell-games-import` (Invariants #80/#93/#94),
 * `no-main-games-import` (main-process game boundary) and
 * `no-dynamic-games-import` (the dynamic position of the per-zone
 * `no-restricted-imports` game bans).
 *
 * It lives beside the plugin index rather than under `rules/`; `index.test.ts`
 * records why and enforces it.
 *
 * Architecture reference: §3 Module Boundaries. Invariant #1.
 */

/**
 * Engine packages — game-agnostic, importable anywhere the boundary allows an
 * engine dependency at all. Every other `@chimera-engine/*` package is a game
 * (e.g. `@chimera-engine/tactics`).
 */
const ENGINE_PACKAGES: ReadonlySet<string> = new Set([
    'simulation',
    'ai',
    'networking',
    'renderer',
    'electron',
]);

/**
 * A path that enters the game-app tree by name: an `apps/` or `games/` path
 * SEGMENT, leading or embedded (`apps/…`, `../../apps/…`). `apps/` is a game's
 * on-disk home; `games/` is the legacy home, matched so the old form stays
 * rejected. Anchored at BOTH ends, so neither a prefix lookalike
 * (`…/webapps/…`) nor a suffix one (`…/gamestate.js`) is read as a game.
 */
const GAME_PATH_SEGMENT_RE = /(?:^|\/)(?:apps|games)\//u;

/**
 * True if `source` names a game (rather than an engine package):
 *   - a relative/bare `apps/*` or `games/*` path (`apps/…`, `…/apps/…`), or
 *   - a `@chimera-engine/<pkg>` package whose `<pkg>` is NOT an engine package
 *     (e.g. `@chimera-engine/tactics`).
 *
 * Detecting games by the engine allowlist — rather than a directory substring
 * alone — keeps the guard correct for games that are first-class
 * `@chimera-engine/<game>` packages; the path arm keeps it correct for the same
 * game reached by its on-disk `apps/<name>/` location, which carries no scoped
 * specifier at all.
 *
 * The specifier TEXT is what is classified, never a resolved path.
 */
export function isGamesImport(source: string): boolean {
    const n = source.replace(/\\/gu, '/');
    if (GAME_PATH_SEGMENT_RE.test(n)) {
        return true;
    }
    const scoped = /^@chimera-engine\/([^/]+)/u.exec(n);
    if (scoped === null) {
        return false;
    }
    const pkg = scoped[1];
    return pkg !== undefined && !ENGINE_PACKAGES.has(pkg);
}

/**
 * True if `source` references a game's `styles/tokens-override.css` — by any of
 * the ways a game is named (see `isGamesImport`).
 */
export function isTokensOverrideImport(source: string): boolean {
    const n = source.replace(/\\/gu, '/');
    return /(?:^|\/)styles\/tokens-override\.css$/u.test(n) && isGamesImport(n);
}
