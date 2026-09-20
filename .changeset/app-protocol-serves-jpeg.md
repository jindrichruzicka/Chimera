---
'@chimera-engine/electron': patch
---

Serve `.jpg` and `.jpeg` as `image/jpeg` over the app protocol.

Both extensions were missing from the protocol handler's content-type table and fell through to
`application/octet-stream`. The table is a curated list — `.bin` is mapped to octet-stream on
purpose — so a common image type answering as octet-stream read as a decision when it was not one.

An image type is not range-capable, so a `Range` header on a JPEG is answered with the whole file.
