---
title: 'Asset Reference System'
description: 'AssetRef<T> phantom-typed branded string, extensible AssetKindRegistry, AssetManifest, AssetResolver (dev/prod), AssetLoaderRegistry, AssetManager (preload/get/load/dispose), useAsset<T> hook, and the simulation/renderer separation contract.'
tags: [assets, asset-ref, three-js, renderer, content, r3f]
---

# Asset Reference System

> §4.10 of the Chimera architecture.
> Related: [Content Database](content-database-data-refs.md) · [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md)

---

## Design Rationale

The simulation layer is pure TypeScript with no DOM, no Three.js, and no file-system access — yet content data objects must be able to name binary assets (textures, models, audio). `AssetRef<T>` is a **phantom-typed branded string**: the simulation stores and passes these strings but never resolves them. Only the renderer's `AssetManager` converts an `AssetRef` into a loaded `THREE.Texture`, `AudioBuffer`, or `GLTF`.

| Layer                                    | Responsibility                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/asset-ref-parse.ts`              | `parseAssetRef`, `isTraversalUnsafe`, `MalformedAssetRefError` — pure string logic, no deps; shared by `simulation/` and `renderer/`  |
| `simulation/content/AssetRef.ts`         | `AssetRef<T>` type, open `AssetKindRegistry`, `buildAssetRef()` helper; re-exports parsing utilities from `shared/asset-ref-parse.ts` |
| `games/<name>/data/*.json`               | JSON data objects carry `AssetRef` strings as plain strings                                                                           |
| `games/<name>/asset-manifest.ts`         | Declares every `AssetRef` the game exposes, runtime kind id, load priority, and optional loader metadata                              |
| `renderer/assets/AssetResolver.ts`       | `AssetRef<T>` → `file://` URL (env-aware: dev vs prod)                                                                                |
| `renderer/assets/AssetLoaderRegistry.ts` | Runtime kind id → loader, open to game-contributed loaders without engine edits                                                       |
| `renderer/assets/AssetManager.ts`        | Loads, caches, and disposes resolved assets                                                                                           |
| `renderer/assets/AssetPreloader.ts`      | Bulk-preloads all `critical` manifest entries before match                                                                            |
| `renderer/assets/useAsset.ts`            | React hook — returns loaded asset or `null` + loading flag                                                                            |

---

## `AssetRef<T>` — Phantom-Typed Branded String

```typescript
// simulation/content/AssetRef.ts

// Phantom types — each carries a unique __kind literal brand so that
// AssetRef<TextureAsset> and AssetRef<AudioClipAsset> are mutually incompatible.
export interface AssetKindBrand<TKind extends string> {
    readonly __kind: TKind;
}

export type TextureAsset = AssetKindBrand<'texture'>;
export type AudioClipAsset = AssetKindBrand<'audio-clip'>;
export type GLTFModelAsset = AssetKindBrand<'gltf-model'>;
export type SpriteSheetAsset = AssetKindBrand<'sprite-sheet'>;
export type ParticleConfigAsset = AssetKindBrand<'particle-config'>;

// Open registry: games and extension packages add their own kind ids here
// through TypeScript declaration merging.
export interface AssetKindRegistry {
    readonly texture: TextureAsset;
    readonly 'audio-clip': AudioClipAsset;
    readonly 'gltf-model': GLTFModelAsset;
    readonly 'sprite-sheet': SpriteSheetAsset;
    readonly 'particle-config': ParticleConfigAsset;
}

export type AssetKind = AssetKindRegistry[keyof AssetKindRegistry];
export type AssetKindId<T extends AssetKind = AssetKind> = T['__kind'];

// Format: "<game-id>/<relative-path-under-assets/>"
// Example: "tactics/textures/units/warrior-portrait.webp"
export type AssetRef<T extends AssetKind = AssetKind> = string & { readonly __assetRef: T };

// Parsing and traversal-safety utilities live in shared/asset-ref-parse.ts
// so both simulation/ and renderer/ can import them without a cross-boundary
// runtime-value import.
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

// Delegates to shared/asset-ref-parse.ts — no logic duplication.
export function parseAssetRef(ref: AssetRef): {
    readonly gameId: string;
    readonly relativePath: string;
} {
    return parseAssetRefBase(ref);
}
```

The `T` parameter is intentionally embedded in the brand. This keeps refs for different asset kinds structurally incompatible at compile time, so an `AssetRef<TextureAsset>` cannot be passed where an `AssetRef<AudioClipAsset>` is required even though both are plain strings at runtime.

### Game-Contributed Asset Kinds

Games and first-party extension libraries may contribute new phantom kinds without changing `simulation/content/AssetRef.ts`:

```typescript
// games/tactics/assets/asset-kinds.ts
import type { AssetKindBrand } from '@chimera/simulation/content/AssetRef.js';

export interface TacticsVoxelAsset extends AssetKindBrand<'tactics:voxel'> {
    readonly __tacticsVoxelAsset: unique symbol;
}

declare module '@chimera/simulation/content/AssetRef.js' {
    interface AssetKindRegistry {
        readonly 'tactics:voxel': TacticsVoxelAsset;
    }
}
```

Custom kind ids should be namespaced by game or package (`tactics:voxel`, `cards:deck-art`) so independent extensions cannot collide accidentally.

---

## Asset References in Content JSON

```json
// games/tactics/data/units/warrior.json
{
    "id": "warrior",
    "portrait": "tactics/textures/units/warrior-portrait.webp",
    "model": "tactics/models/units/warrior.glb",
    "sfx": {
        "attack": "tactics/audio/sfx/sword-hit.ogg"
    }
}
```

---

## Asset Manifest

```typescript
// simulation/content/AssetManifest.ts — engine-level, game-agnostic
export type AssetPriority = 'critical' | 'deferred';

export type AssetManifestEntry<T extends AssetKind = AssetKind> = T extends AssetKind
    ? {
          readonly ref: AssetRef<T>;
          readonly kind: AssetKindId<T>;
          readonly priority: AssetPriority;
          readonly metadata?: unknown;
      }
    : never;

export interface AssetManifest {
    readonly gameId: string;
    readonly entries: readonly AssetManifestEntry[];
}
```

The manifest value is **injected via `AssetManagerContext`** at game session start — the renderer never imports from any `games/*` path. `kind` is the runtime bridge from the phantom type to the renderer loader registry. `metadata` is loader-owned structured data for cases such as atlas descriptors, compression options, or game-specific decode hints.

> **Invariant #47** — `AssetManager` never imports from `games/*`.
> **Invariant #22** — All `AssetRef` strings in content JSON must pass `tools/validate-assets.ts` before merge.

---

## `AssetResolver` — Environment-Aware URL Resolution

```typescript
export interface AssetResolver {
    resolve(ref: AssetRef): string;
}

// Production: assets packed into Electron resources/
export function createProductionResolver(resourcesPath: string): AssetResolver {
    return {
        resolve(ref) {
            const { gameId, relativePath } = parseAssetRef(ref);
            return `file://${resourcesPath}/assets/${gameId}/${relativePath}`;
        },
    };
}

// Development: assets served from source tree
export function createDevResolver(projectRoot: string): AssetResolver {
    return {
        resolve(ref) {
            const { gameId, relativePath } = parseAssetRef(ref);
            return `file://${projectRoot}/games/${gameId}/assets/${relativePath}`;
        },
    };
}

// Renderer runtime: game assets served by Electron through the app protocol
export function createRendererGameAssetResolver(): AssetResolver {
    return {
        resolve(ref) {
            const { gameId, relativePath } = parseAssetRef(ref);
            return `chimera://renderer/game-assets/${gameId}/${relativePath}`;
        },
    };
}
```

The renderer constructs only the safe app-protocol URL. Electron main owns the protocol handler and
maps `/game-assets/<gameId>/<relativePath>` to the game-owned asset directory after traversal
checks. In the monorepo this directory is `games/<gameId>/assets/`; in a future package-split build
the same protocol can resolve to an installed game package asset root.

## `AssetLoaderRegistry` — Extensible Runtime Loading

```typescript
export interface AssetLoadRequest<T extends AssetKind = AssetKind> {
    readonly ref: AssetRef<T>;
    readonly kind: AssetKindId<T>;
    readonly url: string;
    readonly metadata?: unknown;
}

export interface AssetLoader<T extends AssetKind = AssetKind, TLoaded = unknown> {
    readonly kind: AssetKindId<T>;
    load(request: AssetLoadRequest<T>): Promise<TLoaded>;
}

export interface AssetLoaderRegistry {
    register<T extends AssetKind>(loader: AssetLoader<T>): void;
    get<T extends AssetKind>(kind: AssetKindId<T>): AssetLoader<T>;
    has(kind: string): boolean;
}
```

The default registry contains the built-in loaders for `texture`, `gltf-model`, `sprite-sheet`, `audio-clip`, and `particle-config`. Games register additional loaders during renderer/session wiring and pass the composed registry into `AssetManager`; engine renderer code still receives it by dependency injection rather than importing any specific game package.

---

## `AssetManager` — Load, Cache, Dispose

```typescript
export interface AssetManager {
    // Register the active session manifest; load(ref) rejects refs not listed here.
    registerManifest(manifest: AssetManifest): void;
    // Preload all 'critical' entries; resolves when done
    preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
    ): Promise<void>;
    // Synchronous get — returns null if not yet loaded (safe to call every frame)
    get<T extends AssetKind>(ref: AssetRef<T>): ResolvedAsset<T> | null;
    // Async on-demand — subsequent calls return cached Promise
    load<T extends AssetKind>(ref: AssetRef<T>): Promise<ResolvedAsset<T>>;
    // Dispose all loaded GPU resources — call unconditionally at game session end
    dispose(): void;
}
```

> **Invariant #21** — `AssetManager.dispose()` is called unconditionally at game session end. Components must never hold direct references to loaded Three.js assets.

`AssetManager.load(ref)` resolves `ref` to a URL through `AssetResolver`, looks up the matching `AssetManifestEntry`, then dispatches to the loader registered for `entry.kind`. It does not infer semantic type from file extension. Extension sniffing is allowed inside a loader implementation, but the engine-level dispatch key is always the manifest kind.

---

## `useAsset<T>` Hook

```typescript
// renderer/assets/useAsset.ts

// Returns null + loading:true while the asset is not yet resolved.
// Components decide how to render the loading state (placeholder mesh, skeleton, etc.).
export function useAsset<T extends AssetKind>(
    ref: AssetRef<T> | null,
): {
    asset: ResolvedAsset<T> | null;
    loading: boolean;
    error: Error | null;
};
```

### Example — Unit Component

```tsx
// games/tactics/screens/components/UnitMesh.tsx
import { useAsset } from '@chimera/renderer/assets/useAsset';
import { TextureAsset, AssetRef } from '@chimera/simulation/content';

interface UnitMeshProps {
    portraitRef: AssetRef<TextureAsset>;
}

function UnitMesh({ portraitRef }: UnitMeshProps) {
    const { asset: texture, loading } = useAsset(portraitRef);
    if (loading || !texture)
        return (
            <mesh>
                <boxGeometry />
                <meshBasicMaterial color="grey" />
            </mesh>
        );
    return (
        <mesh>
            <boxGeometry />
            <meshBasicMaterial map={texture} />
        </mesh>
    );
}
```

---

## CI Validation

`tools/validate-assets.ts` crawls all content JSON files, collects every field whose value matches the `AssetRef` format (`<gameId>/<path>`), and asserts that the file exists on disk.

> **Invariant #22** — All `AssetRef` strings must pass this validation before merge. A data object referencing a non-existent file is a CI-blocking error.

Game font declarations use the same local `game-id/relative/path` string shape, but they are loaded
by `renderer/game/GameFontLoader.ts` rather than by `AssetManager`. Validation also crawls
`games/*/shell/fonts.ts` and requires each font file to exist under `games/<game>/assets/`.
Renderer runtime loading uses the `chimera://renderer/game-assets/<game>/<path>` protocol path,
which Electron resolves to the game-owned asset directory. External font URLs are rejected, and
committed game assets under `renderer/public/assets/` are forbidden so the renderer does not become
a second owner of game audio, fonts, textures, or models.

---

## Key Invariants

- **Invariant #20** — `simulation/` never resolves `AssetRef` values. Only `renderer/assets/AssetManager` may resolve them.
- **Invariant #21** — `AssetManager.dispose()` is called unconditionally on every game session end.
- **Invariant #22** — All `AssetRef` strings in content JSON must pass CI validation before merge.
- **Invariant #47** — `AssetManager` never imports from `games/*`.
- **Invariant #97** — Game assets are owned by game packages; runtime loading uses the game-asset protocol and must not depend on renderer-public mirrors or Google-hosted font files.

---

## Cross-References

- [Content Database](content-database-data-refs.md) — `DataRef<T>` for cross-collection data references
- [Renderer Contexts](gameshell-ui-design-system.md) — `AssetManagerContext` injection in `GameShell`
- [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md) — `renderer/assets/` file tree
