---
'@chimera-engine/renderer': minor
---

Ship the engine default logo screen (F70). New in the `components/ui` barrel: `LogoVideoScreen` (full-window stretched video that reports `onDone` exactly once on the first of: watchdog timeout, video `ended`, any click/keypress skip, or video `error`) and `LOGO_VIDEO_DEFAULT_DURATION_MS` (10 s watchdog). New shell page at `shell/logo-screen/page` — the engine's hard-coded boot logo flow that hands off to the main menu preserving `?gameId=` — for adopting games to re-export, plus the committed `public/chimera_logo.mp4` placeholder stub (adopting hosts commit their own copy). The renderer CSP now includes `media-src 'self'`.
