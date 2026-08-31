# @chimera-engine/networking

## 1.0.0-rc.12

### Minor Changes

- 11a218b: Rename the host-authored lobby-configuration family from `matchSettings` to `gameParams`. This is a
  **clean break** — there is no back-compat shim and no dual-read tolerance window.

    "Match" presumed a bounded, competitive session with an outcome. An arcade or action game built on
    Chimera has a lobby, host-authored configuration, seats and a snapshot, but no match — nothing to
    win, no scoreboard, no opponent, and yet it was forced to write `matchSettings` in its
    `GameLobbySetup` and answer an IPC channel called `set-match-setting`. `gameParams` follows the
    `AIParams` convention the repo already establishes for a flat, primitive-only bag of game-defined
    knobs. `gameSettings` was rejected: it collides with the §4.13 settings system, which owns
    `EngineSettings` / `GameSettingsSchema` and means per-game persisted user preferences — a different
    concept that Invariant #36 exists to keep apart.

    **What renamed.** `GameSetupConfig.matchSettings` → `gameParams`; `LobbyState.matchSettings` →
    `gameParams`; `QuickStartConfig.matchSettings` → `gameParams`;
    `GameLobbySetup.matchSettingsDefaults` / `matchSettingsOptions` →
    `gameParamDefaults` / `gameParamOptions` (singular noun, mirroring the sibling
    `playerAttributeOptions`); `resolveMatchSettingsDefaults` → `resolveGameParamDefaults`;
    `setMatchSetting` → `setGameParam` on `GameLobbyScreenProps`, `LobbyAPI` and `LobbyManager`;
    `SetMatchSettingPayloadSchema` → `SetGameParamPayloadSchema`;
    `LOBBY_SET_MATCH_SETTING_CHANNEL` → `LOBBY_SET_GAME_PARAM_CHANNEL`;
    `ALLOW_SPECTATORS_SETTING` / `SESSION_MODE_SETTING` / `TACTICS_TURN_MODE_SETTING` →
    `ALLOW_SPECTATORS_PARAM` / `SESSION_MODE_PARAM` / `TACTICS_TURN_MODE_PARAM`; and the i18n key
    `engine.lobby.matchSettingFailed` → `engine.lobby.gameParamFailed`. The three reserved key VALUES —
    `engine.allowSpectators`, `engine.sessionMode` and tactics' `turnMode` — do not move.

    **Three persisted or transmitted surfaces change with it.**
    - **The wire key.** `GameSetupConfig.gameParams` is required inside `PlayerSnapshot.setup`, which
      rides the strict `SnapshotMessage`. There is no protocol version and no handshake check, so
      mismatched peers cannot be refused at join time: the client receive boundary discards the whole
      malformed frame rather than the field, and from `engine:start_game` onward the mismatched peer
      receives zero snapshots — no board, no ticks, no game-over, no user-visible error. The snapshot
      CRC gate runs on the pre-schema bytes and passes, so it neither catches nor explains it.
      `LobbyState.gameParams` is optional on a non-strict object, so across the same skew the joined
      client's lobby silently renders with defaults. Run both peers on the same engine version.
    - **The IPC channel.** `chimera:lobby:set-match-setting` → `chimera:lobby:set-game-param`. Two of
      the three Zod boundaries it crosses are strict, so a preload/main skew rejects rather than strips.
    - **The dev-scenario JSON key.** `DevScenarioSchema` is strict, so every adopter with
      `dev/scenarios/*.json` must rename `matchSettings` to `gameParams` there; a stale key fails loudly
      at the CLI. The scaffold's own starter fixture declares none and needs no edit.

    **Saves migrate at schema v7.** `CURRENT_SCHEMA_VERSION` moves 6 → 7 with a registered v6→v7
    migration renaming `checkpoint.setup.matchSettings`. Without it a restored commitment-mode match
    would resume as sequential — silent determinism divergence, since the turn mode gates stamina, the
    turn gate and commit refusal. Because the migration rewrites a checksummed field,
    `FileSaveRepository.load()` now verifies the stored digest against the body **as stored** rather than
    against the object the migration chain returns; tampering is still caught, and the error precedence
    of `SaveSchemaTooNewError` is unchanged.

    **Replays from an older app version are already refused** — `ReplayMigrator.isCompatible` requires
    exact `engineVersion` equality and registers no migrations, so any mismatch throws a typed
    `ReplayVersionError`. One hole remains: an adopter who ships the renamed engine WITHOUT bumping
    their own app version passes that gate and reaches the parser with no `gameParams` key, which throws
    a bare `TypeError` rather than a `ReplayParseError` — so `instanceof` handling misses it and it
    surfaces as an unhandled crash. Bump your app version with the engine.

