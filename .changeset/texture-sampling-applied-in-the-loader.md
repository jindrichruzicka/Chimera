---
'@chimera-engine/renderer': patch
---

Apply a manifest entry's declared texture sampling in the loader, before the texture is published.

The default `texture` and `sprite-sheet` loaders now read the `sampling` a manifest entry declares
and write it onto the texture while the loader is still the only thing holding it. What
`AssetManager.load()` resolves and what `get()` returns is already configured, so a component has no
configuration step of its own and no reason to write to a texture it shares with every other
consumer of that ref. An option the entry does not declare is left as the loader produced it, apart from
the color space, which has a default.

The declaration is checked before the image, or a sprite sheet's atlas descriptor, is requested. An
invalid one — reachable through a hand-authored entry, which no builder checked — rejects the load
with `InvalidTextureSamplingError`.

`parseSpriteAtlas`, and so `useSpriteAtlas` and `AnimatedSprite`, now honour a sheet declared
`flipY: false`: its `v` coordinates run down the image with the unflipped rows. Before this the
atlas assumed three's default `flipY: true`. A sheet that does not declare `flipY` is measured as
before.
