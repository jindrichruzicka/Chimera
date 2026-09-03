---
'@chimera-engine/electron': patch
---

Lower-case the extension before the `chimera://` MIME lookup, so `hero.PNG` resolves.

Every key in `CONTENT_TYPES_BY_EXTENSION` is lower-case and `path.extname` returns whatever the
filename carries, so `hero.PNG`, `sky.WebP` and `clip.MP4` all missed rows that exist and fell to
`application/octet-stream`. For a media file that also cost range serving — `isRangeCapableContentType`
reads the content-type string — so a capitalised `.MP3` or `.MP4` got a plain `200` and would not
play.

The two halves of the same pipeline disagreed about what an extension is: the renderer's
`getAssetExtension` ends `.toLowerCase()`, the main-process half did not. They agree now.

Only the extension is lowered, never the path: paths are case-sensitive on Linux, so a normalisation
applied at resolution would fail to open the file at all. A test holds the resolved path at its
original capitalisation on both resolution arms — the renderer root and the game's assets root are
separate functions — and the unmapped-extension fallback is asserted in both cases, so the
normalisation cannot turn an unknown extension into a known one.

The lowering is unconditional, so it reaches every row rather than only the ones this was reported
for: `notes.TXT`, `page.HTML`, `boot.JS` and `art.SVG` now get their real types too. A test lists
those four, so the reach is a recorded decision rather than a side effect. It is not an escalation:
the protocol still serves only files under the renderer root or the game's own assets root.
