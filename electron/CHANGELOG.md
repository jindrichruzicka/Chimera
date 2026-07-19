# @chimera-engine/electron

## 1.0.0-rc.4

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.4
- @chimera-engine/ai@1.0.0-rc.4
- @chimera-engine/networking@1.0.0-rc.4
- @chimera-engine/renderer@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies
- Updated dependencies
    - @chimera-engine/renderer@1.0.0-rc.3
    - @chimera-engine/simulation@1.0.0-rc.3
    - @chimera-engine/ai@1.0.0-rc.3
    - @chimera-engine/networking@1.0.0-rc.3

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

### Patch Changes

- Scaffolded apps ship first-class debug support:
    - `pnpm start:debug` (the launcher's `--debug` flag sets dev + `CHIMERA_DEBUG` env), main
      and renderer source maps, and a generated `.vscode/` for IDE debugging.
    - Fixed the F9 inspector in standalone builds: `@chimera-engine/electron`'s `build-main`
      now falls back to `resolveInstalledDebugPreloadEntry` (sibling lookup) so the debug
      preload resolves from the installed package layout.

- Updated dependencies [7f237bb]
- Updated dependencies
- Updated dependencies [a68c5ba]
- Updated dependencies [4ce48c4]
- Updated dependencies
- Updated dependencies
    - @chimera-engine/simulation@1.0.0-rc.2
    - @chimera-engine/renderer@1.0.0-rc.2
    - @chimera-engine/ai@1.0.0-rc.2
    - @chimera-engine/networking@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- f88e40a: Fix the scaffolded app crashing at startup when `ELECTRON_RUN_AS_NODE` is set in the environment (some IDE/agent terminals and CI runners export it globally). In that state the `electron` binary runs as plain Node.js, so `require('electron')` resolves to the executable path string and every Electron API is `undefined` — a raw `electron apps/<game>` then died at module load with a cryptic `TypeError: Cannot read properties of undefined`, which reads as "launching the app crashes the terminal".
    - `create-chimera-game` now emits a `scripts/launch.mjs` launcher and a root `pnpm start` script that strip `ELECTRON_RUN_AS_NODE` before spawning Electron, so the documented run step works from any terminal. The README + next-steps now point at `pnpm start`.
    - `@chimera-engine/electron` gains a startup `assertElectronRuntime` guard that turns the cryptic `TypeError` into an actionable message naming the cause and the fix (`unset ELECTRON_RUN_AS_NODE`, or use `pnpm start`).
    - @chimera-engine/simulation@1.0.0-rc.1
    - @chimera-engine/ai@1.0.0-rc.1
    - @chimera-engine/networking@1.0.0-rc.1
    - @chimera-engine/renderer@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Minor Changes

- da1f1cd: Let a spectator switch which seat they follow (F72 Spectator Mode). The `SPECTATE_TARGET_UPDATE` wire message is now plumbed end-to-end: the networking transports gain `ClientTransport.sendSpectateTarget(targetPlayerId)` and `HostTransport.onSpectateTargetUpdate((from, targetPlayerId) => …)` (mirrored across the local WebSocket provider — `WsClientTransport`, `MessageRouter`, `WsHostTransport` — and the `InMemoryMultiplayerProvider`); the host derives the spectator from the connection (never a client-supplied id, Invariant #99) and, after validating the requested target is a currently-seated player, re-points the viewer's `SpectatorRegistry` entry and immediately re-broadcasts the new-perspective projection — an unknown or non-seated target is ignored and the perspective is unchanged. A new renderer→main IPC seam drives it: `window.__chimera.spectate.setFollowedTarget(targetPlayerId)` sends the Zod-validated `chimera:spectate:set-target` channel (Invariant #5), which `LobbyManager.setSpectatorTarget` forwards over the joined session's transport. The message is out-of-band / cosmetic: never an `EngineAction`, never advances `tick`, and never enters `ActionHistory`, saves, or replays (Invariant #115).
- d8eacba: Make an admitted spectator actually see the match (Invariant #114). The electron host gains a `SpectatorRegistry` (host-local `spectatorId → followedPlayerId` ledger — never in `GameSnapshot.players`, saves, or replays) and `StateBroadcaster` learns a `spectators` view-source option: every broadcast wave now also sends each spectator `StateProjector.project(state, followedPlayerId)` (one send per wave via snapshot-reference dedupe, reusing the single projection gate — Invariant #8), clock-only ticks are forwarded once per tick value, and a new `broadcastSpectator()` unicasts the perspective snapshot at join time. A spectator joins following the first seated player, is re-pointed to the next seated player when its followed seat deliberately leaves (transient drops hold the target), and leaves the registry on disconnect with no seat release. Networking: `LobbyServer.sendToPlayer` now reaches spectator connections (previously a silent no-op, so spectators could never receive a snapshot), and an `ACTION` arriving on a spectator connection is dropped at the message boundary with a warn — belt-and-braces on top of the host-side registry check that also stops envelopes spoofing a seated player's id. Out-of-band client messages (chat, spectate-target updates) still route.

### Patch Changes

- Updated dependencies [e9f122f]
- Updated dependencies [3250d73]
- Updated dependencies
- Updated dependencies [a8b5cb6]
- Updated dependencies [da1f1cd]
- Updated dependencies [d8eacba]
    - @chimera-engine/simulation@1.0.0-rc.0
    - @chimera-engine/renderer@1.0.0-rc.0
    - @chimera-engine/ai@1.0.0-rc.0
    - @chimera-engine/networking@1.0.0-rc.0

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
