/**
 * Token-substitution engine for the `create-chimera-game` scaffolder (F65).
 *
 * Blank-template files embed named placeholders in both their contents and their paths; the
 * scaffolder swaps each for the matching {@link GameNames} casing. Keeping the placeholder
 * vocabulary in one map ({@link GAME_TOKENS}) means content substitution, path renaming, and
 * the leftover-token check all agree on exactly which tokens exist.
 *
 * Pure module: no `fs`, no `process`, no CLI concerns, no `@chimera/*` imports.
 */

import type { GameNames } from './normalize';

/**
 * The placeholder vocabulary, mapping each literal template token to the {@link GameNames}
 * casing it expands to. The token spellings double as a worked example of each casing.
 */
export const GAME_TOKENS = {
    __game_kebab__: 'kebab',
    __gameCamel__: 'camel',
    __GamePascal__: 'pascal',
    '__Game Title__': 'title',
    __GAME_CONSTANT__: 'constant',
    __gamelower__: 'lower',
} as const satisfies Record<string, keyof GameNames>;

/**
 * Replace every {@link GAME_TOKENS} placeholder in `text` with the corresponding game casing.
 *
 * Substitution is order-independent and idempotent: each token is matched as an exact literal,
 * and no casing value ever contains `__` (CONSTANT_CASE uses single underscores), so a
 * replacement can never re-introduce another token.
 */
export function substituteTokens(text: string, names: GameNames): string {
    let result = text;
    for (const [token, casing] of Object.entries(GAME_TOKENS)) {
        result = result.split(token).join(names[casing]);
    }
    return result;
}

/**
 * Rename a template path by substituting tokens within each `/`-delimited segment. The
 * result is identical to running {@link substituteTokens} on the whole path (no casing value
 * contains `/`); operating per segment keeps the intent — renaming file/directory names —
 * explicit.
 */
export function renameTokensInPath(path: string, names: GameNames): string {
    return path
        .split('/')
        .map((segment) => substituteTokens(segment, names))
        .join('/');
}

/**
 * Return the known {@link GAME_TOKENS} placeholders still present in `text` (in declaration
 * order) — empty when substitution is complete. Used as an idempotency/coverage check.
 *
 * It matches only the canonical token literals rather than a generic `/__…__/` pattern, so it
 * never mistakes legitimate dunders in boilerplate (e.g. `__dirname`, `__filename`) for
 * unsubstituted placeholders.
 */
export function findLeftoverTokens(text: string): string[] {
    return Object.keys(GAME_TOKENS).filter((token) => text.includes(token));
}
