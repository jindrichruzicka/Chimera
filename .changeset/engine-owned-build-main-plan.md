---
'@chimera-engine/electron': minor
'create-chimera-game': minor
---

The `build:app` Electron bundle plan moves into a new engine export, behind thin app-owned drivers (§4.12).

`@chimera-engine/electron` gains a public `./build-main` subpath holding the bundle plan every
consumer app's `build:app` runs: the packaging `define` that folds the debug gate dead
(Invariant #27), the esbuild alias / `nodePaths` derivation, the output layout, and the bundle list.
It is the same engine-owns-the-logic / app-owns-the-paths split as `./packaged-bundle` beside it,
and for the same reason: the plan was previously shipped as two code-identical copies in this repo
plus a third minted into every scaffolded game, where it froze at scaffold time. A fix to the
`define` reached an existing adopter only if they hand-merged a file they had been told never to
edit, and the shipped copy was invisible to every static tool here — lint-ignored, outside
`tsconfig.json`, outside vitest — reaching the real assertions only through a single string-equality
line.

`apps/<game>/electron/build-main.ts` and the blank template's copy are now ~60-line drivers holding
only what the engine must not: the app's paths, its module resolution, and esbuild itself. `esbuild`
stays app-side and the published dependency surface is unchanged — the plan declares its own
structural `EsbuildBundleOptions` rather than importing esbuild's types, which a new test ratchets
in both the source and the emitted `dist` (a type-only import would erase before `verify:publish`'s
depcheck could see it).

`buildAppBundles` gains a plan-shaped `overrides` escape hatch — `mainEntry`, extra `alias` entries,
per-label `external` additions, and `extraBundles` for a utility-process worker or a second preload.
It is deliberately plan-shaped and not esbuild-shaped: no hook reaches esbuild's option set, because
the packaged-build assertions execute the shipped invocation rather than reading it, and an
"extra esbuild options" hook would re-open exactly the hole that closes. `verifyPackagedBundle`
gains a matching `extraShipped`, so an extra bundle that ships is scanned for the debug layer and
accepted in the `electron-builder.yml` `files:` allowlist instead of being rejected as unexpected.

For scaffolded games this resolves a contradiction the template shipped: `build-main.ts` said "never
edit it after scaffolding" while `verify-packaged-bundle.ts` said the opposite. The driver is yours
to edit; the plan it drives is not, and now it does not have to be.

One published type changes shape: `ElectronBuilderCheckOptions.extraShipped` is REQUIRED, not
optional. It is the parameter type of `electronBuilderDistFailures` and `electronBuilderControlGaps`,
which are exported for testing the predicates directly — a caller passing `{ appDir, outfiles }` now
needs `extraShipped: []`. Nothing that drives the gate through `verifyPackagedBundle` is affected;
that entry point keeps the field optional and normalizes it. The requirement is deliberate: it is what
makes a re-spelled subset of the app's planned file set a compile error rather than a step that
silently stops seeing an extra bundle.
