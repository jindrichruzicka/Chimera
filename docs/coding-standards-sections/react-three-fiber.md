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
const { asset, loading } = useAsset<THREE.Texture>(ref);
if (loading) return <Fallback />;

// ❌ WARNING — checking the type of a fallback value
if (asset instanceof THREE.Texture) { ... }
```

- `AssetRef<T>` strings always come from content data. Never construct them as string literals in component code.
- Do not create geometries or materials inside a component's render path. Hoist to `useMemo` or module scope.

## 6.3 Render loop

- Per-frame logic belongs in `useFrame`. Never use `setInterval` or `setTimeout` to drive animation.
- Do not call `setState` inside `useFrame`. Update the ref, let the next render derive from it, or use `invalidate()` explicitly.
- The render loop and simulation tick are **decoupled**. The R3F canvas reads from the Zustand store; it never drives the simulation.
