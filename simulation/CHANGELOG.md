# @chimera-engine/simulation

## 1.0.0-rc.2

### Minor Changes

- 7f237bb: Dev multiplayer harness: game-owned fixtures, auto-session, standalone packaging (§4.32)
    - `@chimera-engine/electron` ships the harness as the `chimera-dev-mp` bin (+ the
      `./dev-harness` library subpath): one command spawns an auto-hosting instance plus
      auto-joining clients, relays the host's `host:port:token` lobby code via an atomic
      announce-file handshake, auto-readies every seat, and auto-starts the match once the
      roster is complete. Works identically from the monorepo and from a standalone
      scaffolded app (the app dir is the harness root; entry from `package.json` `main`).
    - Games inject their own test data from `<appRoot>/dev/`: `profiles/*.json` (cosmetic
      engine-shaped identities, seeded as each instance's active profile) and
      `scenarios/*.json` (per-seat game-defined attributes such as a JSON-encoded deck,
      host-authored match settings such as an arena id, AI seats, auto-start) — validated by
      the new `@chimera-engine/simulation` `shared/dev-fixture-contract.ts` schemas and
      riding the same lobby channels a real player uses into `snapshot.setup`.
    - Per-game player-attribute value cap: `GameLobbySetup.maxAttributeValueLength`
      (default 256 — unchanged behaviour) lets a game admit deck-sized values; the wire
      schema's coarse bound is now `WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH` (16384) with
      the precise cap enforced by `LobbyManager` on both write paths.
    - `create-chimera-game` scaffolds ship a `dev:mp` script, starter `dev/` fixtures, and
      a synthesized standalone `.gitignore`; `verify:scaffold` gains a `dev-harness`
      dry-run step and `verify:pack` probes the new subpath.
    - Fixes the previously dead harness wiring: the spawn entry pointed at a deleted
      monorepo path, `--dev-auto-join` could never match its own equals-form flag, and the
      documented seed-profile copy was unimplemented.

- RC polish across the engine chrome and settings:
    - New real frame-rate limiter: `FrameRateLimiter` (exported from the r3f barrel) gates
      `gl.render` at render priority and reads `targetFps` from resolved settings, replacing
      the previously non-functional display cap.
    - Removed the dead `display.fullscreen`, `display.vsync`, and `display.uiScale` settings
      engine-wide (they had no runtime effect; fullscreen is forced in production). The
      gameplay settings tab is now language-only.
    - Slimmed the default chrome: dropped the lobby role badge and the default HUD's
      `Tick`/undo/redo affordances (`DefaultGameHud`), and removed the duplicated title from
      the blank game template.

## 1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Minor Changes

- e9f122f: Add the optional spectator capability to the `GameManifest` contract and the reserved allow-spectators match setting (F72). New exports from `foundation/game-manifest-contract`: `GameSpectatorSupport` (an opaque `mode: 'perspective'` — the only v1 visibility model), the optional `GameManifest.spectators` field, and the pure `resolveSpectatorSupport(manifest)` helper (returns `undefined` for an absent field or a malformed `mode`, never throws, never mutates). New exports from `foundation/game-lobby-contract`: the engine-owned reserved match-setting key `ALLOW_SPECTATORS_SETTING` (`'engine.allowSpectators'`), its `ALLOW_SPECTATORS_DEFAULT` (`'false'`), and the pure `readAllowSpectators(matchSettings)` reader (`true` only when the key is exactly `'true'`, fail-safe closed otherwise). Behaviour-neutral for every existing game: absent `spectators` resolves to `undefined` and join-in-progress stays rejected — no game admits spectators until it declares the capability and the host enables it per match.
- da1f1cd: Let a spectator switch which seat they follow (F72 Spectator Mode). The `SPECTATE_TARGET_UPDATE` wire message is now plumbed end-to-end: the networking transports gain `ClientTransport.sendSpectateTarget(targetPlayerId)` and `HostTransport.onSpectateTargetUpdate((from, targetPlayerId) => …)` (mirrored across the local WebSocket provider — `WsClientTransport`, `MessageRouter`, `WsHostTransport` — and the `InMemoryMultiplayerProvider`); the host derives the spectator from the connection (never a client-supplied id, Invariant #99) and, after validating the requested target is a currently-seated player, re-points the viewer's `SpectatorRegistry` entry and immediately re-broadcasts the new-perspective projection — an unknown or non-seated target is ignored and the perspective is unchanged. A new renderer→main IPC seam drives it: `window.__chimera.spectate.setFollowedTarget(targetPlayerId)` sends the Zod-validated `chimera:spectate:set-target` channel (Invariant #5), which `LobbyManager.setSpectatorTarget` forwards over the joined session's transport. The message is out-of-band / cosmetic: never an `EngineAction`, never advances `tick`, and never enters `ActionHistory`, saves, or replays (Invariant #115).

## 0.10.0

### Minor Changes

- 483a4ab: Add the optional hardware-cursor declaration to the `GameManifest` contract (F69). New exports from `foundation/game-manifest-contract`: `GameCursorRole` (`'default' | 'pointer' | 'disabled'`), `GameCursorHotspot`, `GameCursorImage` (game-asset-relative `image` path + optional `hotspot`), `DEFAULT_CURSOR_HOTSPOT`, the optional `GameManifest.cursor` field, and the pure `resolveGameCursor(manifest)` helper that normalizes declared roles (hotspots defaulted to `(0, 0)`) and returns `undefined` for absent or empty declarations — behaviour-neutral: the plain system cursor stays. Image paths are opaque at this layer and resolved only by the renderer through the game-asset protocol.
- abdd11d: Add the optional logo-screen declaration to the `GameManifest` contract (F70). New exports from `foundation/game-manifest-contract`: `GameLogoScreen` (an opaque game-owned `route` of the form `` `/${string}` ``), the optional `GameManifest.logoScreen` field, and the pure `resolveGameLogoScreen(manifest)` helper. The resolver returns `undefined` for an absent declaration or a malformed route (non-string, missing the leading slash, or carrying a `?` query / `#` fragment) and never throws — a bad manifest can never brick a packaged boot; the host just falls back to the main menu. Behaviour-neutral for games that declare nothing: boot goes straight to `/main-menu` exactly as before.

### Patch Changes

- 70e4147: Fix player colours (and other host-authored seat attributes) flashing their default value at the start of a replay before snapping to the chosen value.

    Seat setup — chosen player colours, names, team, etc. — is match-initialization data carried on the `engine:start_game` payload, not a gameplay action. A replay's `gameConfig` is frozen at lobby-start, before that setup exists, so `createBaseReplayInitialSnapshot` reconstructed the initial frame without any `setup`; the value only appeared once the recorded `engine:start_game` action replayed, producing a one-frame default → chosen flash. The reconstruction now lifts `setup` from the replay's first `engine:start_game` action (validated via the same `parseSetup` sanitiser the live pipeline uses) and seeds it into the initial snapshot, so the first frame already carries the correct attributes. Determinism is preserved — the replayed `engine:start_game` re-applies the identical value, leaving every post-action frame bit-identical — and the fix is self-healing for already-recorded replays (no file-format change).

- 26da224: Fix "Return to lobby" doing nothing after a match ends (from the post-game summary or the post-game replay).
    - `@chimera-engine/simulation`: the `ActionPipeline` terminal-match gate now allows `engine:return_to_lobby` after a `gameResult` is recorded. It is the host-only abandon-to-lobby reset (the reverse of `start_game`) and does not mutate the recorded result, so it must not be rejected alongside gameplay/turn/undo actions — otherwise the host can never leave a finished match back to the lobby.
    - `@chimera-engine/renderer`: the in-game menu's leave action is now injectable through `GameShell` → `InGameMenuHost`, and the replay player supplies a context-aware leave (back to the lobby for a post-game replay, back to the replay library for a library-opened one). `GameStoreBootstrap` also returns to the lobby on a `phase:'lobby'` snapshot when on the replay player route, not just `/game`.

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The pure,
  zero-runtime-dependency simulation core — engine, action registry, reducers, snapshot
  and projection, and the deterministic host — published as `@chimera-engine/simulation`.
