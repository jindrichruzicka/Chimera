// simulation/content/AssetManifest.ts
// §4.10 — Simulation-side asset manifest types.
//
// Defines AssetManifest, AssetManifestEntry, and AssetPriority.
// These types are owned by the simulation layer and carry zero resolution
// logic — the renderer's AssetManager is the only code that resolves
// AssetRef values into loaded GPU or audio resources (Invariant #20).
//
// Zero-dependency: no Three.js, no DOM, no renderer, no electron imports.

import type { AssetKind, AssetRef } from './AssetRef.js';

// ---------------------------------------------------------------------------
// AssetPriority
// ---------------------------------------------------------------------------

/**
 * Load priority for a manifest entry.
 *
 * - `critical`  — preloaded before match starts; game will not begin until loaded.
 * - `deferred`  — lazy-loaded on first use; a fallback asset is shown while loading.
 */
export type AssetPriority = 'critical' | 'deferred';

// ---------------------------------------------------------------------------
// AssetManifestEntry
// ---------------------------------------------------------------------------

/** A single entry in an {@link AssetManifest}. */
export interface AssetManifestEntry<T extends AssetKind = AssetKind> {
    readonly ref: AssetRef<T>;
    readonly priority: AssetPriority;
}

// ---------------------------------------------------------------------------
// AssetManifest
// ---------------------------------------------------------------------------

/**
 * Complete asset inventory for a game.
 *
 * Defined in `games/<name>/asset-manifest.ts` as a value of this type.
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
