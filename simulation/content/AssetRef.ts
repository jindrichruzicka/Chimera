// simulation/content/AssetRef.ts
// §4.8 / §4.10 — Typed asset reference primitives.
//
// AssetRef<T> is a phantom-typed branded string of the form
// "<game-id>/<relative-path-under-assets/>".
// Examples:
//   "tactics/textures/units/warrior-portrait.webp"
//   "tactics/models/units/warrior.glb"
//   "tactics/audio/sfx/sword-hit.ogg"
//
// The simulation stores and passes these strings but NEVER resolves them.
// Only the renderer's AssetManager converts an AssetRef into a loaded asset.
//
// Invariants: #1 (no renderer / DOM / Three.js deps), #20 (simulation never
// resolves AssetRef values — they remain opaque strings to the engine).

// ---------------------------------------------------------------------------
// Phantom asset-kind types — compile-time documentation only; no runtime
// representation. The renderer maps these to actual loader output types.
//
// Each kind carries a unique nominal `__kind` literal brand so that
// AssetRef<TextureAsset> and AssetRef<AudioClipAsset> are mutually
// incompatible types (H1 hardening).
// ---------------------------------------------------------------------------

/** → THREE.Texture */
export interface TextureAsset {
    readonly __kind: 'texture';
}
/** → AudioBuffer (Web Audio API) */
export interface AudioClipAsset {
    readonly __kind: 'audio-clip';
}
/** → GLTF (drei or three/examples/jsm) */
export interface GLTFModelAsset {
    readonly __kind: 'gltf-model';
}
/** → THREE.Texture + SpriteAtlas frame map */
export interface SpriteSheetAsset {
    readonly __kind: 'sprite-sheet';
}
/** → plain JSON (no Three.js dependency at all) */
export interface ParticleConfigAsset {
    readonly __kind: 'particle-config';
}

/** Union of all recognised asset kinds. */
export type AssetKind =
    | TextureAsset
    | AudioClipAsset
    | GLTFModelAsset
    | SpriteSheetAsset
    | ParticleConfigAsset;

// ---------------------------------------------------------------------------
// AssetRef<T> — branded phantom type
// ---------------------------------------------------------------------------

/**
 * A branded string that represents a typed reference to a game asset.
 * Format: `"<game-id>/<relative-path-under-assets/>"`.
 *
 * The `_T` parameter is a phantom — it carries type information for callers
 * but has no runtime representation. Passing a raw `string` where an
 * `AssetRef<TextureAsset>` is required is a TypeScript compile error.
 *
 * The game-id prefix prevents cross-game ref collisions and makes paths
 * self-describing.
 */
export type AssetRef<T extends AssetKind = AssetKind> = string & {
    // Embedding T in the brand makes AssetRef<TextureAsset> and
    // AssetRef<AudioClipAsset> structurally incompatible (H1 hardening).
    readonly __assetRef: T;
};

// ---------------------------------------------------------------------------
// buildAssetRef — safe factory
// ---------------------------------------------------------------------------

/**
 * Construct an `AssetRef<T>` from its constituent parts.
 *
 * @param gameId        The game identifier, e.g. `"tactics"`.
 * @param relativePath  The path relative to the game's `assets/` directory,
 *                      e.g. `"textures/units/warrior-portrait.webp"`.
 */
export function buildAssetRef<T extends AssetKind>(
    gameId: string,
    relativePath: string,
): AssetRef<T> {
    const ref = `${gameId}/${relativePath}`;
    if (isTraversalUnsafe(gameId, relativePath)) {
        throw new MalformedAssetRefError(ref);
    }
    return ref as AssetRef<T>;
}

// ---------------------------------------------------------------------------
// parseAssetRef — decompose an AssetRef
// ---------------------------------------------------------------------------

/**
 * Decompose an `AssetRef` into its `gameId` and `relativePath` parts.
 *
 * @throws {MalformedAssetRefError} When the ref does not contain a `/`, or
 *   when the slash appears at position 0 (empty game id).
 */
export function parseAssetRef(ref: AssetRef): {
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the gameId or relativePath contain path-traversal
 * components that would allow escaping the assets root when resolved by
 * the AssetManager (F10). Pure string check — no filesystem access.
 *
 * Rejects:
 *   - gameId containing `/` (would embed a directory separator)
 *   - relativePath starting with `/` (absolute path injection)
 *   - relativePath containing `..` as a path segment (directory traversal)
 *   - NUL bytes in either argument (filesystem escape on some OS)
 */
function isTraversalUnsafe(gameId: string, relativePath: string): boolean {
    if (gameId.includes('/') || gameId.includes('\0')) return true;
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
 * Thrown by `parseAssetRef` when a string does not conform to the
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
// AssetManifest types — simulation-side, zero Three.js / DOM dependency
// ---------------------------------------------------------------------------

/**
 * Load priority for a manifest entry.
 *
 * - `critical`  — preloaded before match starts; game will not begin until loaded.
 * - `deferred`  — lazy-loaded on first use; a fallback asset is shown while loading.
 */
export type AssetPriority = 'critical' | 'deferred';

/** A single entry in an `AssetManifest`. */
export interface AssetManifestEntry<T extends AssetKind = AssetKind> {
    readonly ref: AssetRef<T>;
    readonly priority: AssetPriority;
}

/**
 * Complete asset inventory for a game.
 *
 * Defined in `games/<name>/asset-manifest.ts` as a VALUE of this type.
 * The type itself is owned by `simulation/content/` — no Three.js or
 * renderer dependency is permitted here.
 *
 * Injected into the renderer via `AssetManagerContext` at session start
 * (dependency injection, not import) — see Invariant #47.
 */
export interface AssetManifest {
    readonly gameId: string;
    readonly entries: readonly AssetManifestEntry[];
}
