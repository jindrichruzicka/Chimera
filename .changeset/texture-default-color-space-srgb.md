---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': minor
'create-chimera-game': patch
---

Default a texture's color space to sRGB. **Data maps must now declare `colorSpace: 'none'`.**

A `texture` or `sprite-sheet` manifest entry that declares no `colorSpace` is now published as
`'srgb'`. Until now it was published with no color space at all, which is three's default for a bare
texture.

What that changes in an existing game depends on how the game hands the texture to a material,
because `@react-three/fiber` tags a texture sRGB itself on some routes and not on others. What r3f
does on each route below is pinned against the installed version by
`renderer/components/r3f/__tests__/r3f-texture-color-space.test.tsx`.

- **A color image set as a JSX prop on a color slot — `<meshStandardMaterial map={texture} />` — does
  not change.** r3f already tagged it sRGB when the prop was applied. This is the route the engine's
  own `AnimatedSprite` takes for its default material.
- **A color image passed through constructor `args`, or assigned to a material the game built
  itself, now renders darker than before.** r3f does not tag a texture on
  either route (`<meshStandardMaterial args={[{ map: texture }]} />`, `material.map = texture`).
  Those were uploaded without an sRGB decode, so their stored values were shaded as if they were
  linear. If you had compensated for that look on one of these routes, take the compensation out.
- **A data map that declares nothing is now wrong.** Roughness, metalness, normal, ambient-occlusion
  and mask images are not color and must not be decoded. r3f leaves a texture on a data slot
  (`roughnessMap`, `normalMap`) alone, so until now an undeclared one stayed untagged, which is right
  for it; it now arrives tagged sRGB, and r3f leaves that alone too. Declare it:
  `textureEntry({ ref, priority, sampling: { colorSpace: 'none' } })`.

A texture inside a `.glb` is unaffected: `GLTFLoader` configures those, not the asset manifest.

The default is `DEFAULT_TEXTURE_COLOR_SPACE`, exported from `@chimera-engine/simulation/content`
beside the sampling vocabulary. Data maps stay a declared option rather than a second asset kind.

The blank template's worked `asset-manifest.ts` example now declares its banner through
`textureEntry` with an explicit `colorSpace: 'srgb'`, so the first texture a new game declares shows
that the option exists.
