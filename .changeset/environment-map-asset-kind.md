---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': minor
'@chimera-engine/electron': patch
---

Add an `environment-map` asset kind, so an HDRI ships in `assets/` and lights a PBR scene.

A physically-based material without image-based lighting reads as flat plastic whatever its
roughness and metalness say, and until now there was no asset kind that could carry the light: the
registered kinds were `texture`, `audio-clip`, `gltf-model`, `sprite-sheet` and `particle-config`,
none of which decodes an HDRI.

An `environment-map` entry resolves to an equirectangular `THREE.Texture` of linear radiance data.
`.hdr` and `.exr` are loaded, the decoder chosen from the ref's extension and imported inside its own
branch so neither is named on a path that does not use it. Any other extension rejects with
`UnsupportedEnvironmentMapFormatError`, which names both the extension refused and the ones that
load. `validate:assets` knows the kind, so an entry declaring it passes the build gate.

Two things differ from the `texture` kinds on purpose. The equirectangular mapping is written by the
loader rather than declared, because three's default for a fresh texture samples the image as a flat
decal and lights nothing. And no colour-space default is applied: the decoders write
`LinearSRGBColorSpace` themselves, and the sRGB default that suits a colour image would have the
renderer decode radiance a second time. Everything an entry does declare through the existing
sampling vocabulary is still applied.

`chimera://` serves Radiance as `image/vnd.radiance` and OpenEXR as `image/x-exr`. Neither row is what
makes the load work — both decoders read the file as an arraybuffer — so the rows say what the file
is rather than enabling it.

Applying the texture is ordinary React Three Fiber: `scene.environment` lights every standard material
in the scene, a material's `envMap` lights one. Three converts an equirectangular map to the
pre-filtered form a physical material samples, so neither route needs a helper library.
