---
'@chimera-engine/renderer': minor
---

Export `UnsupportedEnvironmentMapFormatError` from `@chimera-engine/renderer/assets`.

An `environment-map` entry whose ref names an extension the engine does not decode rejects its load
with this error, and `useAsset` reports it as its `error`. The class was not on the barrel, so a game
could not import it and had no documented way to tell this refusal from any other failed load. It
now sits beside `UnknownAssetManifestEntryError` and `MalformedModelAssetError`, and a game
recognises it with `instanceof`, which also types its `ref` and `extension` fields.

Additive: nothing is removed or renamed, and the error's `name` and message are unchanged.
