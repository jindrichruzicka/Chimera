// shared/asset-ref-parse.ts
// §4.10 — Parsing utilities for AssetRef strings.
//
// Extracted into `shared/` so that both `simulation/content/` and
// `renderer/assets/` can import these without violating the module-boundary
// rule that restricts `renderer/` to type-only imports from `simulation/`.
//
// Zero dependencies — pure string logic, no Three.js, no DOM, no electron.

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Returns true when the gameId or relativePath contain path-traversal
 * components that would allow escaping the assets root when resolved by
 * the AssetManager (F10). Pure string check — no filesystem access.
 *
 * Rejects:
 *   - empty gameId (would produce a filesystem-absolute-looking ref)
 *   - gameId containing `/` (would embed a directory separator)
 *   - relativePath starting with `/` (absolute path injection)
 *   - relativePath containing `..` as a path segment (directory traversal)
 *   - NUL bytes in either argument (filesystem escape on some OS)
 */
export function isTraversalUnsafe(gameId: string, relativePath: string): boolean {
    if (gameId.length === 0) return true;
    if (gameId === '..' || gameId === '.') return true;
    if (gameId.includes('/') || gameId.includes('\0')) return true;
    if (relativePath.length === 0) return true;
    if (relativePath.startsWith('/')) return true;
    if (relativePath.includes('\0')) return true;
    // Check each segment for '..'
    const segments = relativePath.split('/');
    return segments.some((s) => s === '..');
}

// ---------------------------------------------------------------------------
// MalformedAssetRefError
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link parseAssetRef} when a string does not conform to the
 * `"<game-id>/<relative/path.ext>"` format.
 */
export class MalformedAssetRefError extends Error {
    /** The raw string that could not be parsed. */
    public readonly ref: string;

    constructor(ref: string) {
        super(`AssetRef '${ref}' is malformed — expected format: 'game-id/relative/path.ext'`);
        this.name = 'MalformedAssetRefError';
        this.ref = ref;
        // Maintain proper prototype chain in environments that transpile classes.
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ---------------------------------------------------------------------------
// parseAssetRef — decompose an AssetRef string
// ---------------------------------------------------------------------------

/**
 * Decompose an AssetRef string into its `gameId` and `relativePath` parts.
 *
 * Accepts a plain `string` so that this utility can be used by both
 * `simulation/content/AssetRef.ts` and `renderer/assets/AssetResolver.ts`
 * without creating a cross-boundary value import. Callers in `simulation/`
 * are encouraged to use the typed overload exported from
 * `simulation/content/AssetRef.ts` instead.
 *
 * @throws {MalformedAssetRefError} When the ref does not contain a `/`, when
 *   the slash appears at position 0 (empty game id), or when the ref contains
 *   path-traversal components (`..`, absolute paths, NUL bytes).
 */
export function parseAssetRef(ref: string): {
    readonly gameId: string;
    readonly relativePath: string;
} {
    const slash = ref.indexOf('/');
    if (slash < 1) throw new MalformedAssetRefError(ref);
    const gameId = ref.slice(0, slash);
    const relativePath = ref.slice(slash + 1);
    if (isTraversalUnsafe(gameId, relativePath)) {
        throw new MalformedAssetRefError(ref);
    }
    return { gameId, relativePath };
}
