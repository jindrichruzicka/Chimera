---
'@chimera-engine/electron': minor
---

Boot packaged builds into the manifest-declared logo screen (F70). `buildRendererGameLaunchUrl(gameId, route?)` gains an optional route parameter (trailing-slash normalised, defaulting to `/main-menu`), and the new pure `resolveRendererLaunchUrl(hostedGame, isPackaged)` selects the launch URL in `main()`: when packaged and the hosted game's manifest declares `logoScreen`, the window boots into that route; dev and E2E launches are untouched (`CHIMERA_E2E_INITIAL_URL` keeps precedence).
