# @chimera-engine/simulation

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
