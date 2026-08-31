---
'@chimera-engine/renderer': patch
---

`three` no longer ships in the always-mounted shell layout chunk. `AssetManager` named
`TextureLoader` at module scope, and that alone was enough to pull the renderer core into
the chunk webpack builds for `@chimera-engine/renderer/shell/layout`, which every exported
route loads. The shell mounts that module's consumers unconditionally, so a game that
declares no `shellBackgroundAssets` and opens no session still paid for `three` on its boot
screen, its logo screen and its settings pane.

`loadTexture` now reaches the package through `await import`, which is the shape
`loadGltf` beside it already had for `GLTFLoader`. Every caller was already awaiting,
because `AssetLoader.load` returns a promise by contract, so
the module-load tick lands inside a wait that was happening anyway. `three` arrives with
the first texture load, or — on a 3D route — with the canvas that pulls it regardless.

Measured with `next build` over the `/layout` entry's JS chunks: the reference apps'
layout sets drop the 381,907-byte `three` core chunk, about 100 kB gzipped, and no
exported route of either app carries it in its initial `<script>` set any more, except the
dev-only `/model-showcase`, which names `three` itself.

`renderer/__tests__/shell-layout-graph-census.test.ts` is what keeps it out. It walks each
consumer app's layout by static value edges — following relative specifiers, the
`@chimera-engine/renderer/*` subpaths the app names, and the `chimera-game-registration`
alias into the game's own composition root — and refuses a `three` or `@react-three/*`
specifier anywhere it arrives. Type-only edges and `await import` are not edges. Every
bare specifier the walk declines is reported, and pinned by
`stops at exactly the package boundaries this census names`.