### Patch Changes

- Updated dependencies [11a218b]
    - @chimera-engine/simulation@1.0.0-rc.12

## 1.0.0-rc.11

### Minor Changes

- e0bc9a7: Widen the seat contracts so every seat kind can carry picks, and stop the preload schema from
  stripping the fields that depend on it.

    `LobbyAgentSlot` gains `attributes?: Readonly<Record<string, string>>` — the agent-slot twin of
    `LobbyPlayerEntry.attributes`. An AI seat is never a `players` entry: it lives in `agentSlots` and
    is seated at match start under the synthetic `ai-<slotIndex>` id, so before this it had no carrier
    at all and a game could not say what its AI was playing.

    `buildSetupFromLobbyState()` now walks BOTH rosters into one `playerAttributes` map: every `players`
    entry (host, joined remote, pass-and-play local seat) under its own `playerId`, and every
    `kind: 'ai'` agent slot under `createSyntheticAIPlayerId(slotIndex)` — the same id
    `collectGameStartAiPlayerSlots` seats the agent with, so `setup` never describes a seat that does
    not exist. A reducer asks "what is seat N playing?" once, against one map, whatever kind of seat N
    is. A `players` entry wins over an agent slot claiming the same id (`??=`, players walked first). A
    human-kind agent slot contributes nothing — it is a placeholder for a joining human whose own entry
    carries its attributes, and no synthetic seat is ever created for it. Invariant #101 widens by the
    new carrier; the verbatim-projection guarantee is unchanged, and an integration test runs the real
    road — lobby state → setup builder → `engine:start_game` validate + reduce → `StateProjector` — and
    asserts every viewer's `setup` is the same object, AI seat included.

    `createSyntheticAIPlayerId` moves to its own `electron/main/runtime/syntheticAgentId.ts` leaf
    (re-exported from `HostedSessionAgents.ts`, so every existing import path is unchanged) so the
    lobby-setup registry can share the one spelling of an AI seat's id without pulling the AI engine
    into its module graph.

    The preload `LobbyStateSchema` no longer strips. It is a plain `z.object`, so an undeclared key is
    parsed away with `success: true` and the `satisfies z.ZodType<LobbyState>` guard still passes — an
    absent optional is assignable. `chimera:lobby:get-current-state` therefore dropped `matchSettings`
    and every per-player `attributes` map, and the live `lobby.onUpdate` push (unvalidated) was the only
    reason it went unnoticed. All three are now declared, and `schemas.test.ts` round-trips a
    `Required<LobbyState>` fixture: adding an optional field to the wire contract fails to compile there
    until the schema carries it, so the strip cannot silently return.

    Wire caps: an agent slot's attributes are bounded by the same `WIRE_MAX_PLAYER_ATTRIBUTE_*` caps a
    human's own-seat write frame uses. There is no attribute-setter channel for an agent slot, so the
    caps ride the state frame as well as the `.strict()` `HostLobbyParamsSchema`, whose transform now
    carries the field through. `matchSettings` and a
    player's `attributes` stay uncapped on the state frame, exactly as before: capping them at the
    preload boundary would reject a state the host legitimately broadcast.

    New: `simulation/foundation/quick-start-contract.ts`, a zero-import foundation leaf declaring
    `QuickStartConfig` / `QuickStartSeat` / `QuickStartAiSeat`, plus the optional
    `GameLobbySetup.quickStart` defaults block. Every seat kind carries its own `attributes` (an AI seat
    adds `omniscient?`) — a bare seat count can say how many seats to open but not what any of them is
    playing. It sits on the lobby setup rather than the manifest because a seat's attributes are drawn
    from the same vocabulary as `playerAttributeOptions`, and the lobby setup is built from the game's
    `GameContent`. This is the type both ends compile against.

    Additive throughout — every new field is optional and backward-compatible.

