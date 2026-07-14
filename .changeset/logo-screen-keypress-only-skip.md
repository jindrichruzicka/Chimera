---
'@chimera-engine/renderer': patch
---

`LogoVideoScreen` now skips on key press only — a mouse click no longer dismisses the brand/logo screen. The skip-on-input wiring drops its `window` `'click'` listener and keeps `'keydown'`; the watchdog timeout, video `ended`/`error`, and autoplay-rejection exit paths are unchanged.
