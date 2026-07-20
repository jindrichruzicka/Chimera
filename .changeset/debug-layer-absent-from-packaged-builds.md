---
'@chimera-engine/electron': patch
'@chimera-engine/renderer': patch
'create-chimera-game': patch
---

Packaged builds no longer bundle the Runtime Debug Layer (§4.12, Invariant #27).

#885 made the debug gate permanently false in a distributable, but the code behind it still
shipped: the packaged main bundle was only 69 bytes smaller than the dev one. Three exclusions
now keep the layer out of the artifact entirely.

The main-process graph leaves the bundle. `electron/main/index.ts` gated the debug bridge on the
imported `IS_DEBUG_MODE`, and esbuild does not propagate a cross-module constant into a consuming
module — so the branch stayed live and `debug-bridge`, `SnapshotInspector`, `SnapshotRingBuffer`,
`SnapshotDiff` and the `chimera:debug*` handlers were all bundled. The gate now inlines the same
expression, which the existing packaged `define` folds to `if (false)`, and esbuild prunes the two
dynamic imports with it: `dist/electron/main.js` loses roughly 30 KB, with none of the graph's marker
strings left. The duplication of the expression is pinned by a drift test, because divergence would
silently restore the shipped graph.

The Inspector preload is no longer emitted. `buildAppBundles` plans no `debug-preload` spec when
`CHIMERA_PACKAGED_BUILD=1`, so `dist/preload/debug-api.js` (532 KB) and its 1.06 MB sourcemap are
no longer produced. This does not change the size of a distributable — electron-builder's `files`
allowlist already named `dist/preload/api.js` only — but it keeps the largest debug artifact out
of the packaging build's output tree, and out of any distributable whose `files` list an adopter
later widens. The check applies to the resolved entry, so it covers the packed-sibling fallback a
scaffolded game's packaging run takes, not just the monorepo source path.

The Inspector UI route is gated. `renderer/app/debug` gained a `debugRouteGate` and a server
wrapper that calls `notFound()` in packaged builds, matching the existing component-gallery and
replays gates — the route previously shipped ungated in the static export, and now prerenders to
the 404 page with no Inspector markup. As with the gallery gate, Next still emits the route's
JS chunk; nothing loads it, but this closes a reachable route rather than removing bytes.

Dev and e2e builds set none of these flags and are unchanged; F9 still opens the Inspector. The
#885 startup guard and `define` are untouched — this is subtraction of unreachable code, not a
replacement for either control.
