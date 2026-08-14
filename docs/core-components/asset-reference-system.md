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

| Layer                                      | Responsibility                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulation/foundation/asset-ref-parse.ts` | `parseAssetRef`, `isTraversalUnsafe`, `MalformedAssetRefError` — pure string logic, no deps; shared by `simulation/content` and `renderer/`          |
| `simulation/content/AssetRef.ts`           | `AssetRef<T>` type, open `AssetKindRegistry`, `buildAssetRef()` helper; re-exports parsing utilities from `simulation/foundation/asset-ref-parse.ts` |
| `apps/<name>/data/*.json`                  | JSON data objects carry `AssetRef` strings as plain strings                                                                                          |
| `apps/<name>/asset-manifest.ts`            | Declares every `AssetRef` the game exposes, runtime kind id, load priority, and optional loader metadata                                             |
| `renderer/assets/AssetResolver.ts`         | `AssetRef<T>` → `file://` URL (env-aware: dev vs prod)                                                                                               |
| `renderer/assets/AssetLoaderRegistry.ts`   | Runtime kind id → loader, open to game-contributed loaders without engine edits                                                                      |
| `renderer/assets/AssetManager.ts`          | Loads, caches, and disposes resolved assets                                                                                                          |
| `renderer/assets/AssetPreloader.ts`        | Bulk-preloads all `critical` manifest entries as a session opens                                                                                     |
| `renderer/assets/criticalAssetPreload.ts`  | Runs that preload, and gates a route's reveal on it — see [Where the critical preload runs](#where-the-critical-preload-runs)                        |
| `renderer/assets/useAsset.ts`              | React hook — returns loaded asset or `null` + loading flag                                                                                           |

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
// Example: "<game>/textures/entities/entity-portrait.webp"
export type AssetRef<T extends AssetKind = AssetKind> = string & { readonly __assetRef: T };

// Parsing and traversal-safety utilities live in simulation/foundation/asset-ref-parse.ts
// so both simulation/content and renderer/ can import them without a cross-boundary
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

// Delegates to simulation/foundation/asset-ref-parse.ts — no logic duplication.
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
// apps/<game>/assets/asset-kinds.ts
import type { AssetKindBrand } from '@chimera-engine/simulation/content/AssetRef.js';

export interface GameVoxelAsset extends AssetKindBrand<'<game>:voxel'> {
    readonly __gameVoxelAsset: unique symbol;
}

declare module '@chimera-engine/simulation/content/AssetRef.js' {
    interface AssetKindRegistry {
        readonly '<game>:voxel': GameVoxelAsset;
    }
}
```

Custom kind ids should be namespaced by game or package (`<game>:voxel`, `<package>:deck-art`) so independent extensions cannot collide accidentally.

---

## Asset References in Content JSON

```json
// apps/<game>/data/entities/entity.json
{
    "id": "entity",
    "portrait": "<game>/textures/entities/entity-portrait.webp",
    "model": "<game>/models/entities/entity.glb",
    "sfx": {
        "attack": "<game>/audio/sfx/attack-hit.ogg"
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

The manifest value is **injected via `AssetManagerContext`** at game session start — the renderer never imports from any game package path. `kind` is the runtime bridge from the phantom type to the renderer loader registry. `metadata` is loader-owned structured data for cases such as atlas descriptors, compression options, or game-specific decode hints.

> **Module boundary (§3)** — the renderer never imports game packages; `AssetManager` included.
> **Invariant #22** — All `AssetRef` strings in content JSON must pass `electron/dev-tools/validate-assets/index.ts` before merge.

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
            return `file://${projectRoot}/apps/${gameId}/assets/${relativePath}`;
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
checks. In the monorepo this directory is `apps/<gameId>/assets/`; in a future package-split build
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
    // Preload all 'critical' entries; every entry is attempted, and the run
    // resolves when they have all settled or rejects naming the ones that failed.
    // onEntryFailure fires as each broken ref settles — see the Non-fatal bullet.
    preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
        onEntryFailure?: (ref: AssetRef, error: unknown) => void,
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

### Where the critical preload runs

`priority: 'critical'` is not self-executing. Something has to call `preloadCritical`.
`renderer/assets/criticalAssetPreload.ts` is that call, and the engine surfaces making it are:

| Surface                             | Manager it preloads into                                                                       | Manifest                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `GameShell` (`useGameAssetManager`) | the match-level manager — injected by `/game` and `/replays/player`, or the fallback it builds | the `assetManifest` prop                  |
| `GameAssetSession`                  | the manager it builds for a route with no `GameShell` above it                                 | its `assetManifest` prop                  |
| `/game`, `/replays/player`          | the manager the route builds and then injects into `GameShell`                                 | the loaded game's, promoted (gate, below) |

The module exposes the preload three ways. Two of them differ by where the caller allocates its
manager. `useCriticalAssetPreload` is the effect wrapper, for a manager whose identity moves in the
same render as the manifest (a `useMemo` keyed on both, or an injected prop) — that pair can never
be mismatched. `startCriticalAssetPreload` is the primitive, returning the callback that abandons
the run's report; a surface that allocates its manager INSIDE an effect calls it from that same
effect, because React runs every cleanup before every setup — so a separate effect's setup would
read the previous manager out of state, the one the first effect's cleanup just disposed, and cache
into it. `dispose()` empties a manager's maps without making it refuse work, so those assets would
be unreachable by every remaining dispose path.

The third, `useCriticalAssetPreloadGate`, differs by what the caller does with the ANSWER: it runs
the same warm-up and reports `{ ready, outcome }`, so a route can hold its REVEAL — the app-level
fade-in, and a `RouteEntryLoadingCover` over the scene — until the assets are there. Four
independent settle paths, because each has its own failure mode: the run resolving, the run
REJECTING, `CRITICAL_ASSET_PRELOAD_BUDGET_MS` elapsing, and a blank manager or manifest — the
last computed in render rather than in an effect, so a manifest-less game is ready on its first
render instead of waiting on a run that will never start. The gate reports under the `asset-preload-gate`
module: the budget elapsing, as a warning; and a PROMOTED ref failing, as an error naming the
refs. A ref already critical in the base manifest is left to `startCriticalAssetPreload`, which
runs that manifest for the match.
The promoted set is exactly the difference between the two arms' manifests, which is why it is the
gate's to report. That report is a settle-all chained after the run rather than started alongside
it, so the run keeps driving the load order.

Its `sceneRequiredAssets` parameter is a runtime consumer of a declared
`SceneDescriptor.requiredAssets` (Invariant #52): a route entered on an
already-committed scene — a restore, a replay — reaches that scene's declaration only through
`BaseGameSnapshot.sceneRequiredAssets`, and the gate promotes those refs with
`markRequiredAssetsCritical` before running. Both callers promote the FULL manifest built from the
same base object; a sub-manifest filtered to the scene's refs would evict every ref absent from it.

**A gate withholds a reveal, never a MOUNT.** `GameShell` is the unique disposer of a page-injected
manager (Invariant #21), so a route that withheld its mount while waiting here would orphan the very
manager the gate is preloading into. Running both arms is free: every ref after the first resolves
through the manager's `loadedAssets`/`inFlightLoads`, and re-registering an equivalent manifest
evicts nothing (entry equivalence compares kind and metadata, never `priority`).

Three further properties of that call are contractual rather than incidental:

- **Commit phase, never render.** The preload cannot move into `createAssetManager` beside the
  construction-time `registerManifest`. StrictMode discards one of the two managers
  `useRendererGameAssetManager` builds in `useMemo`, and that orphan is tolerable only because it
  is inert — manifest entries and no asset. Filling it with decoded audio and GPU textures makes
  it a leak no dispose path can reach.
- **Non-blocking.** The owning surface renders its subtree while the preload runs. A child that
  loads the same ref through `useAsset` first is served the SAME promise — `AssetManager.load`
  returns the in-flight entry — so the warm-up never costs a second fetch and never gates a frame.
- **Non-fatal.** A rejected critical load is reported through the renderer logger and dropped;
  the deferred on-demand path is untouched, so a missing asset
  degrades one ref instead of refusing the match. `preloadCritical` attempts every critical entry
  and rejects once they have all settled, so one broken ref costs the on-demand path only itself.
  Each failure is reported as IT settles rather than at that rejection — the match-level arm has
  no budget, so a ref that never answers would otherwise withhold every other ref's report.

The scene-TRANSITION arm is a **separate** mechanism, with its own run in
`renderer/components/scene/scenePreload.ts`, awaited by `useFadeTransition` before the barrier's
`engine:scene_ready`; see [Scene Transitions](scene-transitions-fade.md). The
promotion helper's importers are censused in
`renderer/assets/__tests__/required-assets-producer.test.ts`. The committed-scene half of the same
declaration is the route gate above.

**A failed ref is logged once per ARM that loaded it, not once per failure.** Each arm reports the
refs IT loaded, and two of them cover a scene's declaration — the transition run and, depending on
the priority the base manifest gives that ref, either the route gate or the match-level run. So a
declared ref that fails is logged under two modules on the occasions below, which is what tells the
entries apart:

| Base priority of the declared ref  | Reported by                                                               | Not reported by                                               |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `deferred` (promoted by the scene) | `scene-preload` at the transition, `asset-preload-gate` at the commit     | `asset-preload` — the match-level run reads the base manifest |
| `critical`                         | `asset-preload` at the match-level run, `scene-preload` at the transition | `asset-preload-gate` — the promoted set excludes it           |

The second entry on the first row is the commit's doing: `SceneManager` writes the entered scene's
declaration onto the snapshot, which re-arms the gate over the very refs the transition arm has just
settled. The second row is a pair the gate's exclusion never touches, so no arrangement of gate and
match-level run makes one bad ref yield one entry. A declared ref the manifest carries NO entry for
is the exception the table excludes: `load` rejects it before reaching a loader, the promotion adds
no entry, and only the transition arm reports it — one entry and no fetch, with `validate-assets`
owning the case statically (Invariant #52).

Each arm also RE-LOADS the ref rather than reusing a cached rejection: a failed load is never cached
and is evicted from `inFlightLoads`. Measured, one broken `deferred` scene-declared ref costs three
loads across a transition and its commit — the transition arm's, the gate's promoted
`preloadCritical`, and the gate's settle-all chained after it.

Every entry is true, every arm is fail-open, and the reveal proceeds either way, so a reader is
over-informed rather than misinformed; suppressing one would need state shared across arms that hold
none today, and would close only one of the two rows. The counts above are pinned in
`renderer/assets/__tests__/scene-declared-ref-failure-arms.test.tsx`, so a change that moves them
reds there rather than quietly re-writing this table.

### Ahead of both gates — the shell warm-up, and the one wait that has no budget

A route entry reaches neither gate until `loadRendererGame` has resolved, and that call awaits two
things in order. Only one of them can be released on a fail-open budget, and the difference is
whether the thing being waited on has a degraded form the route can render without.

**The shell warm-up is bounded and fails open.** After the game's loader resolves, the registry
awaits the loaded shell's `fonts`, `preloadImages` and `cursor` textures — three steps of
`chimera://` fetches, run in sequence. `GAME_SHELL_WARMUP_BUDGET_MS` (5 s, `renderer/game/rendererGameRegistry.ts`)
releases the load when they do not finish, warning under the `game-registry` module with the game id
and the steps still outstanding — the one in flight and the ones it never let start. Failing open
costs a frame of fallback and no more: a warmed image is a decode the first paint would have done
anyway, and a cursor token left unwritten is the engine's stock cursor. A step that REJECTS still
rejects the load, unchanged: that is a settled
outcome and it already reaches the player as the crash fallback. This budget composes with the route
gate's — 5 s + 8 s — and `rendererGameRegistry.test.ts` asserts the sum stays strictly under the
15 s the game-route e2e allows the canvas.

**The `RendererGameLoader` call above it is not bounded, and cannot be on these terms.** It is the
game's own dynamic `import()`, and an absent `GameScreenRegistry` has no degraded form to reveal —
the only settle a budget could add is a throw, which turns a slow module into a refused route.
What ceiling it does have is the bundler's, and it is partial. Measured in the shipped static export
(`apps/tactics/renderer/out/_next/static/chunks/webpack-*.js`):

- the chunk `<script>` load arms a **120 s timeout** and reports the elapse through the same
  completion path as an error, so the import REJECTS with `ChunkLoadError` rather than hanging —
  and a rejection is already a readable outcome (the route throws into `RootErrorBoundary`, which
  clears the app-level fade so its fallback is legible rather than hidden behind the scrim);
- the **stylesheet sibling** of that same chunk arms no timeout at all. Its promise resolves on the
  `<link>`'s `load` and rejects on its `error`, and settles on neither if the request is never
  answered. This is not a channel a game has to opt into: in the export measured here the tactics
  loader's own `import()` ensures a chunk that carries a stylesheet, and that stylesheet is
  referenced by no exported HTML — so it is fetched at runtime, through the one handler with no
  ceiling.

So Invariant #133's promise is over ASSETS — a missing, slow or undeclared one, now including the
shell's — and stops at the module chunk, which is code. A `chimera://` request that is never
answered is what both halves turn on: answered with bytes or with a 404, every path above settles.

### Asset sessions outside a match — `GameAssetSession`

The manager the hooks below read comes from `GameShell` while a match is running. Outside one — on a game-owned route that renders assets with no `GameShell` above it — the manager in context is the app-level `DelegatingAssetManager`, whose delegate only `GameShell` sets, so every load rejects `NoActiveGameSessionError`.

`renderer/app/gameAssetSession.tsx` is the seam for that case, and it is the one place a game-asset manager is built for any renderer route:

- **`<GameAssetSession assetManifest>`** — exported to an app's own Next host tree as `@chimera-engine/renderer/shell/gameAssetSession` (Invariant #96). It builds a manager for the manifest and publishes it to `useAsset` / `useModelInstance` / `useAssetManager` consumers in the subtree. It registers no `SetGameAssetManagerContext` delegate, so a session outside a match never redirects the app-level `AudioManager` at its own manifest.
- **`useRendererGameAssetManager(loadedGame)`** — for a route that hands the manager to `<GameShell assetManager>` (`/game`, `/replays/player`). It is keyed on the loaded game rather than its manifest because `LoadedRendererGame.assetManifest` is optional, and a game that declares no manifest must still get a manager.

Which surface disposes which manager is enumerated in **Invariant #21**.

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

### Example — Entity Component (engine-internal)

`renderer/assets/` ships one public surface: the `@chimera-engine/renderer/assets` barrel (`./assets` in the package `exports`). What it carries is enumerated in one place — `renderer/assets/index.ts`, held closed by `renderer/assets/__tests__/assets-barrel-side-effects.test.ts` — rather than copied here, because a copied list is re-falsified by the next export. Every individual file behind the barrel (`AssetManager.ts`, `AssetResolver.ts`, …) remains a renderer internal game surfaces must not import (Invariant #96). The example below lives **inside `renderer/`** and uses relative imports.

```tsx
// renderer/components/r3f/ — engine-internal example (not a shipped file)
import type { AssetRef, TextureAsset } from '@chimera-engine/simulation/content';

import { useAsset } from '../../assets/useAsset';

interface EntityMeshProps {
    portraitRef: AssetRef<TextureAsset>;
}

function EntityMesh({ portraitRef }: EntityMeshProps) {
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

## Per-Instance Model Use

A `gltf-model` ref resolves to ONE cached `LoadedGltfAsset` shared by every consumer of
that ref — the cache-by-ref rule every asset kind follows. For models the cached value
is a live `Object3D` tree, and that makes naive reuse destructive in ways a texture
never is. `useModelInstance` (public `@chimera-engine/renderer/assets` barrel) exists
so a component can own an independently posable clone; `useModelAnimation` (public
`@chimera-engine/renderer/components/r3f` barrel, requires a `<Canvas>`) drives one
`AnimationMixer` per clone.

```tsx
import { useModelInstance } from '@chimera-engine/renderer/assets';
import { useModelAnimation } from '@chimera-engine/renderer/components/r3f';

function Knight({ modelRef }: { readonly modelRef: AssetRef<GLTFModelAsset> }) {
    const { instance, loading, error } = useModelInstance(modelRef);
    const mixer = useModelAnimation(instance);
    if (loading || error !== null || instance === null) return null;
    return <primitive object={instance.root} />;
}
```

The failure modes the hook exists to prevent — each one silent or
cache-corrupting when reached by hand:

1. **Reparenting.** Mounting the cached `gltf.scene` in two places does not render it
   twice — three.js reparents the object, and the first mount silently vanishes.
2. **Shared skeleton.** `gltf.scene.clone()` produces distinct meshes that still share
   ONE `Skeleton` — posing either instance poses both. `useModelInstance` clones via
   `SkeletonUtils`, which re-links each clone's skeleton to its own bones.
3. **Shared-cache disposal.** Everything reachable from a clone except its skeletons
   and the cloned node tree itself — geometry, materials, textures,
   `geometry.morphAttributes`, animation clips — is the cached original, shared by
   reference. Disposing any of it corrupts every sibling
   instance and the cache itself (Invariant #21's carve-out states the ownership rule).
4. **Shared `boneInverses`.** Each clone's skeleton shares `boneInverses` BY REFERENCE
   with the cached original. Never call `bind(skeleton)` without an explicit bind
   matrix on any mesh under a clone — that recomputes the shared array in place.
5. **Instanced-mesh refusal.** Models using `EXT_mesh_gpu_instancing` are refused with
   `MalformedModelAssetError`: each clone would copy per-instance buffers that
   `releaseModelInstance` never disposes.

Two adjacent sharp edges: a live object placed on the shared `gltf.scene.userData`
breaks cloning for EVERY consumer of that ref (`Object3D.copy` round-trips `userData`
through JSON), and the `validate-assets` on-demand scan's receiver-name false-negative
(see CI Validation below) applies to model loads exactly as to any other —
keep asset-manager receivers named accordingly.

---

## Sprite Sheet Use

A `sprite-sheet` ref resolves to ONE cached `LoadedSpriteSheetAsset` — a decoded
`Texture` plus the atlas descriptor's raw frame map. Two hooks turn that into something
playable, both on the public `@chimera-engine/renderer/assets` barrel:
`useSpriteAtlas` measures the descriptor against the decoded image and returns
UV-ready cells alongside the texture, and `useSpriteAnimationSheet` reads the
`SpriteAnimationMetadata` clip sheet authored onto the manifest entry.

Most games never call either. `AnimatedSprite` (public
`@chimera-engine/renderer/components/r3f` barrel, requires a `<Canvas>`) is the whole
path in one element:

```tsx
import { AnimatedSprite } from '@chimera-engine/renderer/components/r3f';

function Runner({ sheetRef }: { readonly sheetRef: AssetRef<SpriteSheetAsset> }) {
    return <AnimatedSprite sheet={sheetRef} clip="run" loop="loop" scale={2} />;
}
```

It draws nothing until the sheet's texture has decoded — a quad mounted earlier would
be an opaque white square for the length of the load — then plays the marks the clip
sheet authors through the same `ClipPlayer` and marker scheduler as the mesh half, and
follows the authoritative time dilation by default. A game that owns its own mesh and
material uses `useSpriteClipPlayer(atlas, geometry, sheet, options)` directly instead.

The sharp edges here are different from the model ones:

1. **A sprite is a `Mesh`, never a `THREE.Sprite`.** `Sprite` shares ONE module-level
   geometry across every instance, and sprite playback animates by writing that
   geometry's `uv` attribute — so one `Sprite` playing a clip would re-cut every other
   `Sprite` in the scene. `AnimatedSprite` allocates its own `PlaneGeometry`, which is
   also why the quad is world-oriented rather than camera-facing.
2. **One writer per quad.** Two clip players over one geometry fight over `uv` every
   frame. `AnimatedSprite` owns the quad it drives; a caller of `useSpriteClipPlayer`
   pairs one geometry with one mounted hook.
3. **The texture is shared and must not be configured per-sprite.** Writing
   `magFilter`, `colorSpace` or `flipY` for one sprite changes every sprite cut from
   that sheet (Invariant #21). Filtering and color space belong to how the sheet is
   authored and loaded.
4. **`durationSeconds` is mandatory on a sprite clip.** The backend plays cells at an
   fps derived as `frames.length / durationSeconds`, so the authored length is what
   every compiled mark is placed against. A clip without one is dropped with a warning
   rather than given an invented frame rate.
5. **Pass stable objects.** The atlas and the parsed sheet are dependencies of the
   backend allocation, and allocating sets state — so a caller that rebuilds either
   per render does not merely restart the clip, it drives an unbounded render loop.
   Both hooks memoise what they parse; the failure mode is a manager or a sheet
   accessor that builds a fresh object per call.

---

## CI Validation

`electron/dev-tools/validate-assets/index.ts` crawls all content JSON files, collects every field whose value matches the `AssetRef` format (`<gameId>/<path>`), and asserts that the file exists on disk.

> **Invariant #22** — All `AssetRef` strings must pass this validation before merge. A data object referencing a non-existent file is a CI-blocking error.

The on-demand arm (Invariant #52) additionally AST-scans every Invariant #96 game surface —
`apps/<name>/screens/`, `apps/<name>/components/`, `apps/<name>/shell/`, and `apps/<name>/renderer/` — plus engine scene
descriptors for `useAsset(...)` / `useModelInstance(...)` / `useSpriteAtlas(...)` calls and `<receiver>.load(...)` /
`<receiver>.get(...)` calls, and requires each statically-resolvable ref to be a member of the
workspace-wide declared-ref union (a manifest entry, a scene's `requiredAssets`, content data
JSON, or a font `src` — Invariant #52's membership rule). The `.load`/`.get` matchers are receiver-gated on `/asset/i` — a deliberate
false-negative: a load through a receiver whose name lacks "asset" (for example
`const { load } = useAssetManager()`) is not scanned at all. Keep asset-manager receivers named
accordingly (`assets.load(...)`, `assetManager.get(...)`) so your loads stay inside the gate.

Game font declarations use the same local `game-id/relative/path` string shape, but they are loaded
by `renderer/game/GameFontLoader.ts` rather than by `AssetManager`. Validation also crawls
`apps/*/shell/fonts.ts` and requires each font file to exist under `apps/<game>/assets/`.
Renderer runtime loading uses the `chimera://renderer/game-assets/<game>/<path>` protocol path,
which Electron resolves to the game-owned asset directory. External font URLs are rejected, and
committed game assets under `renderer/public/assets/` are forbidden so the renderer does not become
a second owner of game audio, fonts, textures, or models.

