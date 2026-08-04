---
title: 'Chimera Coding Standards — §6 React Three Fiber (R3F)'
description: 'Rules for data passed to R3F components, AssetRef usage, render loop discipline, and decoupling the canvas from the simulation tick.'
tags:
    [react-three-fiber, r3f, three-js, useFrame, useAsset, AssetRef, render-loop, coding-standards]
---

# §6 React Three Fiber (R3F)

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 6.1 Data passed to R3F components

- Pass only the fields a component renders. Never pass a full `PlayerSnapshot` to a component that uses three fields.
- Use typed selectors from the Zustand game store to extract the exact slice needed.

## 6.2 Assets

```typescript
// ✅ Correct — check the loading flag
const { asset, loading } = useAsset<TextureAsset>(ref);
if (loading) return <Fallback />;

// ❌ WARNING — checking the type of a fallback value
if (asset instanceof THREE.Texture) { ... }
```

- `useAsset`'s type parameter is `TAssetKind extends AssetKind` — pass an asset-kind type such as `TextureAsset` (from `simulation/content`), never a Three.js class like `THREE.Texture`.
- `AssetRef<T>` strings always come from content data. Never construct them as string literals in component code.
- Do not create geometries or materials inside a component's render path. Hoist to `useMemo` or module scope.
- `useModelInstance` allocates its clone in a commit-phase effect, so `loading` stays `true` for one extra render after the asset resolves and `instance` is `null` until then — check before reading, exactly as with `useAsset`.
- The clone is component-owned (Invariant #21's carve-out): never dispose, mutate, or re-bind anything it shares with the cached asset — geometry, materials, textures, `geometry.morphAttributes`, animation clips, `skeleton.boneInverses`.
- One ref, many mounts: every mount gets its own clone. Never mount the cached `gltf.scene` directly — three.js reparents it and the first mount silently vanishes (§4.10, Per-Instance Model Use).

## 6.3 Render loop

- Per-frame logic belongs in `useFrame`. Never use `setInterval` or `setTimeout` to drive animation.
- Do not call `setState` inside `useFrame`. Update the ref and let the next render derive from it. Do **not** reach for `invalidate()` as the remedy: on an engine canvas it is inert under both frameloops the engine produces — see `renderer/components/r3f/useEngineFrameloop.ts` for the two reasons — so nothing may depend on it to get a frame.
- The render loop and simulation tick are **decoupled**. The R3F canvas reads from the Zustand store; it never drives the simulation.
- Animation mixers subscribe at the DEFAULT render priority (0), as `useModelAnimation` does. A non-zero-priority `useFrame` subscriber becomes responsible for `gl.render` — see the co-presenter notes in `FrameRateLimiter.tsx`'s header. The engine frame-rate cap registers no `useFrame` of its own.
- Animation is renderer-local (Invariants #42/#43, #56–#58): no animation event may gate an `EngineAction`, and no mixer or clone state may enter a `GameSnapshot`, a Zustand store, an IPC payload, a save, or a replay.
