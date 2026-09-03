---
'@chimera-engine/electron': patch
---

Serve `.mp3` and the other common audio containers over `chimera://` with a real content type.

The MIME table behind the `chimera://` protocol carried only `.ogg` and `.wav` on the audio side, so
`.mp3` — the format a game is most likely to ship — fell to `application/octet-stream`. That is not
just a cosmetic header: `isRangeCapableContentType` reads the content-type string to decide whether
to honour a `Range` request, and `application/octet-stream` fails it. Chromium's media stack issues a
ranged request and refuses to play a source answered with a plain `200`, so an `<audio>` or
`<video>` element pointed at an `.mp3` cannot play it.

`.mp3`, `.m4a`, `.aac`, `.flac` and `.opus` now have rows. `.avi` and `.mkv` deliberately do not, and
a test holds them on the fallback so their absence stays a decision rather than an oversight — a row
makes neither container playable. The table's docblock now records what a row actually buys.

The engine's own `audio-clip` asset kind was never affected: it decodes through `fetch` +
`decodeAudioData` and does not consult the content type.
