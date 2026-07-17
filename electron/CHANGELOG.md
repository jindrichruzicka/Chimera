# @chimera-engine/electron

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