### Patch Changes

- Updated dependencies [c37293d]
- Updated dependencies [4eb8781]
- Updated dependencies [26cab08]
- Updated dependencies [50290b4]
- Updated dependencies [e0bc9a7]
    - @chimera-engine/simulation@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [3af9e43]
    - @chimera-engine/simulation@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [46eba2f]
    - @chimera-engine/simulation@1.0.0-rc.7

## 1.0.0-rc.6

### Minor Changes

- b53c262: A clip change can now blend, and a finished clip stays on its last frame.

    `useClipPlayer` takes a `blendSeconds` option: the seconds to blend out of whatever was
    playing and into the newly declared clip. A clip may also declare the length once, in its
    manifest sheet, as `blendInSeconds`. Omitting the option falls back to that authored
    length, and to no blend when the sheet declares none — so a game that declares neither
    keeps the cut it has today. A `blendSeconds` at the call site overrides an authored one,
    including with a `0`, which asks for a cut. Both are wall-clock seconds and neither
    scales with the dilation multiplier, so a transition takes as long in a slowed-down scene
    as it does at full speed.

    `AnimatedSprite` and `useSpriteClipPlayer` deliberately do NOT take `blendSeconds`: a
    sprite playback rewrites quad UVs and has no weight to interpolate. A sprite clip's sheet
    may still author `blendInSeconds` — the sheet is shared vocabulary — and no sprite
    backend honours it.

    Behaviour an adopter sees without asking for anything:
    - A clip change now closes the outgoing clip's open passages with reason
      `'clip-changed'` instead of `'stopped'`, whether or not a blend was asked for. A
      `loop` change and a `sheet` change do the same. `'stopped'` now means what a caller
      asking for a stop gets — `stop(name)`, `stopAll()`, or declaring `clip: null` — and
      `'released'` still means the player was disposed. A game switching on
      `PassageEndEvent.reason` should read the new value.
    - A `'once'` clip that reaches its end now HOLDS its last frame instead of restoring the
      model's original state on the same tick its `clip-end` handler runs. The pose comes
      down when something asks the player for a change — including declaring another clip,
      which blends out of the held frame when it declares a blend and cuts it when it does
      not.

    An authored `blendInSeconds` that is not a finite number of at least zero now fails
    `validate-assets` at build time, naming the clip, and is dropped with a warning by the
    runtime sheet parser if it reaches one.

- a2f7d10: Close the animation system (F82): author the two remaining invariants, and amend the prose the
  code falsified.

    **Invariant #129** (the last reserved slot, now authored) states that beat-owned gameplay windows
    are host-only — `StateProjector.project()`'s field allowlist omits the registry, so no window
    record ever crosses a boundary — that records are integer or `FixedPoint` throughout because the
    registry is saved and replayed, that `AnimationWindowManager`'s three verbs are pure, and that
    within a match a window leaves through one of the manager's FOUR paths, each reported with a
    distinguishing reason: `'expired'`, `'owner-gone'` (checked first, so it stays the truthful reason
    on the beat the countdown would also have run out), `'replaced'` and `'interrupted'`. The MATCH
    BOUNDARY is deliberately named as not being one of them — `animationWindows` is match-scoped, so
    `engine:start_game` and `engine:return_to_lobby` drop the whole registry with no per-window event,
    in the same reduce that drops a game's own extension fields.

    **Invariant #132** states as a numbered rule that no animation event may gate an
    `EngineAction`. A clip's marks report where a playhead is, and a gameplay consequence derived
    from one would be derived from the frame clock, which no two machines share. The rule is held by
    ABSENT PARAMETERS — `ClipMarkerHandlers` and every event it carries name no dispatcher, no
    `SendAction`, no `PlayerId` and no tick — so a handler has nothing to dispatch with. Stated as an
    invariant rather than left to be inferred from one hook's signature, because a future animation
    surface adding a parameter would be adding it to a shape no rule had claimed.

    The prose sweep is the other half, and it is about one word. `GameSnapshot.tick` counts ACTIONS,
    not beats: an `engine:tick` that fires a timer dispatches children through the same
    `ActionPipeline.process()`, and each one advances the counter. Every doc line that treated the
    two as the same number is amended — most importantly the action-pipeline claim that "each
    `engine:tick` advances the counter by 1", which is exactly what would make a `tick`-difference
    animation clock look correct. `ReplayPlayer`'s "+1 tick per recorded action" is restated as what
    it is, a REFUSAL that bounds what is replayable (a nested `ctx.dispatch` and `engine:undo`/`redo`
    are not), and the two measurably-false replay lines are deleted rather than sharpened.

    No runtime behaviour changes: this is the documentation and invariant half of a feature whose
    code landed across the tasks before it, plus one new engine-side test pinning #132's parameter
    census.

