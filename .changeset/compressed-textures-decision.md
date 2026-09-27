---
'@chimera-engine/renderer': patch
---

Record that GPU-compressed textures are out of scope for now, and why.

There is no `.ktx2` or Basis asset kind, and §4.10 now says so plainly rather than leaving a game to
discover it: plan for uncompressed texture memory, where an 8-bit RGBA image costs `width × height × 4`
bytes on the GPU plus a third again for mipmaps. Against that the engine offers fewer or smaller
images, and the mipmap third, since `generateMipmaps` is declarable per entry.

What decided it was not packaging. Both apps copy their asset directory unfiltered, so a compressed
file ships with no config change, and the transcoder would be served from the app's own protocol like
anything else under `assets/`. A `.wasm` content-type row is not needed either: `KTX2Loader` reads the
binary as an arraybuffer and hands it to the transcoder, which compiles from those bytes rather than
streaming a response.

The obstacle is where the asset layer sits. three's `KTX2Loader` refuses to load or even to parse
without `detectSupport(renderer)`, because the renderer is what tells it which compressed formats the
GPU accepts — so it is needed to choose a transcode target before any byte is decoded. Managers are
built outside a canvas, and a game that mounts none never creates a `WebGLRenderer` at all. Carrying
the GPU device into that layer is a new dependency direction and a change to the shape of
`AssetLoader`.

A test holds that refusal against the installed three, so the reasoning reds rather than ages if the
requirement goes away. §4.10 also records a second cost the branch did not measure: the transcoder
runs in a worker created from a `blob:` URL, which the shipped CSP does not look to admit — something
a yes would have to settle first.

Nothing half-built is left behind, deliberately: a partial surface would be a game's first sign that
the answer was yes.
