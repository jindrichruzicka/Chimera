# @chimera-engine/renderer

## 1.0.0-rc.1

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Patch Changes

- 3250d73: `LogoVideoScreen` now skips on key press only — a mouse click no longer dismisses the brand/logo screen. The skip-on-input wiring drops its `window` `'click'` listener and keeps `'keydown'`; the watchdog timeout, video `ended`/`error`, and autoplay-rejection exit paths are unchanged.
- a8b5cb6: Close out F72 Spectator Mode (feature-review gate). Land the carried-over
  correctness fix from the #881 review: `renderer/app/game/page.tsx` now derives
  `isHost = false` for a spectator, so a spectator that follows the host's seat
  (and therefore projects `viewerId === hostId`) is no longer mistaken for the
  host — keeping the deterministic-replay export host-only (Invariants #71 / #98 /
  #114). Adds the end-to-end Playwright spec proving admit-as-spectator, the
  read-only followed view, the out-of-band perspective switch, and both mid-match
  reject reasons (`spectators_disabled`, `match_in_progress`), plus the new
  Spectator Mode Contract doc and the ratified invariants #114 (read-only viewers)
  and #115 (out-of-band `SPECTATE_TARGET_UPDATE`).
- Updated dependencies [e9f122f]
- Updated dependencies
- Updated dependencies [da1f1cd]
    - @chimera-engine/simulation@1.0.0-rc.0

## 0.10.0

### Minor Changes

- 5673e65: Add the `--ch-cursor-*` token family and route every engine cursor style through it (F69). `--ch-cursor-default: auto` and `--ch-cursor-pointer: pointer` join the existing `--ch-cursor-disabled` in `styles/tokens.css`; `styles/globals.css` applies the default token at the document root (cursor inherits, so shell chrome and the R3F canvas share one cursor set), and engine UI modules plus the default theme reference `var(--ch-cursor-pointer, pointer)` instead of hardcoding `cursor: pointer`. Behaviour-neutral with no overrides — computed cursors are identical to before; games may now legally override the cursor tokens (Invariant #85), which the hardware-cursor registry plumbing will use to inject `url(chimera://…)` values.
- c52b3f7: Wire game cursor declarations through the renderer game registry and inject hardware-cursor token overrides (F69). `LoadedRendererGameShell` gains an optional `cursor` field — the game's `GameManifest.cursor` declaration forwarded verbatim — and `loadRendererGame`/`loadRendererGameShell` now run a shell-internal injector as a registry-init side-effect (Invariant #93): each declared texture is resolved through the game-asset protocol (`chimera://renderer/game-assets/…`, Invariant #97), pre-decoded via the existing image warm-up seam so the first paint never flashes the system cursor, and written over the engine's `--ch-cursor-<role>` tokens as `url(<resolved>) <hotspot-x> <hotspot-y>, <role-fallback>` (fallbacks: `auto`/`pointer`/`not-allowed`). Game-relative texture paths are validated against the same local-game-asset policy as font and preload-image refs — absolute paths, protocol-relative URLs, and URL schemes are rejected before the path is joined with the game id. No declaration ⇒ strict no-op; the injector stays shell-internal (no new barrel export, Invariant #96).
- abdd11d: Ship the engine default logo screen (F70). New in the `components/ui` barrel: `LogoVideoScreen` (full-window stretched video that reports `onDone` exactly once on the first of: watchdog timeout, video `ended`, any click/keypress skip, or video `error`) and `LOGO_VIDEO_DEFAULT_DURATION_MS` (10 s watchdog). New shell page at `shell/logo-screen/page` — the engine's hard-coded boot logo flow that hands off to the main menu preserving `?gameId=` — for adopting games to re-export, plus the committed `public/chimera_logo.mp4` placeholder stub (adopting hosts commit their own copy). The renderer CSP now includes `media-src 'self'`.
- ea837b1: Unify keyboard-focus (`:focus-visible`) styling across the UI kit. All interactive primitives now draw their focus indicator at or inside the border-box — bordered components recolor their border to `--ch-focus-ring-color` (plus a transparent inset outline for forced-colors modes), borderless ones draw a visible inset outline — so scroll containers can never clip the indicator (previously the Tabs tablist clipped the offset halo ring into a stray sliver). `Button` and `Slider` gain focus styles they previously lacked, and all components now share the single `--ch-focus-ring-color` token, which defaults to `--ch-color-text-secondary` (distinct from the accent-hover color that already paints active tab chrome and primary button borders) and is intended to be overridden per game. The now-unused `--ch-focus-ring-offset` token is removed.

### Patch Changes

- 26da224: Fix "Return to lobby" doing nothing after a match ends (from the post-game summary or the post-game replay).
    - `@chimera-engine/simulation`: the `ActionPipeline` terminal-match gate now allows `engine:return_to_lobby` after a `gameResult` is recorded. It is the host-only abandon-to-lobby reset (the reverse of `start_game`) and does not mutate the recorded result, so it must not be rejected alongside gameplay/turn/undo actions — otherwise the host can never leave a finished match back to the lobby.
    - `@chimera-engine/renderer`: the in-game menu's leave action is now injectable through `GameShell` → `InGameMenuHost`, and the replay player supplies a context-aware leave (back to the lobby for a post-game replay, back to the replay library for a library-opened one). `GameStoreBootstrap` also returns to the lobby on a `phase:'lobby'` snapshot when on the replay player route, not just `/game`.

- Updated dependencies [483a4ab]
- Updated dependencies [abdd11d]
- Updated dependencies [70e4147]
- Updated dependencies [26da224]
    - @chimera-engine/simulation@0.10.0

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The React / R3F
  renderer shell, store, and game-registration seam published as `@chimera-engine/renderer`,
  depending on `@chimera-engine/simulation` with React, Next, Three.js, and R3F as peers.
