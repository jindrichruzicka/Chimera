# @chimera-engine/electron

## 0.10.0

### Minor Changes

- f92228d: Ship the default Chimera application/window icon set. `@chimera-engine/electron` now bundles the generated icon assets under `assets/icons/` — including the dev-runtime default `chimera.png` (512×512) that F67's `createMainWindow` resolves when a game declares no `GameManifest.icon` override, plus the `.icns`/`.ico` build set for packaged distributables. Regenerate from the Chimera logo with `pnpm icons:generate`.
- abdd11d: Boot packaged builds into the manifest-declared logo screen (F70). `buildRendererGameLaunchUrl(gameId, route?)` gains an optional route parameter (trailing-slash normalised, defaulting to `/main-menu`), and the new pure `resolveRendererLaunchUrl(hostedGame, isPackaged)` selects the launch URL in `main()`: when packaged and the hosted game's manifest declares `logoScreen`, the window boots into that route; dev and E2E launches are untouched (`CHIMERA_E2E_INITIAL_URL` keeps precedence).

### Patch Changes

- Updated dependencies [5673e65]
- Updated dependencies [c52b3f7]
- Updated dependencies [483a4ab]
- Updated dependencies [abdd11d]
- Updated dependencies [abdd11d]
- Updated dependencies [70e4147]
- Updated dependencies [26da224]
- Updated dependencies [ea837b1]
    - @chimera-engine/renderer@0.10.0
    - @chimera-engine/simulation@0.10.0
    - @chimera-engine/ai@0.9.1
    - @chimera-engine/networking@0.9.1

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The Electron
  composition root — main-process game registry, IPC handlers, and preload bridge —
  published as `@chimera-engine/electron`, depending on every other `@chimera-engine/*` engine package
  with `electron` as an optional peer.