### Standalone games run the same check

The validator ships as the `chimera-validate-assets` bin of `@chimera-engine/electron`
(§4.32), so a game scaffolded by `create-chimera-game` enforces Invariant #22 from day one
rather than losing it on the way out of the monorepo. There is no separate standalone mode:
a scaffolded project places its game at `apps/<kebab>` under an `apps/*` workspace, which is
the shape the crawl already expects.

What differs is only how the tool is pointed at the project root. pnpm runs a package script
with cwd = that package's directory, so the scaffolded **app-level** script is
`chimera-validate-assets ../..` — from `apps/<kebab>`, `../..` is the project root, whose
`apps/*` scan then finds the game. Run from the project root instead, the same `../..` would
resolve to the root's parent; and a standalone root has no `@chimera-engine/electron` for pnpm
to link the bin from, so app-level is the only place it exists. Pointed at a directory with no
`apps/` the tool **refuses** rather than reporting `Checked 0 asset refs` — for a validator,
success about a tree that was never read is the worst available answer.

See the [tool README](../../electron/dev-tools/validate-assets/README.md) for the full cwd
mechanics and the `typescript` runtime dependency the AST crawl needs.

---

## Key Invariants

- **Invariant #20** — `simulation/` never resolves `AssetRef` values. Only `renderer/assets/AssetManager` may resolve them.
- **Invariant #21** — `AssetManager.dispose()` is called unconditionally on every game session end.
- **Invariant #22** — All `AssetRef` strings in content JSON must pass CI validation before merge.
- **Module boundary (§3)** — the renderer never imports game packages; `AssetManager` included.
- **Invariant #97** — Game assets are owned by game packages; runtime loading uses the game-asset protocol and must not depend on renderer-public mirrors or Google-hosted font files.

---

## Cross-References

- [Content Database](content-database-data-refs.md) — `DataRef<T>` for cross-collection data references
- [Renderer Contexts](gameshell-ui-design-system.md) — `AssetManagerContext` injection in `GameShell`
- [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md) — `renderer/assets/` file tree
- `@chimera-engine/renderer/assets` — the public barrel (Invariant #96); its exported set is enumerated in `renderer/assets/index.ts` and pinned by `assets-barrel-side-effects.test.ts`
