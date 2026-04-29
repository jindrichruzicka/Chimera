---
title: 'Chimera Coding Standards — §13 Performance'
description: 'Performance rules for the simulation hot path, IPC, renderer (R3F), and memory baseline targets for main process and renderer.'
tags: [performance, simulation, IPC, renderer, memory, useMemo, selectors, coding-standards]
---

# §13 Performance

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 13.1 Simulation hot path

- No per-tick allocations that can be hoisted out of the loop. Create objects once; reuse them.
- `ActionPipeline` must complete in ≤ 16 ms at 20 Hz on the target hardware baseline.

## 13.2 IPC

- Do not send a full `GameSnapshot` (or large serialised snapshot) over IPC on every tick. Send `PlayerSnapshot` diffs where possible.
- Synchronous blocking FS operations (`fs.readFileSync`, `fs.writeFileSync`) on the main process event loop are forbidden. Use `fs.promises` or atomic rename with `writeFileSync` only on a worker thread.

## 13.3 Renderer

- R3F geometry and materials must be created inside `useMemo` or at module scope — never inside the render function.
- `useAsset` must receive a stable `AssetRef` reference (not an object literal constructed inline each render). Inline object literals break referential equality and cause redundant asset re-fetches.
- Do not subscribe to the entire Zustand store. Use narrow selectors to limit re-renders.

## 13.4 Memory baseline (production target)

| Metric            | Target                      |
| ----------------- | --------------------------- |
| Main process heap | ≤ 32 MB during active match |
| Renderer heap     | ≤ 32 MB during active match |
