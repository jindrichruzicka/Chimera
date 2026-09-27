---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': patch
'@chimera-engine/electron': patch
---

Declare the engine's asset-kind ids once, and guard the two readers against drifting apart.

`validate:assets` reports a manifest kind the engine registers no loader for. Which kinds those are
was written down twice — once as a literal set inside the tool, once as the loaders
`createDefaultAssetLoaderRegistry` builds — with nothing holding the two equal. A gate that refuses a
kind the engine loads turns a working manifest into a failed build; a gate that accepts one the engine
cannot load moves the failure into the shipped game.

`ENGINE_ASSET_LOADER_KIND_IDS` in `@chimera-engine/simulation/foundation/engine-asset-kinds.js` is now
the one declaration. The tool builds its membership set from it, and a guard asserts the default
loader registry registers exactly those kinds — in both directions, since a declared kind with no
loader passes a manifest the runtime then refuses, and a loader with no declaration is a gate that
refuses a file the engine can load. The list is typed against `AssetKindId`, so an id with no phantom
brand behind it is a compile error.

Two properties of the tool are now pinned rather than merely true. A missing environment map is
reported by the same walk that reports any other missing ref. And no extension allow-list exists: an
HDRI declared under the `texture` kind, or a PNG under `environment-map`, still passes — both are
authoring mistakes the runtime catches, and a rule making them the gate's business would be a new
restriction across every kind, needing its own justification.
