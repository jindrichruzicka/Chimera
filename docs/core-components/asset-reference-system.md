---
title: 'Asset Reference System'
description: 'AssetRef<T> phantom-typed branded string, AssetManifest, AssetResolver (dev/prod), AssetManager (preload/get/load/dispose), useAsset<T> hook, and the simulation/renderer separation contract.'
tags: [assets, asset-ref, three-js, renderer, content, r3f]
---

# Asset Reference System

> §4.10 of the Chimera architecture.
> Related: [Content Database](content-database-data-refs.md) · [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md)

---

## Design Rationale

The simulation layer is pure TypeScript with no DOM, no Three.js, and no file-system access — yet content data objects must be able to name binary assets (textures, models, audio). `AssetRef<T>` is a **phantom-typed branded string**: the simulation stores and passes these strings but never resolves them. Only the renderer's `AssetManager` converts an `AssetRef` into a loaded `THREE.Texture`, `AudioBuffer`, or `GLTF`.

| Layer                               | Responsibility                                              |
| ----------------------------------- | ----------------------------------------------------------- |
| `simulation/content/AssetRef.ts`    | `AssetRef<T>` type + `buildAssetRef()` helper — zero deps   |
| `games/<name>/data/*.json`          | JSON data objects carry `AssetRef` strings as plain strings |
| `games/<name>/asset-manifest.ts`    | Declares every `AssetRef` the game exposes + load priority  |
| `renderer/assets/AssetResolver.ts`  | `AssetRef<T>` → `file://` URL (env-aware: dev vs prod)      |
| `renderer/assets/AssetManager.ts`   | Loads, caches, and disposes resolved assets                 |
| `renderer/assets/AssetPreloader.ts` | Bulk-preloads all `critical` manifest entries before match  |
| `renderer/assets/useAsset.ts`       | React hook — returns loaded asset or `null` + loading flag  |

---

## `AssetRef<T>` — Phantom-Typed Branded String

```typescript
// simulation/content/AssetRef.ts

// Phantom types — document intent only. No runtime class; no Three.js import.
export interface TextureAsset {} // → THREE.Texture
export interface AudioClipAsset {} // → AudioBuffer (Web Audio API)
export interface GLTFModelAsset {} // → GLTF
export interface SpriteSheetAsset {} // → THREE.Texture + SpriteAtlas frame map
export interface ParticleConfigAsset {} // → plain JSON

export type AssetKind =
    | TextureAsset
    | AudioClipAsset
    | GLTFModelAsset
    | SpriteSheetAsset
    | ParticleConfigAsset;

// Format: "<game-id>/<relative-path-under-assets/>"
// Example: "tactics/textures/units/warrior-portrait.webp"
export type AssetRef<_T extends AssetKind = AssetKind> = string & { readonly __assetRef: void };

export function buildAssetRef<T extends AssetKind>(
    gameId: string,
    relativePath: string,
): AssetRef<T> {
    return `${gameId}/${relativePath}` as AssetRef<T>;
}

export function parseAssetRef(ref: AssetRef): { gameId: string; relativePath: string } {
    const slash = ref.indexOf('/');
    if (slash < 1) throw new MalformedAssetRefError(ref);
    return { gameId: ref.slice(0, slash), relativePath: ref.slice(slash + 1) };
}
```

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

export interface AssetManifestEntry<T extends AssetKind = AssetKind> {
    readonly ref: AssetRef<T>;
    readonly priority: AssetPriority;
}

export interface AssetManifest {
    readonly gameId: string;
    readonly entries: readonly AssetManifestEntry[];
}
```

The manifest value is **injected via `AssetManagerContext`** at game session start — the renderer never imports from any `games/*` path.

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
```

The correct resolver is constructed in `electron/main/index.ts` and injected into the renderer — the renderer never constructs paths itself.

---

## `AssetManager` — Load, Cache, Dispose

```typescript
export interface AssetManager {
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

---

## Key Invariants

- **Invariant #20** — `simulation/` never resolves `AssetRef` values. Only `renderer/assets/AssetManager` may resolve them.
- **Invariant #21** — `AssetManager.dispose()` is called unconditionally on every game session end.
- **Invariant #22** — All `AssetRef` strings in content JSON must pass CI validation before merge.
- **Invariant #47** — `AssetManager` never imports from `games/*`.

---

## Cross-References

- [Content Database](content-database-data-refs.md) — `DataRef<T>` for cross-collection data references
- [Renderer Contexts](matchshell-ui-design-system.md) — `AssetManagerContext` injection in `MatchShell`
- [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md) — `renderer/assets/` file tree