### Patch Changes

- Updated dependencies [0243537]
- Updated dependencies [b53c262]
- Updated dependencies [f59644e]
- Updated dependencies [a2f7d10]
- Updated dependencies [8f6e8fd]
- Updated dependencies [6b600c2]
- Updated dependencies [88680bb]
- Updated dependencies [c4d095d]
- Updated dependencies [1655193]
- Updated dependencies [6cd3bbd]
    - @chimera-engine/simulation@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [7f237bb]
- Updated dependencies
    - @chimera-engine/simulation@1.0.0-rc.2

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

### Minor Changes

- da1f1cd: Let a spectator switch which seat they follow (F72 Spectator Mode). The `SPECTATE_TARGET_UPDATE` wire message is now plumbed end-to-end: the networking transports gain `ClientTransport.sendSpectateTarget(targetPlayerId)` and `HostTransport.onSpectateTargetUpdate((from, targetPlayerId) => …)` (mirrored across the local WebSocket provider — `WsClientTransport`, `MessageRouter`, `WsHostTransport` — and the `InMemoryMultiplayerProvider`); the host derives the spectator from the connection (never a client-supplied id, Invariant #99) and, after validating the requested target is a currently-seated player, re-points the viewer's `SpectatorRegistry` entry and immediately re-broadcasts the new-perspective projection — an unknown or non-seated target is ignored and the perspective is unchanged. A new renderer→main IPC seam drives it: `window.__chimera.spectate.setFollowedTarget(targetPlayerId)` sends the Zod-validated `chimera:spectate:set-target` channel (Invariant #5), which `LobbyManager.setSpectatorTarget` forwards over the joined session's transport. The message is out-of-band / cosmetic: never an `EngineAction`, never advances `tick`, and never enters `ActionHistory`, saves, or replays (Invariant #115).
- d8eacba: Make an admitted spectator actually see the match (Invariant #114). The electron host gains a `SpectatorRegistry` (host-local `spectatorId → followedPlayerId` ledger — never in `GameSnapshot.players`, saves, or replays) and `StateBroadcaster` learns a `spectators` view-source option: every broadcast wave now also sends each spectator `StateProjector.project(state, followedPlayerId)` (one send per wave via snapshot-reference dedupe, reusing the single projection gate — Invariant #8), clock-only ticks are forwarded once per tick value, and a new `broadcastSpectator()` unicasts the perspective snapshot at join time. A spectator joins following the first seated player, is re-pointed to the next seated player when its followed seat deliberately leaves (transient drops hold the target), and leaves the registry on disconnect with no seat release. Networking: `LobbyServer.sendToPlayer` now reaches spectator connections (previously a silent no-op, so spectators could never receive a snapshot), and an `ACTION` arriving on a spectator connection is dropped at the message boundary with a warn — belt-and-braces on top of the host-side registry check that also stops envelopes spoofing a seated player's id. Out-of-band client messages (chat, spectate-target updates) still route.

### Patch Changes

- Updated dependencies [e9f122f]
- Updated dependencies
- Updated dependencies [da1f1cd]
    - @chimera-engine/simulation@1.0.0-rc.0

## 0.9.1

### Patch Changes

- Updated dependencies [483a4ab]
- Updated dependencies [abdd11d]
- Updated dependencies [70e4147]
- Updated dependencies [26da224]
    - @chimera-engine/simulation@0.10.0

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The transport /
  lobby / realtime layer published as `@chimera-engine/networking`, depending on
  `@chimera-engine/simulation`.
