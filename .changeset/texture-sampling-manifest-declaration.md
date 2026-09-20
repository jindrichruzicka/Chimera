---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': patch
---

Let a manifest entry declare how its texture is sampled.

A `texture` or `sprite-sheet` entry can carry a `sampling` declaration under `metadata.sampling`:
`colorSpace`, `magFilter`, `minFilter`, `wrapS`, `wrapT`, `flipY`, `anisotropy` and
`generateMipmaps`. The values are engine-owned names and JSON scalars — `'nearest'`, not a graphics
library's constant — so a declaration survives the JSON comparison the asset cache uses to decide
whether a re-registered entry is still the same asset.

`textureEntry({ ref, priority, sampling })` is new on `@chimera-engine/simulation/content`, and
`spriteAnimationEntry` takes an optional `sampling` that it writes beside the clip sheet. Both check
the declaration and throw `InvalidTextureSamplingError`, naming every fault, for a misspelled option
or a value outside the vocabulary. An entry authored without `sampling` is unchanged.

This release only carries the declaration: it reaches the kind's loader on
`AssetLoadRequest.metadata`, and nothing applies it to the loaded texture yet.

`validate-assets` now peels `textureEntry(...)` like the other entry builders. Before this, an entry
authored through it was skipped, so its ref was never looked for on disk.
