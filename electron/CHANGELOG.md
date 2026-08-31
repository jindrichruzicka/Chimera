# @chimera-engine/electron

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

- c066986: Prove the action app end to end, and fix the defect that proof found: the host never handed a
  game's own lobby `setup` to its `buildInitialEntities` hook.

    `GameDefinition.buildInitialEntities` takes `(playerIds, setup?)`, and its contract in
    `simulation/engine/ActionRegistry.ts` says the second argument is there so a game can seed starting
    entities from the host-authored configuration. Nothing passed it. `resolveInitialEntitiesForGame` dropped the parameter, so every
    game reading it fell back to seat order — and the fallback is invisible from the outside, because
    the picks still ride `snapshot.setup` and every projection afterwards looks correct. The players are
    simply on the wrong pieces. The composition root now builds the setup before the entities and hands
    it over; the restored-host test harness, which mirrors that call, does the same.

    The suite that caught it is `apps/action/e2e/` — the action app's own Playwright project, with its
    own build root (`.e2e-build-action/`), its own throwaway-profile root and its own CI job. Two suites
    sharing either would delete each other's artefacts mid-run, so nothing is shared; the fixtures the
    tactics suite has an equivalent of are this app's own copies, because a game directory may not
    import another's. Its fixture offers no `CHIMERA_E2E` auto-start seam at all: every match here is
    opened by clicking Start, so `chimera:lobby:quick-start` is exercised on its only production path.

    Eight specs: the fresh-profile menu over the live background, held-key movement on the realtime
    heartbeat, autosave-on-leave and Continue restoring the arena as it was left, the Start overwrite
    confirm and both its answers, background persistence across `menu → select → settings`, in-scene
    picking plus a click-through sweep of the shell controls those surfaces carry, each clicked with the
    interactive plate mounted under it, a rebind that reaches the pre-match picker with no match ever
    run, and the pass-and-play seat picking,
    playing and moving on its own keys. The two seats end up on shapes seat order would not have chosen,
    which is what makes the last one the killer for the fix above.

    `ACTION_SHELL_YAW_ATTRIBUTE` / `ACTION_SHELL_DOLLY_ATTRIBUTE` move from `ActionShellCameraRig.tsx`
    to `actionShellCamera.ts`, beside the two describers whose answers they carry — a reader outside the
    renderer needs the attribute name and the phase vocabulary together, and only the plain `.ts` half
    of that pair is reachable from a Playwright runner.

- 4843fe0: `validate-assets` now discovers a game's shell background manifest as well as its
  match one. Asset manifests are found under `apps/` by whole basename, and the set is
  now `asset-manifest.ts` plus `shell-asset-manifest.ts` — the inventory a game forwards
  as the shell payload's `shellBackgroundAssets`, for what its menu background loads
  outside a match.

    Both names go through the same reader, so the shell manifest gets the existing
    statically-readable-ref rules unchanged, is resolved against disk, has its `kind` and
    any cue or animation sheet it carries checked, feeds the per-game manifest-const map,
    and joins the declared-ref set the on-demand membership check is stated over. A
    background asset the shell surface loads is therefore a declared load.

    Invariant #22's manifest-coverage check is deliberately NOT widened: content JSON and
    scene `requiredAssets` are match refs, resolved by the manager `GameShell` builds, and
    that manager is handed the match manifest and never the background's. A content ref the
    match manifest omits still fails even when the shell manifest declares it.

    Two consequences of a game shipping two manifests are documented in §4.10 rather than
    worked around: a const name the two disagree about resolves to nothing (the load
    degrades to the unresolved-ref warning instead of picking whichever file the crawl
    reached last), and the declared-ref union stays workspace-wide, so a shell-only ref
    also satisfies a match-surface load.

    Discovery stays a whole-basename match rather than a suffix or case-folded one: a
    game's test doubles and per-screen helpers must not be read as inventories it ships,
    because a manifest nobody ships satisfying membership is how a ref that is not really
    there passes.

    Nothing changes for a game with no shell background manifest — none exists in the tree
    today and the reported ref count is unmoved.

- Updated dependencies [1686477]
- Updated dependencies [2485e39]
- Updated dependencies [11a218b]
- Updated dependencies [0b1ba72]
- Updated dependencies [d5c3732]
- Updated dependencies [d980cc8]
- Updated dependencies [270bb30]
    - @chimera-engine/renderer@1.0.0-rc.12
    - @chimera-engine/simulation@1.0.0-rc.12
    - @chimera-engine/networking@1.0.0-rc.12
    - @chimera-engine/ai@1.0.0-rc.12

## 1.0.0-rc.11

### Minor Changes

- c37293d: Make the autosave slot a contract, and push a slot update after every autosave.

    The reserved autosave slot used to be a naming convention three modules kept by hand:
    `SaveManager.autoSave` rewrote the header to the inline literal `'autosave'`,
    `SessionRuntime.captureSaveFile` defaulted to the same literal, and the crash path built
    `` `${gameId}/autosave` `` under a comment asking whoever changed one to remember the others.
    `simulation/foundation/save-slots.ts` now owns both spellings — `AUTOSAVE_SLOT_NAME` (the bare
    name a `SaveFile` header carries) and `autosaveSlotId(gameId)` (the qualified id the repository,
    `SaveSlotMeta.slotId` and the renderer all key on) — and `tools/autosave-slot-spelling.test.ts`
    fails on any other production spelling. It parses rather than greps, because the tree is full of
    prose about the slot: the census reads string values only, and only where the name occupies a
    whole `/`-delimited segment, so comments and log messages such as "autosave failed after
    engine:end_turn" are invisible to it.

    `SaveManager` takes an optional third constructor argument, `onSlotsChanged(gameId)`, fired after
    `save()` and after `autoSave()`. The composition root wires it to re-list the game's slots and
    send `chimera:saves:slot-update` to every live window. Before this, only the manual save and
    delete IPC round-trips pushed, so an autosave — after an accepted `engine:end_turn` or from the
    crash reporter — changed the slot list with nothing telling the renderer. A reactive "does an
    autosave exist" consumer went permanently stale after either.

    One push per save, no coalescing and no debounce: the notification count is a fact about writes.
    The saves IPC handler's **save** arm no longer broadcasts — the write already pushed through the
    manager, and doing both would send the same list twice and pay for a second re-list. Its
    **delete** arm still does, because delete is reached only through that round-trip and its
    qualified `slotId` carries no gameId the manager may parse. A listener that throws is reported
    and swallowed, and the composition root's push swallows a rejected re-list: the file is already
    durable by then, and on the crash path a failed refresh must not raise a second failure on top of
    the one being reported. That push skips destroyed windows and destroyed `webContents`, which the
    crash path is the reason for.

    Renderer: `selectHasAutosave(gameId)` and its hook `useHasAutosave(gameId)` on `saveStore`. Both
    match the qualified id, so another game's autosave and a slot merely ending in the name read as
    absent, and both fall back to `false` when the autosave is deleted rather than latching.

    The save file format, the repository and the restore funnel are untouched (Invariants #24, #59,
    #108).

- 4eb8781: Add the `chimera:lobby:close-session` verb and fork the in-game Leave on the session-mode stamp — the
  exit a lobby-less, quick-started session needs, since it has no lobby to go back to.

    `closeSession({ autosave })` is atomic by contract: one call captures the game's autosave (when
    asked) and then tears the session down. A game-side "save, then leave" pair would race — a leave that
    landed first leaves the capture with no session to read — so the pair is not offered. The composition
    root's port composes exactly the two steps the crash path already composes,
    `SessionRuntime.captureSaveFile` → `SaveManager.autoSave`, and then the public `closeLobby()`; there
    is no second save reader or writer and no `engine:save` dispatch, so the capture stays an out-of-band
    host call and the `chimera:saves:slot-update` push still fires from the single `SaveManager`
    `onSlotsChanged` seam. A "Continue" offered right after the exit therefore finds the fresh autosave.
    `activeSession !== null` is the host gate: the reference is set only inside `onSessionHosted`, so a
    joined client is refused and leaves through `chimera:lobby:leave` as before.

    `useLeaveGame`'s host path now picks its exit by reading `engine.sessionMode` off the live snapshot's
    `setup`: `'quick'` closes the session and raises the leaving-to-main-menu intent (routing owns the
    fade, the snapshot reset and the navigation); anything else — including every save written before the
    stamp existed — keeps today's `returnToLobby()` → `/lobby` path byte for byte. Reading the stamp off
    the snapshot rather than off renderer-held state is what makes the answer survive a window reload and
    a save restore.

    `InGameMenuProps.leaveGame` widens to `(options?: LeaveGameOptions) => void`, and the renderer's
    `LeaveGame` type with it. `autosave` defaults to `true`, so an Escape-exit keeps the match and a menu
    that offers "abandon" must ask to discard. It is deliberately NOT the `gameplay.autoSave` user
    setting: that toggle governs turn-interval autosaves during play, so reading it here would silently
    lose the match for a player who turned it off. The option is ignored wherever the session survives
    the leave.

    New on the bridge contract: `CloseSessionParams` and `LobbyAPI.closeSession(params): Promise<void>`,
    reached from the renderer as `window.__chimera.lobby.closeSession`. `RegisterLobbyHandlersOptions`
    gains a required `closeSession` port, mirroring `quickStart` — a composition root that forgot to wire
    it cannot register a lobby namespace with the verb silently missing.

    Two things outside the fork also change. The renderer's lobby-bridge resolver now
    also requires `closeSession`, so a bridge double in a game's own tests needs the third verb. And the
    replay player now answers the leave-to-main-menu intent itself, which fixes a client's Leave from a
    post-game replay: it raised that intent, and on that route nothing consumed it, so the leave
    disconnected and then went nowhere. It now lands on the main menu.

- 50290b4: Add the `chimera:lobby:quick-start` verb and the `QuickStartCoordinator` behind it — the one-click
  path from a shell screen into a playable match, skipping the lobby UI.

    It is orchestration sugar, never a second session constructor. `QuickStartCoordinator`
    (`electron/main/runtime/QuickStartCoordinator.ts`, beside `SessionRestoreCoordinator`) is
    ports-injected and holds no session objects; the lobby half of its ports is a structural slice of the
    public `LobbyManager`, pinned assignable at compile time by its own test, so a port cannot grow into
    a bespoke session door. The sequence: guards (active session, active restore, quick start already in
    flight) → merge the game's `GameLobbySetup.quickStart` defaults UNDER the request →
    `maxPlayers = 1 + localSeats.length + aiSeats.length`, a roster exactly full by design →
    `hostLobby({ gameId, maxPlayers, agentSlots })` with the AI roster pre-seeded atomically through the
    existing `agentSlots` seam (never an `addAi()` loop against a roster still being filled) → stamp
    `engine.sessionMode` → apply the merged match settings, the host's attributes and each pass-and-play
    seat's → ready → start.
    Any throw after the lobby exists tears it down with `closeLobby()`, so a failed start never leaves a
    session behind; a failure of the teardown itself is logged and the caller still sees the failure that
    broke the start.

    New reserved match-setting key `SESSION_MODE_SETTING` (`'engine.sessionMode'`) and its one value
    `SESSION_MODE_QUICK` (`'quick'`) in `foundation/game-lobby-contract`, joining
    `ALLOW_SPECTATORS_SETTING` under the engine's `engine.` namespace. Unlike that one it is not
    host-settable: `SetMatchSettingPayloadSchema` refuses the key and `QuickStartParamsSchema` refuses it
    inside a requested `matchSettings` map, so neither a custom lobby screen nor a game's own quick-start
    defaults can flip it. It rides `matchSettings` into `snapshot.setup`, so it survives a window reload
    and a restore; its absence means the session was born in the lobby.

    New on the bridge contract: `QuickStartParams` (a `QuickStartConfig` addressed at one `gameId`) and
    `LobbyAPI.quickStart(params): Promise<LobbyInfo>`, reached from the renderer as
    `window.__chimera.lobby.quickStart`.

    `AddLocalSeatOptions` gains `attributes`, merged per key OVER whatever the seat already carries — the
    descriptor's seat defaults for a fresh seat, the seat's own picks on a re-add. This is how a
    pass-and-play seat's picks are authored: such a seat has no connection, so the own-seat
    `setPlayerAttribute` channel cannot reach it, and on a shared machine the host connection owns it.
    Host-time seeding only; there is still no runtime attribute channel for a local seat.

    Behaviour-neutral for every existing flow: `buildSetupFromLobbyState` and `matchId` minting are
    untouched, no shipped flow ever authored `engine.sessionMode` on the newly-refusing
    `chimera:lobby:set-match-setting` boundary, and a game that declares no `quickStart` block simply
    has no quick-start defaults to merge.

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

- a338540: Fire the match-start lifecycle for AI-completed rosters, and hold the wall-clock heartbeat until
  the session leaves the lobby.

    `seatLobbyAgentsForGameStart` seated the lobby's AI into the active roster but never re-entered
    the start gate, so a roster that only reached its seat count inside `onGameStartRequested` —
    host plus lobby-added AI, the ordinary single-player shape — never fired
    `SimulationHost.onGameStart` and never started `RealtimeTicker`. Tactics survived because its AI
    is pumped from `afterTick`; a `manifest.realtime` game would have started frozen.
    `onGameStartRequested` now re-enters the gate itself, after `engine:start_game` is applied and
    after the first player's turn memento is seeded — `onGameStart` reaches an AI brain's state
    machine synchronously, so a memento seeded behind it would take a human's undo baseline from a
    snapshot already carrying an AI's move.

    The gate's two halves ask different questions and are now gated separately. `onGameStart` fires
    once the roster is SETTLED, which normally means full — the missing seats are ones the session is
    waiting for — but `LobbyManager.startGame` gates on readiness and not on a full lobby, so the
    start request additionally declares the roster final and an under-cap start no longer waits for a
    seat that is never coming.

    The heartbeat now arms on the session having LEFT THE LOBBY, not on roster completion. The two
    are not the same moment: a roster can be full while the host still holds the lobby open (host-time
    `agentSlots`, or every human already joined), and a lobby-phase `engine:tick` is not inert — the
    reducer admits it in every phase and advances the clock. An early arm therefore shifted the tick
    `engine:start_game` is stamped with and wrote pre-start beats into the deterministic recording,
    which is armed back at host time. Measured before the fix: ten lobby heartbeat periods produced
    ten `engine:tick` envelopes in the recording ahead of `engine:start_game`; after it, the first
    recorded action is `engine:start_game`. The arm EXCLUDES `lobby` rather than allow-listing
    `playing`, because a game names its own in-match phases and a restored save carries whichever one
    it was in.

    Recording arming stays in `onSessionHosted` and `engine:start_game` semantics are unchanged
    (Invariants #71, #101).

- Updated dependencies [c37293d]
- Updated dependencies [4eb8781]
- Updated dependencies [edcc2e6]
- Updated dependencies [26cab08]
- Updated dependencies [50290b4]
- Updated dependencies [e0bc9a7]
- Updated dependencies [e670ba7]
- Updated dependencies [18dffa6]
    - @chimera-engine/simulation@1.0.0-rc.11
    - @chimera-engine/renderer@1.0.0-rc.11
    - @chimera-engine/networking@1.0.0-rc.11
    - @chimera-engine/ai@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [8459288]
    - @chimera-engine/renderer@1.0.0-rc.10
    - @chimera-engine/simulation@1.0.0-rc.10
    - @chimera-engine/ai@1.0.0-rc.10
    - @chimera-engine/networking@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [49a69db]
- Updated dependencies
- Updated dependencies [3af9e43]
    - @chimera-engine/renderer@1.0.0-rc.9
    - @chimera-engine/simulation@1.0.0-rc.9
    - @chimera-engine/ai@1.0.0-rc.9
    - @chimera-engine/networking@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [60e960a]
- Updated dependencies [7a1e654]
- Updated dependencies [8c10f64]
- Updated dependencies [8b2ce0e]
- Updated dependencies [7aa61d4]
- Updated dependencies [0467678]
- Updated dependencies [62f29bc]
    - @chimera-engine/renderer@1.0.0-rc.8
    - @chimera-engine/simulation@1.0.0-rc.8
    - @chimera-engine/ai@1.0.0-rc.8
    - @chimera-engine/networking@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- Updated dependencies [0f855c6]
- Updated dependencies [46eba2f]
    - @chimera-engine/renderer@1.0.0-rc.7
    - @chimera-engine/simulation@1.0.0-rc.7
    - @chimera-engine/ai@1.0.0-rc.7
    - @chimera-engine/networking@1.0.0-rc.7

## 1.0.0-rc.6

### Minor Changes

- ae63209: Widen the published glTF test-support reader to the animation surface, and prove the clip-player
  end to end from a real game with real content.

    `@chimera-engine/electron/test-support` gains `GltfAnimation`, `GltfAnimationChannel` and
    `GltfAnimationSampler`, and `GltfDocument.animations` is now `readonly GltfAnimation[]` instead of
    `readonly GltfNamed[]`. TYPES ONLY — `readGlbDocument` ends with `return parsed as GltfDocument`
    over the raw glTF JSON, so the parser is unchanged. Every field stays OPTIONAL because the reader
    casts unvalidated JSON: a required field would be a type-level lie for exactly the malformed
    container `MalformedAssetFileError` exists to make loud, and a caller mapping over a malformed
    animation's `samplers` gets `undefined` to handle rather than a TypeError naming no file.

    What the widening buys is the one number a clip sheet claims and no build gate checks. A sheet
    names a clip, a length and positions inside it; `validate-assets` checks the sheet is
    self-consistent and that the file exists, and `compileAnimationWindows` checks the authored beat
    window against the authored phases. All three read the SHEET. None opens the model — so a
    re-export that renamed the clip or shortened it leaves every gate green and the marker firing at
    the wrong instant. The clip's real length lives at `accessors[sampler.input].max[0]`, the one
    place outside `POSITION` where glTF requires an accessor to declare its bounds, and reading it is
    now possible.

    The reference game adopts the surface on its existing `/model-showcase/` test route, against a
    GENERATED fixture: `tools/gen-showcase-animated-glb.ts` emits `showcase-rig-animated.glb` from
    readable source numbers, `pnpm gen:showcase-glb` writes it and `pnpm verify:showcase-glb` fails if
    the committed bytes are not the generator's output. A `.glb` cannot be diffed, grepped or
    reviewed, so a comment claiming what one contains is unfalsifiable; a program that emits it is
    not. Every quaternion component in that generator is an authored decimal literal rather than a
    `Math.sin` call, and every keyframe time is exactly representable in float32 — ECMAScript leaves
    `Math.sin` implementation-defined, and at a 0.3 s spacing the accessor's `max` reads back as
    `1.2000000476837158`, a number no manifest can author.

    No engine runtime behaviour changes: the additions are types, a dev tool and a reference-game
    adoption.

- 503dd92: Publish asset-fact readers for game tests at a new
  `@chimera-engine/electron/test-support` subpath, and ship a wired asset manifest plus a
  full-bleed scene host in the blank scaffold template.

    **`@chimera-engine/electron/test-support`.** `chimera-validate-assets` checks that a
    declared ref resolves to a file that EXISTS (Invariant #52 is membership-only) and that a
    cue sheet is internally coherent (Invariant #125). Neither opens the file. So the class of
    defect where a manifest and its bytes disagree — an authored `durationSeconds` that is not
    the clip's real length, a re-exported model that dropped the bone a screen poses by name, a
    container truncated by a bad copy — is invisible to the build and surfaces as a mis-timed
    cue or an empty scene at runtime. Binary assets make this worse than ordinary drift: a
    `.wav` or `.glb` cannot be diffed or grepped, so every claim about one is prose until
    something parses it.

    ```ts
    import { assetPathForRef, readWavFacts } from '@chimera-engine/electron/test-support';

    const wav = readWavFacts(assetPathForRef(here, myAudioRefs.theme));
    expect(wav.durationSeconds).toBe(myMusicCues.durationSeconds);
    ```

    `assetPathForRef` maps a declared ref onto its path under the game's own `assets/`
    (Invariant #97), resolving the grammar through the engine's own `parseAssetRef` so it
    cannot drift from the runtime resolver — including the traversal rules. `readWavFacts`
    walks the RIFF chunk list rather than assuming the canonical 44-byte layout (a re-encode
    may splice `LIST`/`fact` ahead of `data`) and refuses to hand back samples for an encoding
    it cannot read, instead of quietly pairing bytes into a plausible number.
    `readGlbDocument` parses the glTF JSON chunk at its declared length, never to
    end-of-file. A malformed container raises `MalformedAssetFileError` naming the path and
    what disagreed.

    The module imports no test framework: `expect` would make it unpublishable, since
    `verify:publish`'s depcheck fails a published `.js` importing an undeclared runtime
    dependency and `vitest` is a root devDependency only. Tactics adopts it as the reference
    consumer, and now asserts what `showcase-rig.glb` actually declares — its unlit extension,
    the `top` bone its showcase poses by name, its embedded buffer and its authored quad
    extents. The model-instances e2e already reddened on three of those four, by launching
    Electron and comparing a pose attribute or a pixel; these read the fact off the bytes and
    name it.

    **The blank template now ships `asset-manifest.ts`.** Empty (`entries: []`), with a
    commented worked example, and — the part that matters — already forwarded through
    `renderer/loaders.ts`. `LoadedRendererGame.assetManifest` is optional, so a game that never
    returns one compiles, typechecks, lints and passes `validate:assets` clean, then rejects
    every asset load at runtime with `UnknownAssetManifestEntryError`. Wiring it from the start
    means an author's first asset is one array entry. It ships with a manifest test written as
    loops over `entries`, so it costs nothing while empty and starts checking refs, scoping and
    container validity at the first declared asset — rather than pinning the manifest empty and
    reddening the moment someone follows its instructions.

    `verify:scaffold` grew the matching non-vacuity arm: `Checked 0 asset refs` is
    byte-identical to what a tree with no manifest reports, so the gate now plants one valid
    entry into the scaffolded manifest and requires the count to move — proving discovery at
    the exact basename, that `entries` is a literal the tool can walk, and that the ref
    resolves into the app's own asset directory.

    **The scaffold ships `ai/`, `data/` and `components/`, held open by a `.gitkeep`.** These are three
    of the canonical game directories `apps/tactics` grew into that previously carried no day-one
    file, so a scaffolded game simply did not have them — the copier emits files, and an empty
    directory is not a file. Shipping them costs nothing at build time (a directory holding only
    `.gitkeep` is invisible to ESLint and to `tsc`, which select by extension) and it puts an
    author's first agent policy, content payload or reusable component where the guards already
    expect it: an `ai/` module is inside the `chimera/no-fromfloat-in-simulation` zone from its
    first line — in both scaffold modes — rather than after someone notices the directory should
    have existed. (A `--workspace` game inherits more than that from the monorepo's root config;
    the standalone preset is the narrower of the two, and `curated-rules.ts` records which
    `chimera/*` rules it withholds, with a reason per rule.)

    `components/` carries one split worth stating, now documented in the scaffold README:
    `screens/` holds only what the screen registry names, and everything those screens are built
    from — shared React, shared hooks and stores, and the in-Canvas `three` / `@react-three/fiber`
    primitives — goes in `components/`. The `<GameCanvas>` itself stays in the screen, which
    renders the primitives as its children.

    **The scaffolded playfield is now a full-bleed scene host.** `position: absolute; inset: 0`
    on the screen's root element, which is where a `<GameCanvas>` goes. This fixes a real
    failure: sized the obvious way, with `block-size: 100%`, the canvas renders into a short
    strip at the top of a full-screen window — no error, no warning, and it reads as a broken
    camera rather than a broken layout. The mechanism is written out in
    `docs/core-components/camera-system.md` §4.22 "Sizing the wrapper"; the host geometry it
    turns on is now pinned by `GameShell.test.tsx`.

    The renderer change is documentation: `GameCanvas`'s `className` JSDoc described the
    failure as "zero-height", which understates the common case, and
    `docs/core-components/camera-system.md` stated the wrapper requirement only under its
    multi-canvas/overlay heading. Both now state the rule and the real failure for every canvas
    role, as does the `PlayfieldScreen` example in `docs/architecture-overview.md` — which
    showed `<GameCanvas>` as a bare screen root and reproduced the strip verbatim if copied.

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

- f5e678d: Publish the Chimera architecture-lint rules at a new
  `@chimera-engine/electron/eslint` subpath. Until now they lived in the repo-root
  `tools/` package, which is never published, so a game that left the monorepo lost every
  architectural guardrail: a `fromFloat()` in a reducer (Invariant #76), a hardcoded hex in
  a screen (Invariants #86/#91), an undeclared `--ch-*` token override (Invariant #85) or a
  deep reach past the renderer's public barrels (Invariant #96) all went unflagged.

    The rules now live at `electron/dev-tools/eslint/`, compile to
    `dist/dev-tools/eslint/**` under electron's own build, and are exported as a plugin
    object named `chimeraPlugin`. It ships **no bin**: a flat config imports the plugin,
    nothing spawns it.

    ```js
    import { chimeraPlugin } from '@chimera-engine/electron/eslint';
    // then, in a flat config block:
    { plugins: { chimera: chimeraPlugin }, rules: { 'chimera/no-fromfloat-in-simulation': 'error' } }
    ```

    The monorepo's own root config now loads that same compiled artifact, so the engine and
    its consumers enforce identical code from one file rather than two. That retires a CJS
    bridge which registered `tsx` and `require`d the rules' TypeScript at lint time — nothing
    transpiles during a lint run any more. The trade is a build-order dependency: the config
    resolves `electron/dist`, so a lint run against an unbuilt package fails loudly, naming
    the missing `dist` file and the config that imported it. The root `lint` script and both
    CI lint steps already build first.

    One rule needed repairing to survive the move. `no-unknown-token-overrides` read its base
    token set by walking three directories up from its own module URL — an expression that
    happened to land on the repo root at the old location, would have landed inside
    `electron/` at the new one, and lands nowhere a consumer has from inside an installed
    `dist/`. It now resolves the published
    `@chimera-engine/renderer/styles/tokens.css` subpath, so the monorepo and a standalone
    install read the same token set by the same route, and the base-token path is injectable
    so the rule's own tests need no renderer build.

    `eslint` is declared as an **optional** peer dependency, matching the posture of
    `electron` and `sharp`: the edge is type-only and lint-only, and nothing in
    the runtime surface (`./main`, `./preload/*`, `./packaged-bundle`) touches it.

    The games-facing preset that composes these rules onto a game's own flat zones is not
    part of this release; only the plugin object is exported so far.

- 3599ceb: Add the `chimera-fetch-fonts` bin — the Google-Fonts self-hosting downloader (the
  development-time tooling Invariant #97 sanctions) is now runnable from a standalone
  scaffolded game, not just via the monorepo `pnpm fetch:fonts` script. The tool ships as
  pre-built node ESM at `dist/dev-tools/fetch-google-fonts/index.js` (chimera-dev-mp
  precedent) and gains optional `--out-dir` / `--src-prefix` flags whose defaults reproduce
  the monorepo output byte-for-byte; a relative `--out-dir` resolves against the invocation
  cwd, which is what lets an app-level script land the `.woff2` files in the game's own
  `assets/fonts` directory. The emitted `GameFontFace.src` prefix is guarded to stay a
  relative committed-asset reference — absolute, backslash-rooted, or scheme-prefixed
  values are rejected before any download.
- a3e87da: Add the `chimera-generate-icons` bin — the platform icon-set generator is now runnable
  from a standalone scaffolded game, not just via the monorepo `pnpm icons:generate`
  script. The tool ships as pre-built node ESM at `dist/dev-tools/generate-icons/index.js`
  (chimera-dev-mp precedent), with a `#!/usr/bin/env node` shebang — legal module syntax
  that `tsc` emits unchanged and node ignores under every loader, so the monorepo form
  keeps working.

    Its CLI entry guard is the shared dev-harness `isDirectInvocation` rather than a local
    copy. The local copy compared `import.meta.url` against a raw `process.argv[1]`, and a
    pnpm bin shim execs node with the path THROUGH the `node_modules` symlink while node
    realpaths the main module — so the comparison never matched and the bin exited 0 having
    written nothing. Measured against the built artifact: through a symlink the naive guard
    exits 0 with zero files written, the shared one writes all eleven.

    The CLI also stopped deriving its default paths from its own module location. It now
    resolves `--source`/`--out` defaults against the current working directory, matching
    every sibling dev-tool: from the repo root — the cwd `pnpm icons:generate` runs with —
    the engine-relative defaults resolve exactly as before, while a module-relative
    derivation would have pointed the published bin at `docs/assets/` and `electron/assets/`
    paths under the installed package, which no consumer has. Run bare where no master
    exists, the bin now names both flags and exits non-zero instead of surfacing an ENOENT
    on a path the caller never chose.

- 0a463cd: Add the `chimera-validate-assets` bin — the asset-reference validator behind Invariants
  #22/#52/#97/#125 is now runnable from a standalone scaffolded game, not just via the
  monorepo `pnpm validate:assets` script. The tool ships as pre-built node ESM at
  `dist/dev-tools/validate-assets/index.js` (chimera-dev-mp precedent), with a
  `#!/usr/bin/env node` shebang — legal module syntax that `tsc` emits unchanged and node
  ignores under every loader, so the monorepo `pnpm validate:assets` form keeps working.

    Its CLI entry guard is now the shared dev-harness `isDirectInvocation` rather than a
    local copy. The local copy compared `import.meta.url` against a raw `process.argv[1]`,
    and a pnpm bin shim execs node with the path THROUGH the `node_modules` symlink while
    node realpaths the main module — so the comparison never matched and the bin exited 0
    having written nothing. For a validator that failure is invisible: a run that checked
    zero refs is indistinguishable from a clean tree. The shared implementation
    canonicalises both sides.

- 2b0aea3: The `build:app` Electron bundle plan moves into a new engine export, behind thin app-owned drivers (§4.12).

    `@chimera-engine/electron` gains a public `./build-main` subpath holding the bundle plan every
    consumer app's `build:app` runs: the packaging `define` that folds the debug gate dead
    (Invariant #27), the esbuild alias / `nodePaths` derivation, the output layout, and the bundle list.
    It is the same engine-owns-the-logic / app-owns-the-paths split as `./packaged-bundle` beside it,
    and for the same reason: the plan was previously shipped as two code-identical copies in this repo
    plus a third minted into every scaffolded game, where it froze at scaffold time. A fix to the
    `define` reached an existing adopter only if they hand-merged a file they had been told never to
    edit, and the shipped copy was invisible to every static tool here — lint-ignored, outside
    `tsconfig.json`, outside vitest — reaching the real assertions only through a single string-equality
    line.

    `apps/<game>/electron/build-main.ts` and the blank template's copy are now ~60-line drivers holding
    only what the engine must not: the app's paths, its module resolution, and esbuild itself. `esbuild`
    stays app-side and the published dependency surface is unchanged — the plan declares its own
    structural `EsbuildBundleOptions` rather than importing esbuild's types, which a new test ratchets
    in both the source and the emitted `dist` (a type-only import would erase before `verify:publish`'s
    depcheck could see it).

    `buildAppBundles` gains a plan-shaped `overrides` escape hatch — `mainEntry`, extra `alias` entries,
    per-label `external` additions, and `extraBundles` for a utility-process worker or a second preload.
    It is deliberately plan-shaped and not esbuild-shaped: no hook reaches esbuild's option set, because
    the packaged-build assertions execute the shipped invocation rather than reading it, and an
    "extra esbuild options" hook would re-open exactly the hole that closes. `verifyPackagedBundle`
    gains a matching `extraShipped`, so an extra bundle that ships is scanned for the debug layer and
    accepted in the `electron-builder.yml` `files:` allowlist instead of being rejected as unexpected.

    For scaffolded games this resolves a contradiction the template shipped: `build-main.ts` said "never
    edit it after scaffolding" while `verify-packaged-bundle.ts` said the opposite. The driver is yours
    to edit; the plan it drives is not, and now it does not have to be.

    One published type changes shape: `ElectronBuilderCheckOptions.extraShipped` is REQUIRED, not
    optional. It is the parameter type of `electronBuilderDistFailures` and `electronBuilderControlGaps`,
    which are exported for testing the predicates directly — a caller passing `{ appDir, outfiles }` now
    needs `extraShipped: []`. Nothing that drives the gate through `verifyPackagedBundle` is affected;
    that entry point keeps the field optional and normalizes it. The requirement is deliberate: it is what
    makes a re-spelled subset of the app's planned file set a compile error rather than a step that
    silently stops seeing an extra bundle.

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

- 8f6e8fd: Asset-gated scene reveal: a scene's declared `requiredAssets` now gate what a player
  SEES, on both entry paths, without ever gating a mount or the host's barrier.

    Before this, `SceneDescriptor.requiredAssets` was a declaration `validate-assets`
    checked and no code read at runtime. A scene could name every ref it needed and the
    player would still watch them pop in after the fade.

    **The declaration now travels on two carriers.** A scene being ENTERED carries it on
    `SceneTransitionState.requiredAssets`, which `startScenePreload` promotes and awaits
    before the client dispatches `engine:scene_ready`. A scene already COMMITTED carries it
    on the new `BaseGameSnapshot.sceneRequiredAssets`, which `useCriticalAssetPreloadGate`
    promotes for a route entered mid-scene — a restore or a replay — so that path is gated
    too rather than only a live transition.

    **Fail-open is the guarantee, not a fallback.** Both arms settle on four independent
    paths: the load resolving, the load REJECTING, an elapsed budget
    (`CRITICAL_ASSET_PRELOAD_BUDGET_MS` = 8 s for the route arm,
    `SCENE_PRELOAD_BUDGET_MS` = 5 s for the transition arm), and a nothing-to-load
    short-circuit. No combination of a missing,
    slow or undeclared asset can produce a permanently black screen. The transition arm's
    ack fires on all four outcomes deliberately: the host barrier waits for every player and
    evaluates `timeoutTicks` only when an action is applied, so a turn-based match has no
    ticker to time a withheld ack out — withholding it would freeze the match rather than
    degrade it.

    **A gate withholds a reveal, never a MOUNT.** `GameShell` mounts on the same commit it
    did before, which is what keeps the unique disposer of a page-injected `AssetManager`
    reachable; `/replays/player`'s `isReady` is unchanged for the same reason, and its cover
    is an overlay above a mounted shell.

    **Two new optional `GameScreenRegistry` slots.** `loadingScreen` covers every screen key;
    `loadingScreens[key]` covers one, and `'none'` opts a key out of a registry-wide cover.
    Either accepts a component, a static `{ message }`, a static `{ image }`, or the
    `'spinner'` / `'progress'` presets. They resolve through ONE cascade and render at three
    sites — a suspended code-split chunk, a scene transition, and a route entry — always as a
    SIBLING of the transition overlay, never inside its `aria-hidden` subtree. **The default is unchanged from before the slots existed: a game that declares neither gets the engine's own empty placeholder, which is what the Suspense site rendered before.**

    Properties you can rely on:
    - A declared ref that is `deferred` in the manifest is promoted for the run and restored
      by nothing — the promoted manifest is built from the same base object, so entry
      equivalence keeps every cached ref and `registerManifest` evicts none.
    - `engine:scene_ready` still carries `{ playerId }` and nothing else. No client's load
      timing, fraction or outcome enters authoritative state.
    - Neither budget collapses under `NEXT_PUBLIC_CHIMERA_E2E`. The e2e build is where a
      never-releasing gate is observed; disabling it there would make its own spec pass
      vacuously.

    One caveat worth knowing before you rely on the route arm:
    - **The guarantee is scoped to a live, rendering client.** A seat in `state.players` with
      no mounted `SceneRouter` — a disconnect mid-transition, or an AI seat — can already
      stall the host barrier today. This change does not fix that, and the budgets are chosen
      so it does not meaningfully widen the window.

- 76f546d: **A game app's `scene/` is now `components/`, and it holds every reusable piece of the game's UI — not only the parts that render inside the Canvas.**

    `scene/` named a technology. The split it produced ran along the wrong seam: a mesh went in `scene/`, but a shared React panel, a hook two screens had to agree on, and an ambience component that only ever plays audio all had nowhere to go and piled up in `screens/` next to the registry entries. `screens/` was reading as "React UI" when what it actually contains is the set of components the `GameScreenRegistry` names.

    The new line is about reuse, not about rendering target:
    - **`screens/`** — only what the screen registry names: playfield, HUD, in-game menu, post-game summary, result banner.
    - **`components/`** — everything those screens are built from. Shared React components, shared hooks and stores, and the `three` / `@react-three/fiber` primitives a screen renders as children of its `<GameCanvas>`.

    In `apps/tactics` that moved the whole former `scene/` (ground plane, minimap, unit primitive, selection ring, camera and scene model, the model showcase) plus `TacticsAmbience` and `useCommitmentBuffer` out of `screens/`. The blank template's growth directories are now `ai/`, `data/` and `components/`.

    **`components/` is an Invariant #96 renderer surface.** This is the substantive rule change, and it follows from the merge: a shared component that plays a cue needs `@chimera-engine/renderer/audio` exactly as a screen does, so the old "a module in `scene/` may not import from `@chimera-engine/renderer` at all" cannot survive alongside it. `chimera/no-game-renderer-internals` now admits `apps/<name>/components/*.{jsx,tsx}` alongside `screens/` and `shell/`; the extension gate is unchanged, so a plain-`.ts` helper in any of the three is still not a surface, and every non-surface directory in a game app stays blocked whatever the extension. The invariant checker's Checks 6, 17, 23 and 24 widened to the same directory, and `chimera-validate-assets` now walks `apps/<name>/components/` for on-demand asset loads — anchored at the `apps/<name>/<surface>` position rather than added to the bare-segment set, since `components` is a name that recurs at any depth.

    One zone deliberately did **not** widen: `chimera/no-hardcoded-design-values` still reaches `screens/` only. `components/` holds the in-Canvas primitives, whose `three` material colours are not CSS values and cannot be expressed as `var(--ch-*)`, so widening the rule as written would red the directory it was widened onto. The consequence — a DOM component in `components/` has its colour and size literals unchecked — is now stated in `docs/core-components/dev-tooling.md` next to the pre-existing `shell/` half of the same gap, and in the scaffold README.

- 6b600c2: A scene transition waiting on a seat that cannot acknowledge is now released by a host-side
  budget, instead of holding forever.

    The barrier requires an `engine:scene_ready` from every key of `state.players`, and that action
    has exactly one producer — `useFadeTransition`, inside a mounted `SceneRouter`. A seat with no
    renderer never sends one: an AI seat has no renderer at all, and a disconnect mid-transition
    leaves the seat in `state.players` with its renderer gone (no engine action removes a seat).
    `SceneTransitionState.timeoutTicks` could not cover for it either, because a tick advances only
    when an action is applied and a turn-based match applies none while a transition is pending.

    `SessionRuntime` now measures a pending transition against a wall clock —
    `DEFAULT_SCENE_TRANSITION_BUDGET_MS`, 30 s, above every client-side budget it has to outlast so
    a slow-but-live client is never mistaken for a seat that cannot ack — and dispatches a new
    host-only engine action, `engine:scene_expire`. That action carries no payload and decides
    nothing: it sets `SceneTransitionState.expired`, which `isTransitionTimedOut` reads beside the
    tick budget, so the descriptor's own `onClientTimeout` still chooses between committing and
    dropping exactly as it does when the tick budget elapses.

    The wall clock stays in the host runtime; the reduce remains pure and clock-free, and
    `engine:scene_ready` still carries `{ playerId }` and nothing else — no client's load timing
    enters authoritative state.

    Worth knowing before a game adds a transition: in a match with an AI seat the acks can never
    complete the barrier, so this budget is not a rescue there but the release path, and every scene
    hop costs it in full. A game that adds a transition should pick `sceneTransitionBudgetMs` with
    that case in mind.

- 846982d: Add `chimera/no-animation-derivation-in-reduce`, the tenth rule in the `chimera` ESLint plugin
  and the sixth the standalone preset curates. It reports a `compileAnimationWindows(...)` or
  `beatsForRealSeconds(...)` call made from inside a function named `reduce` or `validate`. Both
  derive a beat count from `tickRateMs`, the host's pacing knob, and both belong at content-load,
  where the derivation is compared once against the window the game authored. Called at reduce
  time they make the LENGTH of a gameplay window a function of the tick rate: raising it silently
  widens or narrows every window in the game, and two hosts on different rates diverge.

    Both halves of the rule are name-based and both are checked. WHAT: the two callees, in either
    the bare or the `namespace.member` position, so a re-export cannot launder the call. WHERE:
    lexical containment in a function BOUND to one of the two names — its declaration name, its
    variable, its object or class key, or its assignment target. A callback merely handed to
    `Array#reduce` is bound to nothing and is not a `reduce` body, which is the false positive the
    rule's name invites.

    Unlike its `no-fromfloat-in-simulation` sibling it declares no path predicate of its own: the
    flat-config zone that switches it on IS its scope. In the monorepo that is `simulation/**`,
    `apps/*/simulation/**` and `apps/*/ai/**`, off under `simulation/content/loaders/**` and on test
    files; in a standalone game the preset maps it onto `simulation/**` and `ai/**` with the same
    test-file exemption. The practical difference from its sibling is that its `ai/**` arm stays
    live for a game that does not sit under an `apps/<name>/` directory.

    The zone is proved by `--print-config` against real files in `simulation/__tests__/eslint-animation-derivation-zone.test.ts`,
    because a rule can be correct, registered and resolvable while guarding zero files.

- e8004e9: New `chimera/no-dynamic-games-import` lint rule (Invariant #1), plus dynamic-`import()` coverage for two existing rules.

    Stock `no-restricted-imports` never visits `ImportExpression`, so every zone that banned a game through it was silent on `import('…/apps/<game>/…')`. The new rule covers that position. It classifies a game the way its sibling `chimera/*` game-import rules do — an `apps/`/`games/` path segment, or a non-engine `@chimera-engine/*` package — which is broader than any one zone's `no-restricted-imports` group, so neither guard subsumes the other. It carries no path predicate of its own: the flat-config zone that declares it is its scope.

    `chimera/no-main-provider-internals` now reads a no-substitution template specifier, so ``import(`…/networking/provider/local/…`)`` is caught alongside the quoted form. `chimera/no-game-renderer-internals` gains an `ImportExpression` visitor, so Invariant #96's game-side barrel boundary holds for a code-split load as well as a static one.

    Withheld from `standaloneLintConfig()`: a scaffolded game is itself a non-engine `@chimera-engine/*` package and self-imports through that specifier, so a game that code-splits one of those self-imports would be reported for lazily loading itself. `curated-rules.ts` records the reason as data, alongside the other withheld rules.

- 754bfe0: New `chimera/no-raw-r3f-canvas` lint rule (Invariant #127): a game surface must not obtain the `Canvas` binding from `@react-three/fiber` — `GameCanvas` (`role="main" | "overlay"`) is the only canvas root a game mounts. The rule is name-based, so `useFrame`, `useThree`, and type-only imports from the same specifier stay legal; it catches the named import, the aliased form, re-exports, and namespace member access (`fiber.Canvas`, `<fiber.Canvas>`). Registered in `chimeraPlugin` and carried by `standaloneLintConfig()`, so scaffolded games get it on the whole app like the renderer-barrel boundary rule.
- e071111: Re-pace `RealtimeTicker` by the host snapshot's `timeScalePermille` (F82).

    `RealtimeTickerOptions` gains an optional `getRateScalePermille?: () => number`, an optional
    `logger` and an optional `now` clock. `hz` stays `readonly` and stays the BASE rate — there is
    no `setHz`, no rename and no alias — and a new `effectiveHz` getter reports the product.

    With the getter absent, `start()` schedules through `setInterval` at `1000 / hz` and never calls
    `setTimeout`. With it present, a self-scheduling `setTimeout` chain runs at
    `dilatedBeatPeriodMs(1000 / hz, permille)` from
    `@chimera-engine/simulation/foundation/time-scale.js`, re-read before every re-arm so a scale
    change lands from the next beat on. The chain targets an absolute next-fire time
    (`nextAt = max(nextAt + period, now)`), so a beat's own dispatch cost is not added to the next
    delay and a long stall resynchronises instead of firing its backlog — no catch-up or missed-beat
    recovery exists. A getter that throws is caught, reported once through the injected logger, and
    treated as real time.

    The re-arm sits in a `finally`, not after the dispatch, so a beat whose `ActionPipeline`
    rejection or game-reducer throw escapes `dispatch` behaves as it does under `setInterval`: the
    next beat is still armed. A `stop()` called from inside a dispatch still wins and leaves no
    pending callback.

    The main process wires the getter unconditionally to the host snapshot's `timeScalePermille`, so
    every `realtime` game now runs the `setTimeout` chain rather than the fixed interval. At real
    time the chain's period is `dilatedBeatPeriodMs(1000 / hz, 1000)`, which is exactly the interval
    it replaces.

- bb9ebdb: A scaffolded game can validate its own asset references from day one: the blank template
  now ships an app-level `validate:assets` script running `chimera-validate-assets ../..`.
  pnpm runs package scripts with cwd = `apps/<kebab>` and the validator resolves its
  positional argument against that cwd, so `../..` lands on the project root — whose `apps/*`
  discovery then finds the game and resolves `apps/<kebab>/assets/…` exactly as it does in
  the monorepo. No new tool mode: the scaffold keeps the `apps/<kebab>` shape, so the
  existing discovery works unchanged. The script is app-level because the depth depends on
  it, and because a standalone project's root manifest carries no `@chimera-engine/electron`
  for pnpm to link a bin from. A blank game declares no assets yet, so the script reports
  `Checked 0 asset refs` until the adopter adds some — it is wired and correct, not a
  demonstration.

    `chimera-validate-assets` now REFUSES a root with no `apps/` directory instead of
    reporting success. Games are discovered at `<root>/apps/<gameId>/`, so such a root could
    report "Checked 0 asset refs; all files exist." and exit 0 — the answer "nothing is broken"
    about a tree in which no game could be found. That is reachable by hand rather than
    hypothetical: running the bin bare from a game package defaults the root to that package.
    `apps/` is the discriminator precisely because a game package never has one, while both
    supported layouts do. The refusal names the cause and the invocation that fixes it. A root
    that HAS `apps/` is scanned exactly as before, whatever it turns out to contain — including
    reporting 0 refs, which for a freshly scaffolded game is the honest answer.

- 0515bb8: Scaffolded games get the Invariant #27 packaged-bundle guard, driven from a new engine export (§4.12).

    `@chimera-engine/electron` gains a public `./packaged-bundle` subpath — the single home of the
    debug-bundle marker set and the self-validating `verifyPackagedBundle` verification. The debug
    graph the markers describe is engine code, so the strings that prove its absence are engine
    internals; consolidating them here (instead of copying them into each consumer app) removes the
    multi-copy drift where the weaker copy stops naming a module and its checks keep passing. The
    runner carries its negative controls inline: on every run, the dev rebuild that restores the
    app's `dist/` must be rejected by every predicate — per predicate — and a synthetic widened
    `files:` allowlist by every allowlist check, so a gutted or rotted check fails the gate itself
    on the same run. It also now checks the app's `electron-builder.yml` `files:` allowlist (no
    `dist/` globs, no listed debug preload, the shipped bundles named individually).

    The blank template ships a thin `verify:packaged-bundle` gate over that export. A scaffolded
    game's `build-main.ts` and `electron-builder.yml` are adopter-editable, and either edit could
    silently reship the debug layer — dropping the packaging `define` keeps every build green while
    the Inspector graph returns to the shipped bundle; widening `files:` to `dist/**` ships whatever
    an earlier dev build left behind. `pnpm verify:packaged-bundle` in the generated app now fails
    on both, reading the bytes a real packaging build emits. The engine repo's `verify:scaffold`
    runs the generated app's gate, so a broken template guard fails engine CI rather than a
    downstream adopter's packaging run.

    The monorepo's own `tools/verify-packaged-bundle.ts` becomes a thin driver over the same export;
    its behaviour is unchanged apart from the added allowlist checks.

- cc0755b: Add `standaloneLintConfig()` to `@chimera-engine/electron/eslint` — the games-facing
  half of the architecture-lint surface. The subpath already exposed the architecture-lint
  rules as a
  plugin object; a game still had to know which of them apply to game code, at what
  severity, and on which of its own directories. The factory answers that:

    ```js
    const base = [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked];

    export default [
        { ignores: ['dist/**', '.next/**'] },
        ...base,
        ...standaloneLintConfig({ css, silenceOnCss: base }),
        prettier,
    ];
    ```

    It is an **overlay, not a base**. What comes back is the curated rule blocks and nothing
    else — no recommended sets, no parser options, no global `ignores`. Five rules travel:
    `no-fromfloat-in-simulation` on `simulation/**` and `ai/**`, `no-hardcoded-design-values`
    on `screens/**` and its CSS modules, `no-unknown-token-overrides` on
    `styles/tokens-override.css`, and `no-game-renderer-internals` and `no-raw-r3f-canvas`
    across the app. The withheld rules do not, and the reasons are recorded per rule in
    `curated-rules.ts`.

    `silenceOnCss` matters, and passing the base twice is not redundancy. Two of the curated
    rules fire on CSS, which needs the `@eslint/css` language — and a flat config resolves
    rules from every matching block, so a base with no `files` restriction has its JS rules
    applied to the stylesheet too. That is not a false positive: `no-irregular-whitespace` dies
    with `sourceCode.getAllComments is not a function`, and any type-checked `typescript-eslint`
    set dies demanding type information for a `.css` file. Nor does it degrade — ESLint aborts
    the whole run, so one unhandled stylesheet means the game lints nothing at all.

    `js.configs.recommended` is silenced for free, since it is in effectively every flat
    config. Anything else unscoped — above all a type-checked `typescript-eslint` set — has to
    be named, because only the game knows what it applies and a list baked into the preset
    would cover the sets that existed when it was written and no others. Missing one is loud:
    an abort naming the rule and the `.css` file.

    Pass the whole base. A game that lints its own stylesheets keeps its `css/*` rules on the
    files this preset also governs: a rule is left alone when its namespace names a plugin
    that brings its own language, and registrations are read across every config handed in
    **and across the preset's own blocks**. That covers the `@eslint/css` README shape, a
    separate setup block, a per-directory override, a scoped or simple alias, and rules named
    against the registration this preset already supplies — each with a test. A base already
    scoped to JS/TS files needs none of this.

    Two facts worth knowing before trusting a green run. The CSS arm **widens** what
    `eslint .` covers — it pulls `.css` files into a run that previously skipped them, which is
    how the token rules reach them at all. And four of the five rules require an
    `apps/<name>/` segment in the absolute path, because their own predicates read it: a game
    at `<project>/apps/<kebab>` gets all five, and the same game at a bare project root loses
    `no-game-renderer-internals`, `no-raw-r3f-canvas`, and `no-unknown-token-overrides`
    silently.

    `@eslint/css` and `@eslint/js` are declared as **optional** peer dependencies and required
    on demand, never at module scope: a module-top import would break `chimeraPlugin` too, for every consumer
    who never asked for the preset. It can also be injected through the `css` option, which is
    the reliable route under a package manager that does not install optional peers beside
    this package. The two are not symmetric: an unresolvable `@eslint/css` throws with
    instructions, because the CSS blocks cannot be built without it, while an unresolvable
    `@eslint/js` simply contributes no baseline — leaving `silenceOnCss` to cover what it would
    have.

- 8fc84ff: Gate animation clip sheets at build time. `validate-assets` gains an `invalidAnimationSheets`
  bucket that mirrors `invalidCueSheets` at every site — the report type, the collector, the sort,
  the all-clear conjunction, the printer and the exit code — so a malformed sheet on a
  `'gltf-model'` or `'sprite-sheet'` manifest entry fails CI rather than degrading silently at
  runtime. `AssetValidationReport` gains the `invalidAnimationSheets` field and the module exports
  the `InvalidAnimationSheet` type.

    Every rule is SHEET SELF-CONSISTENCY — a property of the authored literal alone, needing no
    atlas, no glTF and no `tickRateMs` — so the gate adds no blind spot the walker did not already
    have. Its behaviour is exercised by `describe('animation clip sheet validation')` in
    `electron/dev-tools/validate-assets/index.test.ts`.

    The renderer's readers — `renderer/assets/animationSheet.ts` and
    `renderer/animation/ClipPosition.ts` — apply their own predicates to runtime VALUES and degrade
    fail-soft, dropping the unusable clip or mark; this reads SYNTAX NODES and fails the build.
    The two read different things, so there is no implementation to share and neither rule list is
    derived from the other. One consequence worth stating: a position outside `[0, 1]` is REFUSED
    here where the runtime resolver clamps it, because a clamped mark fires somewhere the author
    never wrote. A rule needing more than the sheet lives elsewhere — whether a `beatWindow` AGREES
    with the span its `from`/`to` imply stays with `compileAnimationWindows` at content load, where
    an unreadable `tickRateMs` cannot silently skip the check; whether a frame index addresses a
    cell is the atlas's question, and the sheet does not name the atlas.

    The manifest-entry walker now also peels `modelAnimationEntry({...})` and
    `spriteAnimationEntry({...})`, alongside `audioClipEntry`, which it already peeled. Both new
    builders bake their own `kind`, so before this an entry authored through EITHER of them read as
    kindless — invisible not only to the new sheet gate but to the ref-existence check (#22) and the
    declared-ref membership set (#52) as well. `manifestEntryBuilderKinds` is now the single peeled
    set; a helper absent from it is still skipped, the blind spot the walker has always had.

    An entry whose `kind` is readable and not one this gate claims is left alone, so a `'texture'`
    carrying sheet-shaped metadata is untouched. An entry that hides BOTH its `kind` and its
    `metadata` behind a spread or a computed key is unclassifiable and is reported by every gate that
    could have been carrying a sheet on it — each saying what IT could not rule out.

### Patch Changes

- f59644e: `ContentDatabase` items are now frozen **recursively**, `ContentLoader.load()` validates `DataRef`
  integrity **by default**, and item ids are constrained to a grammar that makes that validation sound
  — the two halves of Invariants #13 and #14 that the code declared but did not deliver.

    **Deep freeze (#13).** `createContentDatabase` called `Object.freeze(item)`, which is shallow: every
    nested object and array inside a loaded content item stayed mutable after `load()` returned, so
    "immutable after load" held exactly one level deep. Nothing mutated in practice only because every
    shipping content item is flat (`{ id, name, hex, order }`) — the guarantee would have lapsed
    silently on the first game to author a `stats: {...}` or `attacks: [...]` field. Items are now frozen
    through a recursive walk at the single freeze site every construction path funnels through, so
    `ContentLoader.load()` and direct `createContentDatabase()` calls are covered alike. The walk's
    visited marker is a `WeakSet`, deliberately not `Object.isFrozen`: an item the caller already
    shallow-froze must still have its nested values frozen, and a self-referential item must terminate.
    Cost is one pass per item at load time, never per access.

    Two adopter-facing consequences. Freezing is transitive, so an object a caller **shares** into an
    inline item (a module-level constant reused across items) is frozen along with it — shallow freezing
    never reached past the item itself. And because the query methods return `T` rather than a deep
    `Readonly<T>`, code that shallow-copies a nested content value and writes through the copy
    (`const s = {...item}; s.stats.hp -= 5`) still type-checks but now throws `TypeError` where it
    previously succeeded. Both were already Invariant #2/#13 violations; nothing first-party does either.
    The walk's domain is JSON (Invariant #15): a value JSON cannot produce — a `Map` or `Date` from a
    programmatic caller — is frozen but not walked, since freezing does not make those immutable anyway.
    An array-buffer view is skipped outright, neither frozen nor walked: `Object.freeze` throws on a
    non-empty typed array, and one rule for every view beats two.

    **Ref validation (#14).** `ContentLoadOptions.validateRefs` defaulted to `false` and the engine's
    only production call site (`loadAllGameContent`) passed just `{ schemas }`, so the ref half of
    Invariant #14 never ran outside tests: a game shipping a dangling `DataRef` booted fine and failed
    later as an `UnknownDataRefError` thrown from inside a reducer, mid-match, instead of fatally at
    startup. The default is now `true`. This is a **behavioural change to a published default**: a
    `load()` that previously tolerated a dangling ref now rejects. `validateRefs: false` remains as a
    narrow opt-out for a deliberately partial load whose refs resolve against a database that call does
    not build (staged base/expansion loads); no production startup path may use it.

    Refs are now recognised in object **keys** as well as values, at any depth. A map keyed by ref
    (`resistances: { 'damage-types:fire': 50 }`) is a first-class way to author per-ref data, and
    walking values alone exempted every ref written that way — a dangling one loaded clean and surfaced
    from `resolveRef()` mid-match instead. Ordinary field names contain no colon and exit the check
    immediately; the cost is that the false-positive class above now applies to keys too.

    The default was flipped rather than opted into at the electron call site so the guarantee has a
    single home — every current and future loader call site (scaffolded games, expansions, a second host
    path) is covered without remembering to ask. The startup path is pinned by its own test against a
    temp assets root, so the guard survives both a default flip-back and a call-site opt-out.

    **Item ids now have an enforced grammar** (`ITEM_ID_SHAPE`, `/^\S+$/` — non-empty, no whitespace).
    Non-ASCII, dotted, slashed and colon-bearing ids stay legal; `parseRef` splits a ref on its first
    colon, so `units:tier:elite` resolves id `tier:elite`. `ContentLoader` rejects a violating id as a
    `ContentSchemaError`, enforced at `createContentDatabase` — the single factory every construction
    path funnels through, the same siting as the deep freeze. `ContentLoader` repeats the check at merge
    time for one narrow reason: it runs before the duplicate check, so two id-less items are reported as
    malformed rather than as a `ContentConflictError` over a `Map` keyed on `undefined`. This is what
    makes ref detection sound
    rather than a guess. Detection needs to tell `"units:warrior"` from prose like `"units: 3 required"`,
    and can only do that by testing the id half — but that test is safe only if no _legal_ id can look
    like prose. Without the grammar an item ided `"Fire Mage"` would be legal and unreferenceable: both a
    correct and a dangling `"units:Fire Mage"` would be skipped, silently exempting that item from the
    integrity check. With it, a string the rule rejects cannot name any item, so skipping one can never
    skip a resolvable ref.

    **Two upgrade breaks follow from that, both intended.** First, the grammar is a new rejection: an
    item ided `"Fire Mage"` loaded before and now fails with a `ContentSchemaError`. It was legal but
    unreferenceable, which is precisely the state the grammar exists to make impossible — rename the id
    (and any ref to it). Second, with refs checked by default, any **non-ref** string of the form
    `<knownCollection>:<no-whitespace>` is now a fatal load error: an i18next-style `"units:warrior_name"`
    in a game that also has a `units` collection will stop the load. Nothing in untyped JSON distinguishes
    that from a real ref. A game hits it only by naming a collection after another of its namespaces;
    rename the collection, or pass `validateRefs: false`.

    The limits of the guarantee, stated on Invariant #14 rather than left implied. Not diagnosed at load,
    each reaching `resolveRef()` at call time instead: an id half that is empty or contains whitespace
    (`units:`, `units:Fire Mage`), which cannot name a legal item; a mistyped collection prefix
    (`unit:warrior`), which is not recognised as a ref at all; and a ref into a collection the loader
    never saw. The falsifiable form of what _is_ guaranteed: every string reachable from a loaded item
    through object entries and array elements — keys as well as values, at any depth — whose prefix names
    a known collection and whose id half matches `ITEM_ID_SHAPE` must resolve, or the load fails. Those
    two traversals are exactly what JSON can express; strings outside them (a symbol-keyed property, a
    non-index property on an array, a `Map`/`Set`'s contents) live in shapes only a programmatic `inline`
    source can build, and are not examined.

    `ContentSchemaError`'s message now reads `Content validation failed for '<collection>:<id>'` rather
    than `Schema validation failed…`: it also covers the id-grammar rejection, which fires for
    collections that have no registered schema at all. The specific reason stays in `cause`.

    `ITEM_ID_SHAPE` is exported from `@chimera-engine/simulation/content` so a game can reuse it in its
    own Zod id schema.

    **A failed content load now terminates the app.** `main()` logged the failure and rethrew, but the
    composition root launches it as `void main(...)`, so the throw was only an unhandled rejection —
    Electron printed a warning and kept the process alive with no window. Invariant #14 says the game
    does not start; it now calls `app.exit(1)`, matching the Invariant #27 startup guard (and, for the
    same reason, deliberately no modal `showErrorBox`, which would hang a non-interactive launch). The
    reason is reported through the injected `logger` and the pino sink is drained with a guarded
    `flushSync()` first — the sink buffers (`minLength: 4096`) and `app.exit()` emits no `before-quit`,
    so without that flush the refusal would leave no record at all. The
    per-game load is also wrapped so a failure names the game and its data directory, keeping the loader
    error as `cause` — the loader is game-agnostic and its errors carry only a ref string.

    No shipping content changes behaviour: the reference game's content is flat, its ids are slugs, and
    it carries no colon-bearing values.

- 0b6d3af: Packaged builds no longer bundle the Runtime Debug Layer (§4.12, Invariant #27).

    #885 made the debug gate permanently false in a distributable, but the code behind it still
    shipped: the packaged main bundle was only 69 bytes smaller than the dev one. Three exclusions
    now keep the layer out of the artifact entirely.

    The main-process graph leaves the bundle. `electron/main/index.ts` gated the debug bridge on the
    imported `IS_DEBUG_MODE`, and esbuild does not propagate a cross-module constant into a consuming
    module — so the branch stayed live and `debug-bridge`, `SnapshotInspector`, `SnapshotRingBuffer`,
    `SnapshotDiff` and the `chimera:debug*` handlers were all bundled. The gate now inlines the same
    expression, which the existing packaged `define` folds to `if (false)`, and esbuild prunes the two
    dynamic imports with it: `dist/electron/main.js` loses roughly 30 KB, with none of the graph's marker
    strings left. The duplication of the expression is pinned by a drift test, because divergence would
    silently restore the shipped graph.

    The Inspector preload is no longer emitted. `buildAppBundles` plans no `debug-preload` spec when
    `CHIMERA_PACKAGED_BUILD=1`, so `dist/preload/debug-api.js` (532 KB) and its 1.06 MB sourcemap are
    no longer produced. This does not change the size of a distributable — electron-builder's `files`
    allowlist already named `dist/preload/api.js` only — but it keeps the largest debug artifact out
    of the packaging build's output tree, and out of any distributable whose `files` list an adopter
    later widens. The check applies to the resolved entry, so it covers the packed-sibling fallback a
    scaffolded game's packaging run takes, not just the monorepo source path.

    The Inspector UI route is gated. `renderer/app/debug` gained a `debugRouteGate` and a server
    wrapper that calls `notFound()` in packaged builds, matching the existing component-gallery and
    replays gates — the route previously shipped ungated in the static export, and now prerenders to
    the 404 page with no Inspector markup. As with the gallery gate, Next still emits the route's
    JS chunk; nothing loads it, but this closes a reachable route rather than removing bytes.

    Dev and e2e builds set none of these flags and are unchanged; F9 still opens the Inspector. The
    #885 startup guard and `define` are untouched — this is subtraction of unreachable code, not a
    replacement for either control.

- 7cd9054: Relocate the dev multiplayer harness into a new `electron/dev-tools/` parent directory, the
  shared home for development-time CLIs that a standalone scaffolded game must be able to run
  — which is why they live inside this published package rather than the never-published repo
  root `tools/`.

    No public surface changes: the bin is still `chimera-dev-mp` and the library subpath is still
    `@chimera-engine/electron/dev-harness`, both of which a scaffolded app's `dev:mp` script
    depends on. Only the `dist/` targets moved (`dist/dev-tools/dev-harness/…`), so consumers
    need nothing beyond the install that re-links the bin. The package's exports-contract test
    now resolves every declared bin/export target against the built `dist/`, so a target left
    pointing at a moved file fails the fast gate rather than surviving to `verify:pack`.

- ee699ae: `chimera/no-shell-games-import` and `chimera/no-main-games-import` now recognise a
  game reached by its on-disk `apps/<name>/` path, not just a legacy `games/` path or
  a non-engine `@chimera-engine/<game>` specifier. Games moved to `apps/` in F63, so
  until now a shell page or an `electron/main` module could import one by relative
  path and neither rule fired.

    On a shell page the static form of that import was still blocked by the monorepo's
    own `no-restricted-imports` zone; for an `electron/main` module reaching
    `../../apps/<game>/…` nothing blocked it at all. A **dynamic**
    `import('../../apps/<game>/…')` was blocked nowhere on either surface, because stock
    `no-restricted-imports` does not inspect `import()` expressions. Both rules already
    visited `ImportExpression`, so widening the specifier classifier they read closes the
    static and dynamic forms together, alongside a side-effect `import '…'`,
    `export … from` and `export * from`.

    A dynamic `import()` whose specifier is a no-substitution template literal is now
    classified too — it names exactly one module, so treating it as unresolvable let one
    swapped quote character walk a game past both rules.

    Matching is path-SEGMENT-anchored at both ends (`(^|/)(apps|games)/`), so neither a
    specifier that contains those letters mid-segment (`…/webapps/Panel.js`) nor one that
    merely starts a longer segment (`…/gamestate.js`) is mistaken for a game. Rule tests
    pin each classified form, accepted and rejected.

    No engine or game source changed: the widened classifier matches nothing in the
    current tree, and both rules stay withheld from the games-facing
    `standaloneLintConfig` preset for the reasons recorded in `curated-rules.ts`.

- 556f469: Relocate the deterministic platform icon-set generator — the tool that derives the whole
  `.icns`/`.ico`/loose-PNG set, and the `chimera.png` runtime window-icon default, from a
  single square master logo — out of the never-published repo-root `tools/` and into
  `electron/dev-tools/generate-icons/`, joining the dev multiplayer harness, the
  Google-Fonts downloader and the asset-reference validator in the shared home for
  development-time CLIs a standalone scaffolded game must be able to run.

    No public surface changes yet: there is no bin, and the monorepo entry point is still
    `pnpm icons:generate` under its unchanged script name — only the path it runs moved. The
    tool's logic is untouched apart from re-deriving its repo root for the deeper directory,
    so a default run writes a byte-identical set into `electron/assets/icons`.

    The move does change what the package declares. `sharp` (a multi-megabyte
    platform-specific native binary) is the generator's codec; inside repo-root `tools/` that
    import was never published and resolved through root-devDep hoisting, while inside this
    package the module is emitted to `dist/` and shipped by `files: ["dist"]`, so
    `verify:publish`'s depcheck reads it as an undeclared runtime dep. It is now declared as
    an **optional peer dependency** rather than a `dependencies` entry: pnpm
    and npm do not install a missing optional peer, so a game install declares no codec and
    carries no native binary it never runs. Nothing consumes it yet — the generator is not
    exposed as a bin in this release, and the monorepo's own `pnpm icons:generate` resolves
    it from root devDependencies exactly as before.

- 3f6a0ab: The icon generator now loads its codec on demand instead of importing it at module
  top, so a run without it reports what to do instead of failing at module load.

    `sharp` is an optional peer, which only means anything if nothing touches it until a
    caller actually asks for icons: a static import throws while the module is being loaded,
    before any message can be printed. The load moved inside the one function that needs it,
    and the failures it can hit are now told apart:
    - **Not resolvable** — recognised by the resolver's own code, in either its ESM or CJS
      spelling, and answered with one line naming the package and `pnpm add -D sharp`.
    - **The import failed for some other reason** — `sharp` ships prebuilt native bindings,
      and a platform or Node-ABI mismatch fails the import of a package that is present.
      That case reports the failure instead of advising an install that would change
      nothing, and deliberately claims nothing about whether the package is on disk: a
      rejection carrying no code could be either, and a guess printed as a fact is what the
      install advice was doing wrong in the first place.
    - **Imported but unusable** — a codec that loads without the API this tool drives names
      itself and what it lacked.

    Both import failures keep the original error as the thrown error's `cause`, so a failure
    that is not a missing install stays diagnosable.

    Both interop shapes `sharp` can arrive in are accepted, because one of them yields
    `undefined` rather than failing: it is CJS `module.exports = fn`, so ESM presents the
    function under `default` while a CJS transform hands back the function itself.

    The codec load and the master read both happen before the output directory is created,
    so neither an absent codec nor an unreadable `--source` leaves an empty directory behind.
    A master that reads but does not decode still does — that failure lives inside the write
    loop.

- e485605: Fix the generated `.icns` and `.ico`, whose power-of-two entries were each one pixel short
  in height — which broke the Windows build outright and left the macOS icon stretched and
  speckled.

    The generator handed the whole master to `png2icons` and let it resize internally. That
    resize derives each output height as `floor(srcHeight * (target / srcWidth))`, and for some
    master widths the double round-trip through that ratio lands a hair below the integer, so
    the floor drops a pixel. Which widths, and which target sizes within them, is not a tidy
    rule — over the widths 256–2048 and this tool's ten target sizes, 292 of 1793 widths lose
    at least one. The engine's master, at 1825, is one of them: `32 / 1825 * 1825` is
    `31.999999999999996`, and every power-of-two target came out short — `.icns` at 32×31,
    64×63, 128×127, 256×255, 512×511, 1024×1023, and `.ico` the same at its power-of-two sizes
    while 24, 48, 72 and 96 stayed square. A 1024px test fixture divides evenly at every size,
    which is why the suite never saw it.

    Two consequences, the first of which was not cosmetic:
    - **The Windows build failed.** electron-builder validates `win.icon` through its
      `app-builder` binary, which rejects an icon whose largest entry is under 256×256. At
      256×255 that is `ERR_ICON_TOO_SMALL` — a hard build failure, not a warning.
    - **macOS rendered a stretched, aliased icon.** The shell scales a non-square entry back to
      square at display time. On top of that, `png2icons` decimated the 1825px master to 16–64px
      in a single bicubic step with no low-pass prefilter, which aliases hard and blows isolated
      pixels out at high-contrast edges.

    Both containers are now assembled by the tool itself, byte by byte, around exact-size square
    renders produced by `sharp` — the same renders the loose PNGs are written from, so a size
    that appears in more than one output cannot be right in one and wrong in another. libvips
    shrinks before it resamples, so the small entries are clean. Each render is verified against
    its own PNG header before it is used: an off-by-one in a resize is invisible in every
    downstream byte, since the container assembles perfectly well around a wrong-sized payload.

    `png2icons` is gone — from the dependency tree, from `@chimera-engine/electron`'s optional
    peers, and from the scaffold's opt-in instructions, which are now just `pnpm add -D sharp`.

    The `.icns` carries `ic07`–`ic14`, all PNG, which is exactly the set electron-builder's own
    generator emits. `ic04`/`ic05` are deliberately absent rather than overlooked: those slots
    are raw `ARGB`, and macOS' IconServices — the path Finder and the Dock use, unlike `NSImage`
    — rejects a PNG there and falls back to the generic application icon. Omitting them costs
    nothing on a Retina display, where 16pt and 32pt render from `ic11`/`ic12`. The `.ico` ladder
    is 16, 24, 32, 48, 64, 96, 128 and 256.

    Also fixed in the same path: the resize padded with sharp's default background, which is
    **opaque black**, so any game whose master is not square got black letterbox bars down two
    edges of every loose PNG. (The containers escaped it only because they were built from the
    raw master by a different code path — the one this change removes, which would have carried
    the bars into every entry.) The pad is now explicitly transparent.

    The `verify:scaffold` generate-icons arm no longer requires the run to fail. With `png2icons`
    gone the only codec is `sharp`, which a Next-based scaffold already installs as a transitive
    optional dependency — so the run there generates the set for real. Both outcomes are now
    graded, and the arm asserts on work done rather than exit status: an exit 0 is a failure
    unless the set is actually on disk, which is precisely the no-op-entry-guard defect the arm
    was built to catch.

- f118f22: `buildDefaultAIPlayerAgent()` now projects an honest AI's **initial** snapshot through
  `StateProjector.project()` (§4.6/§4.9, Invariant #17), and the engine's default AI policy reads the
  projected turn gate.

    The seed handed to `AIStateMachine.setInitialState()` was a raw `GameSnapshot` spread into
    `PlayerSnapshot` shape — unconditionally, regardless of `omniscient`. That object reaches game code
    verbatim as `AIState.onEnter()`'s argument, so an _honest_ agent's very first decision context was
    host truth: unfiltered `entities` (no fog), unmasked `players`, unfiltered `events`, plus `seed`,
    `turnClock`, `turnNumber`, `hostPlayerId`, `timers`, `committedTurns` and any game-local root field
    (for tactics, the every-seat `playerStamina` ledger).

    It type-checked because TypeScript does not apply excess-property checking to spread-in members: a
    `{...gameSnapshot, viewerId, commitments, undoMeta, isMyTurn}` literal satisfies `PlayerSnapshot`
    structurally, so `tsc`, ESLint and the mechanical invariant checks all passed it. That is why
    Invariant #17 now states a _provenance_ requirement (a `PlayerSnapshot` **produced by**
    `project()`) rather than only a type requirement, and names spread-widening as not-a-projection.

    The steady-state path was never affected — `AgentManager.tickAll`/`onGameStart`/`onGameEnd` have
    always branched correctly. The gap bites hardest on **restore**: `seatRestoredRoster` registers
    agents _after_ `applyRestoredFile`, so a restored seat's seed came off a mid-game checkpoint
    carrying every other seat's hidden state. `BuildDefaultAIPlayerAgentOptions` gains a **required**
    `projector`; optional-with-a-default would have compiled everywhere while silently preserving the
    hole. Omniscient agents are unchanged: they keep their declared full-state access, the same carve-out
    Invariant #17 grants them in the per-tick fan-out.

    Nothing shipping observed the leak — both in-repo `onEnter` implementations are no-ops — so this is
    a latent contract breach closed, not a live fog-of-war regression. It becomes load-bearing for any
    game whose AI reads state in `onEnter`.

    Separately, the built-in `engine:auto-end-turn` policy is repaired. It gated on
    `snapshot.turnClock`, a host-local field `project()` never emits, so for an honest agent the
    comparison was always `undefined !== playerId` and the policy could never fire — an AI seat in a
    game that supplies no `createAIState` (including the `create-chimera-game` blank template) would
    never end its turn. It now gates on `snapshot.isMyTurn`, the projected turn signal the shipping
    tactics policy already used, which also carries a game's `resolveIsMyTurn` override for
    simultaneous-turn modes.

    Making a dead policy live required bounding it, because the host re-ticks every agent from inside
    its own dispatch — the mechanism that lets a policy spend a whole turn in one go is also the one
    that lets an unconditional policy recurse to the drive-depth cap. The policy now:
    - **suppresses its own re-entrant asks**, so at most one request leaves it per pump. This is what
      bounds the cases where the tick _does_ advance while the seat stays active — a game contributing
      `mayEndTurn` for simultaneous turns, or a round-robin over a one-seat roster that hands the turn
      straight back. A latch keyed on the tick cannot bound either of those, because the tick is fresh
      on every iteration.
    - **does not re-ask at a tick it already acted on**, which covers repeat delivery at an unchanged
      tick: a game with no `turnClock` projects `isMyTurn: true` for every viewer while
      `engine:end_turn` reduces to the identity, so each repeat would cost a replay record, a broadcast
      and an autosave write for no progress.
    - **acts only on a live match.** `engine:return_to_lobby` drops the turn clock, so a
      returned-to-lobby session projects `isMyTurn: true` for everyone; ending a turn there rewrote the
      autosave slot with a lobby-phase file over the abandoned match's. A resolved match rejects
      `engine:end_turn` outright. Both signals are engine-owned — the gate is deliberately not an
      allow-list of `'playing'`, since a game's phase vocabulary is its own.
    - **contains a rejected end-turn.** `ActionPipeline` signals rejection by throwing, and nothing
      between the agent's `dispatch` and the host action that drove the fan-out catches it, so the
      error would otherwise fail a human's action or the realtime ticker's callback on account of the
      AI. A game may supply `resolveIsMyTurn` (projection) without `mayEndTurn` (authorisation) — they
      are separate seams — so a seat the policy believes is active can still be refused. The rejection
      is logged, and the next tick retries, so a temporarily-rejecting guard still resolves.

    The unit tests that appeared to cover this policy were feeding it raw snapshots through
    `as unknown as PlayerSnapshot` casts; they now drive projected snapshots through the real host
    re-tick pump, which is the only setup under which any of these termination claims is testable — a
    stubbed `dispatch` cannot re-enter, so it reports one dispatch however the policy behaves.

- 88680bb: Restored the mandated structured-logger wiring across the main-process composition root
  and removed a dead `UndoPolicy` field.
    - `buildHostSessionPipeline` now forwards its injected `Logger` into both
      `InMemoryActionHistory` and `ActionPipeline`, so the `action-history:overflow` warn
      (Invariant #45) and the `engine:tick` timer-rejection warn (Invariant #90, §4.20) are
      reachable in production instead of being swallowed by a noop logger.
    - `SettingsManager.getSettings()` now emits the mandated warn when called for an
      unregistered `gameId` before degrading to engine defaults (Invariant #34).
    - `ProfileManager` is now constructed with an injected `Logger` child — the last
      main-process manager that was missing one (Invariant #67).
    - Removed `UndoPolicy.requireConsentFrom`, a field with no enforcement anywhere in the
      engine. Multi-player undo consent is not a supported policy dimension (§4.5, §7).

- 1655193: Hardened the production debug-mode startup guard for packaged builds (Invariant #27/#77).

    `assertProductionDebugGuard` early-returned unless `NODE_ENV === 'production'`, but an
    electron-builder-packaged launch never sets `NODE_ENV` — so a shipped binary started with
    `CHIMERA_DEBUG=1` booted the full debug bridge with `GameSnapshot`-level Inspector access.
    Both startup guards now take `app.isPackaged` and share one `isProductionRuntime` predicate
    (`isPackaged || NODE_ENV === 'production'`), adopting the same trusted build signal the replay
    privacy gate already used. The existing `NODE_ENV` trigger is unchanged.

    As defence in depth, the app bundler gained an opt-in production `define`: packaging scripts
    declare `CHIMERA_PACKAGED_BUILD=1`, which bakes both `IS_DEBUG_MODE` reads so the emitted bundle
    contains the literal `IS_DEBUG_MODE = false` — the debug bridge sits behind a permanently-false
    gate even if the startup guard were bypassed. (This step made the gate dead but left the debug
    module graph in the bundle; a separate change in this same release removes it — see "Packaged
    builds no longer bundle the Runtime Debug Layer".) Dev and e2e builds share that bundler and
    deliberately get no define, so the F9
    Inspector stays reachable; a drift test fails loudly if a packaging script ever loses the flag.

    Also fixes a scaffolding bug this exposed: the packaging scripts emitted by `create-chimera-game`
    (both workspace and standalone) never set `NEXT_PUBLIC_CHIMERA_PACKAGED=1` on their `next build`
    step, so every scaffolded game's distributable shipped the dev-only component gallery and replay
    routes. Both emitters now declare it, and `start:debug` rebuilds the renderer as well as the app
    bundle so a preceding `pnpm package` cannot leave a debug launch half-gated.

- 23c6cbd: The renderer logging bridge is now installed before the **first** renderer log, and an `Error` handed
  to it keeps its stack. Both defects made diagnostics the renderer already emits either vanish or
  arrive unusable in the log file a packaged binary leaves behind (§4.27, Invariant #67).

    The renderer has no injected `Logger`. Unlike `electron/main` — where the invariant is backed by a
    `no-console` ESLint zone — `installRendererLogger` _patches_ `console.warn` and `console.error` and
    forwards over `window.__chimera.logs`. In `renderer/**` those two methods therefore **are** the
    sanctioned channel, and the interception model has failure modes the main-process rule has no
    equivalent for: a call the bridge never saw, and a call it saw but could not carry.

    **Installed before the first render-phase log.** The install ran in a `useEffect` in `LoggingBootstrap`,
    which `AppShell` mounted _inside_ `<Providers>`. React runs a parent's render strictly before any
    child's effect, so everything `Providers` logged while rendering escaped the patch entirely. That
    was not hypothetical: `createAudioManagerForEnvironment` warns from a `useMemo` initializer when Web
    Audio init fails, then falls back to a noop audio manager. The fallback protects the app, so a player
    whose audio failed ran a silent game — and the one line saying why reached devtools and never the log
    file. Nothing in the record said the app had gone quiet.

    Hoisting alone would not have fixed it: React commits _all_ effects after the whole tree has
    rendered, so an effect-scoped install is late wherever it is mounted. `<LoggingBootstrap />` is now
    `AppShell`'s **first child**, outside `<Providers>`, and installs **during its render**. Because the
    install left effect scope it also has to survive React's StrictMode remount — every Next host in the
    tree sets `reactStrictMode: true` (`apps/<game>/renderer/next.config.ts` and the scaffold template),
    which runs mount → cleanup → mount, and the render-phase call does not run a second time — so the
    effect re-arms the bridge as well as owning its teardown. The install stays idempotent, is
    refcounted across multiple mounts, and its teardown stays exact (console methods restored, window
    listeners removed).

    The guarantee is bounded at React: client-bundle **module evaluation** — including the
    `chimera-game-registration` side-effect import that runs an adopter's `register.ts` as the bundle
    loads — precedes every render and sits outside the bridge. Module-scope code must not log expecting
    forwarding; anything it emits reaches devtools only.

    Ownership is single-sourced. `installRendererLogger` returns `null` — not a no-op teardown — when
    the bridge is already installed, so a caller can never claim (and later run) a teardown it did not
    create. A no-op return would read as ownership, and a stale claim to it survives Fast Refresh
    (`LoggingBootstrap.tsx` re-evaluates, resetting its module-scope claim, while `rendererLogger.ts`
    keeps its `installed` latch) and would block every future re-install while reporting success. The
    bootstrap also clears its claim before invoking the teardown, so a throwing teardown cannot leave a
    stale claim behind — pinned by `LoggingBootstrap.guard.test.tsx`.

    **An `Error` argument keeps its stack.** `argsToMessage` mapped every non-string argument through
    `String()`, and `makeEntry` was called with no `error`, so `console.error('…', err)` produced a
    `LogEntry` with `error: undefined` and a message ending in a bare `Error: <message>`. The stack — the
    one thing that makes a renderer error actionable — was gone before the entry left the renderer. The
    first `Error` among the arguments is now threaded into `LogEntry.error` as `{ name, message, stack }`
    and **removed from the composed `message`** — its detail travels once, in the `error` field, so the
    main-process logger does not print the same text twice. The remaining arguments compose `message`
    unchanged (string-only call sites read exactly as before), and an `Error` that is the only argument
    becomes the message (`name: message`). This also brings a path that was already built for it to
    life: the main-process `chimera:logs:emit` handler reconstructs an `Error` from `entry.error` for
    `error`/`fatal` levels, which until now only `RootErrorBoundary`'s direct `emitRendererError` call
    ever populated.

    **Oversized fields cost characters, never the entry.** The `chimera:logs:emit` handler drops an
    entry that fails schema validation rather than truncating it, so the renderer truncates first:
    `serialiseError` caps `error.name`/`error.message`/`error.stack` at 256/4096/8192 characters, the
    composed `message` at the schema's existing 4096, and `source.module` at 256. On the electron side
    `LogErrorInfoSchema` and `RendererLogSourceSchema` now enforce the same caps, so every string field
    the schema **names** is bounded at the boundary (§9.1) — `error` previously arrived only from
    `RootErrorBoundary`, once per crash; now every patched console call carrying an `Error` sends one,
    so the unbounded fields became reachable at volume. On the renderer channel an oversized field at
    the boundary means a producer that bypassed the bridge, and the entry is dropped like any other
    malformed payload. The two cap sets cannot share a constant across the electron/renderer boundary,
    so an e2e spec (`renderer-logging.spec.ts`) drives an entry with every page-drivable capped field
    oversized — composed message, `error.name`, `error.message`, `error.stack` — through the real chain
    and asserts it arrives truncated, never dropped. Each side's unit tests pin its own literals, so a
    unilateral cap edit fails that side's suite; the e2e is what catches a **coordinated** edit — a cap
    moved together with the literals in its own test — which otherwise leaves the two sides disagreeing
    with everything green. `source.module` is the exception: no page-reachable route produces a
    caller-supplied module (the console routes pass the `'global'` literal, and `emitRendererError` is
    not on `window`), so its agreement rests on the two unit suites and the coordinated-edit gap stays
    open for that field alone. `context` is the one field left unbounded, and stays so deliberately: it carries arbitrary
    structured diagnostics, and a size budget would mean serialising every entry to measure it. The
    schema bounds its shape and not its extent, so an oversized `context` cannot cost an entry — but the
    window handlers' `context.stack` is truncated to the same 8192 regardless, so every string the
    bridge itself composes is bounded, not only the ones a validator would reject. The shape half has a
    consequence worth stating, since it is the drop rule read backwards: a `context` that is not a
    record costs the **whole entry**, silently. §9.1's `logs` row now records all of this, caps and
    exception both.

    `console.log` remains deliberately **unforwarded** (PII/volume hygiene). A call site that needs a
    durable record moves up to `warn`/`error`; it does not get `console.log` hooked. The regression test
    pinning that policy predates this change and stays in place; §4.27 now cites it explicitly so a
    later "the bridge should catch everything" change has to fail a test rather than quietly reverse it.

    Ordering is pinned by test rather than by comment, since the defect _was_ an unpinned parent/child
    ordering assumption: `renderer/app/AppShell.test.tsx` runs the real patch and asserts that
    `Providers`' render-phase AudioManager warn reaches a `logsApi` stub, and separately that a log
    emitted _after_ StrictMode's remount still forwards — the render-phase warn fires before any
    StrictMode cleanup, so only a post-render log can prove the re-arm. Moving `<LoggingBootstrap />`
    back inside a provider, or back into an effect, fails a test instead of silently dropping logs
    again. `renderer/app/LoggingBootstrap.ssr.test.tsx` additionally pins that the render-phase install
    stays inert during the static-export prerender, where `window` does not exist — a regression there
    would fail `next build`, which no jsdom test observes.

    Adopter-visible in what the log file contains. A game whose renderer never warns before its
    providers settle sees no change in coverage; one that does now has the entry, with its stack. Log
    _format_ changes in one respect: an `Error` passed to `console.warn`/`console.error` no longer
    appears stringified inside `message` — its text lives in the entry's `error` field (and, for
    `error`/`fatal` levels, in the reconstructed `Error` the main logger receives), so lines that
    previously ended in `… Error: <message>` now carry that detail structurally.

- c5b80ca: Make all four `@chimera-engine/electron` dev tools reachable from a scaffolded project's root, and fix `fetch:fonts` dying before it ran.

    The scaffolded `fetch:fonts` script documented its argument inline as `--url <google-css-url>`. A package script is handed to `sh`, which reads the angle brackets as a **redirection** — so `pnpm fetch:fonts` opened a file named `google-css-url`, failed, and reported `sh: google-css-url: No such file or directory`. The message names neither the script nor the bin, so it reads as `chimera-fetch-fonts` being missing from the scaffold. The script now carries no `--url` placeholder; the CSS URL is passed as a trailing argument (`pnpm fetch:fonts --url "<css url>"`), which pnpm appends to the delegated script, so nothing has to be hand-edited before the first run.

    The standalone project root forwarded only `dev:mp`, leaving `fetch:fonts`, `icons:generate`, and `validate:assets` reachable solely as `pnpm --filter @chimera-engine/<game> <script>` — a form nothing in the scaffold's own output taught. The emitted root now forwards all four, matching the monorepo, where each is a plain root script. The forwards are bare delegations (no build chain: these tools read source and assets, never build output) and end on the delegated script so trailing arguments reach the bin.

    `verify:scaffold`'s fonts arm now drives `pnpm fetch:fonts --url …` from the project root instead of invoking the bin with a hand-built argv, so it covers the root forward, the shipped script, and pnpm's argument forwarding — the chain that was broken while the arm stayed green. It additionally refuses any `fetch:fonts` script containing a shell redirection character, and the blank-template suite refuses one in **any** template script and cross-checks every `chimera-*` command the template invokes against the bins `@chimera-engine/electron` declares.

- 676a086: `SettingsManager.registerSchema()` now enforces the engine settings namespace guard (§4.13, Invariant #35).

    The collision check was structurally dead: it derived `gameSpecificKeys` by removing the reserved
    engine namespace keys, then filtered that already-cleaned list _for_ those same keys, so the result
    was always empty and `SettingsNamespaceCollisionError` could only ever fire for a duplicate `gameId`.
    A game whose defaults shadowed `audio`, `display`, `gameplay` or `controls` registered silently.

    Matching on the key name alone cannot express the invariant.
    `GameSettingsSchema<T extends EngineSettings>` means every game's `defaults` legitimately
    _contains_ all four reserved keys — games spread `...ENGINE_DEFAULTS` — so a name match would
    reject every real game, including the
    shipped tactics schema. The guard instead requires each reserved namespace to arrive **intact**:
    present, a plain object, owning every engine sub-key for that namespace. Hijacking the name for a
    game-specific value, supplying a partial namespace, and omitting one are all rejected by the same
    rule, at registration, instead of degrading silently at merge time. Omission previously left a
    registered game strictly worse off than an unregistered one: `deepMergeStripped` seeds from
    `{...base}` and walks `Object.keys(base)`, so a missing namespace both vanished from the resolved
    settings and silently discarded the user's stored overrides for it, whereas an unregistered game
    still falls back to `ENGINE_DEFAULTS`. Sub-key **ownership** is what is checked (`Object.hasOwn`),
    matching the merge's own-key semantics — a sub-key inherited through the prototype chain satisfies
    `in` but still merges to `{}`.

    The check is structural — sub-key ownership only, never sub-value types or ranges. Validating
    `defaults` against `engineSettingsZodShape` would have been wrong here: its refinements
    (`.min(0).max(1)`, `.int()`) are stricter than the plain `number` the `EngineSettings` type promises,
    so a type-legal default such as `audio.masterVolume = 1.5` would be rejected as a namespace
    collision. Game `defaults` are trusted first-party input and are range-validated on no runtime path;
    `getSettings()`/`updateSettings()` validate stored user overrides and incoming patches, never
    `schema.defaults`. Graceful degradation for an unregistered `gameId` (Invariant #34) is unchanged.

    The engine composition root now wraps the registration loop, logs the reason, and calls
    `app.exit(1)` before rethrowing. Consumer roots launch the engine as `void main(...)` and this runs
    before `app.whenReady()`, so a bare throw would otherwise surface only as an unhandled rejection and
    leave a live, windowless process — the guard would reject the schema without refusing to start.

    Every in-repo and scaffolded schema registers unaffected: `apps/tactics` and the
    `create-chimera-game` blank template both spread `ENGINE_DEFAULTS`, and the engine's own IPC handler
    fixtures pass `ENGINE_DEFAULTS` directly. A game that had been relying on the guard's silence to
    ship a hijacked, partial, or missing reserved namespace will now fail at registration with a message
    naming the offending key(s), and the app will refuse to start.

- adfd928: The Invariant #35 settings-registration refusal now reports through the injected `Logger` instead of
  `console.error`, every refusal raised after the logger exists shares one enforced code path, and the
  `console.*` ban itself became a ratchet.

    `main()` refuses to start in four places. The Invariant #27/#77 startup guard genuinely cannot use
    the logger: it must be the first statement in `main()` so no debug surface initialises before an
    illegal production+debug combination is caught, which is before the root logger is constructed. The
    other three run after it — the Invariant #14 content load, the Invariant #35 settings registration,
    and the dev-harness bootstrap failure — and all three did something different. #35 was still on
    `console.error`, sanctioned as an explicitly not-yet-migrated site; this migrates it. #14 had the
    right shape but hand-rolled. The harness site logged and exited with no drain at all, so its reason
    died in the buffer.

    All three now call one helper, `refuseToStart(logger, sink, message, err)`: report through the
    injected logger at **`fatal`**, drain the sink, `app.exit(1)`. Callers rethrow after it returns where
    an awaiting caller needs the error. The shape is a property of the code rather than of three copies
    of a comment, which is what makes it checkable. Both steps are guarded so neither can cost the exit —
    the drain because an unflushable sink must not become a hang, the report as defence in depth, since
    the exit must not depend on every layer of the logging stack staying total. `fatal` rather than
    `error` because the level is what makes these findable in the log file a packaged binary leaves
    behind, and it is the level `handleUncaughtException` already uses for the comparable event; the
    messages lost their now-redundant `fatal:` prefix. The Invariant #35 refusal keeps its two existing
    behaviours: the `err.name` discriminator, so it is never reported under the same label as an
    unrelated bug in a game's `registerSettings` callback, and the deliberate absence of
    `dialog.showErrorBox`, which is modal and would hang a non-interactively launched binary.

    Each of the three sites is pinned by a test asserting the drain lands before the exit, the harness
    one included — it is reachable only under `CHIMERA_DEV_HARNESS` with an auto-flow flag, so nothing
    else in the suite goes near it, and its drain matters most: the periodic harness flush runs on a 1s
    interval that `app.exit(1)` beats.

    The crash path now holds the same property by the same means, without the helper.
    `handleUncaughtException` reported the fatal entry _above_ the `try` whose `finally` owns
    `proc.exit(1)`, and drained the sink inside that `finally` unguarded — so a logging stack that
    failed while handling a crash could skip the exit and leave the crashed process alive and
    windowless, the very outcome the exit exists to force. Both calls are now guarded individually,
    exactly as `refuseToStart` guards its own.

    **A dev launch keeps its terminal output.** The migration alone would have moved the reason off the
    console and into the log file only: the production Pino sink writes nowhere else, and the stdout
    sink is wired solely under `CHIMERA_DEV_HARNESS`. `pnpm start` against a bad settings schema would
    have exited 1 in apparent silence. So an unpackaged, non-harness launch now also gets a **stderr
    mirror sink** (`createStderrSink`) in the fan-out, wrapped in a new `createMinLevelSink('error', …)`
    — the root logger applies no threshold of its own, so an unfiltered mirror would put every startup
    `info` entry on the terminal. It is mutually exclusive with the harness stdout sink, whose
    orchestrator prefixes and relays that stream. A sink is transport, not a `console.*` call site, so this is not a
    new Invariant #67 exception; the refusal reason is now both durable (log file) and immediately
    visible (terminal), where before it was only ever one of the two.

    **The sink fan-out no longer lets one transport speak for the others.** `main()` composed its
    fan-out by hand, writing to the Pino sink first and unguarded — so a single `EBADF` there (a date
    rollover, a destroyed SonicBoom) took the in-memory ring buffer and whichever console mirror was wired down with
    it, and a fatal refusal exited 1 having written nothing to the log file _and_ nothing to the
    terminal. That is now `createFanOutSink`, which isolates each leg: a failing transport loses its own
    line and nothing else.

    Isolating a leg is not the same as noticing it. No sink reports its own failures — `createPinoSink`
    throws on a bad fd or an unserialisable `context` and returns nothing — and in production the
    fan-out is their only caller, so swallowing would mean the durable record could stop working with no
    signal on any channel. Each failure is therefore announced on the legs that still work, carrying the
    underlying error, after they have taken the entry that provoked it. The legs are named for this
    reason: an ordinal would mean the harness stdout sink under `dev:mp`, the stderr mirror under
    `pnpm start`, and nothing at all in a packaged build.

    Announced once per _run_ of failures — not once per entry, and not once per session. Both bounds
    matter, because the file sink fails in two unrelated ways: a dead fd recurs on every write and would
    turn the survivors into a firehose, while an entry it cannot serialise is transient and leaves the
    sink healthy. Latching for the session would let one bad `context` spend that leg's only
    announcement and then swallow the genuine `EBADF` behind it, so the latch clears as soon as the leg
    writes again.

    Both console sinks additionally swallow a failing write **and** an entry they cannot format (a
    circular reference in `context`), so that a `Logger` call never throws into its call site because a
    convenience mirror could not write. That is defence in depth rather than the enforcement — the
    fan-out is, and every production wiring of these sinks goes through it — and it is what keeps them
    safe when a caller hands one straight to `createLogger`, as this module's tests do. It also decides
    _where_ a line is lost: a swallowing mirror loses one echo, whereas the same failure surfacing at
    the fan-out would spend the leg's one announcement on a convenience stream.

    **Invariant #67's `console.*` ban is now machine-enforced** (the refusal shape above is not — it
    holds because there is one helper, not because a rule rejects a second implementation). A
    `no-console` ESLint zone covers `electron/main/**` and
    each consumer composition root (`apps/*/electron/main.ts`) — with no `ignores`, test files included,
    since none of them call `console.*` — and the #27/#77 guard is the single `eslint-disable-next-line`
    in that tree. A `--workspace` scaffold is covered, because it lands in `apps/`; a **standalone**
    scaffold is not covered from here — its own `eslint.config.mjs` composes the engine's
    curated preset, which does not carry the engine-internal `no-console` zone.

    The zone is pinned by `electron/main/__tests__/eslint-no-console.test.ts`, which checks three
    independent things, because each is defeatable alone. Fixtures prove the rule _discriminates_. The
    zone object itself is asserted to configure `no-console` exactly once, at `error`, with no
    `ignores` — behaviour alone was not enough, since narrowing the zone that way disables the rule
    where it matters while every fixture assertion still passes, and `pnpm lint` stays green either way
    because the orphaned `eslint-disable` is only a _warning_ and no package sets `--max-warnings`.
    Finally `eslint --print-config` proves ESLint _resolves_ the rule at error severity for a file from
    every subtree the zone claims — shape is not enough either, because the config's **global**
    `ignores` sit outside the zone object, so exempting a whole subtree there leaves the zone reading
    exactly as documented. That probe list is walked out of the filesystem recursively, so a subtree
    added later is covered the day it appears, and nesting one inside another does not hide it. Every
    evasion above was measured, not hypothesised.

    The zone stops short of two neighbours. `apps/*/electron/build-main.ts` and the app-level verify
    scripts are the principled exclusion: Node build tooling that never runs in the app, whose console
    output _is_ its interface. Preload is only a scope call — it would ratchet identically, having one
    sanctioned `console.*` call site (`electron/preload/shared/listener.ts`, exception (b)) and so
    needing one targeted disable, but it is a different layer with a different logging story and belongs
    to its own change.

    Adopter-visible only in where a refusal reason appears. A packaged binary that refuses to start over
    a settings schema now leaves its reason in `<userData>/logs/chimera-<date>.log` instead of on a
    stderr stream no user of a GUI app was reading; a dev launch shows it in the terminal as before, via
    the mirror rather than `console.error`. Nothing changes for a game whose schema registers cleanly.

- 98b35cd: Relocate the asset-reference validator — the build-time gate behind Invariants #22/#52/#97/#125 —
  out of the never-published repo-root `tools/` and into `electron/dev-tools/validate-assets/`,
  joining the dev multiplayer harness and the Google-Fonts downloader in the shared home for
  development-time CLIs a standalone scaffolded game must be able to run.

    No public surface changes yet: there is no bin, and the monorepo entry point is still
    `pnpm validate:assets` under its unchanged script name — only the path it runs moved. The
    tool's logic is untouched, so it reports byte-identical output on the same tree.

    The move does add one real dependency. The validator imports `createSourceFile`,
    `forEachChild` and `isCallExpression` from `typescript` as runtime **values** for its
    on-demand-load AST scan. Inside repo-root `tools/` that import was never published and
    resolved through root-devDep hoisting; inside this package it is emitted to `dist/` and
    shipped by `files: ["dist"]`, so `typescript` is now a declared runtime dependency rather
    than a hoisting-masked one — without it, `verify:publish`'s depcheck reads the published
    tarball as carrying an undeclared runtime dep.

- Updated dependencies [0243537]
- Updated dependencies [503dd92]
- Updated dependencies [b53c262]
- Updated dependencies [e1d1696]
- Updated dependencies [9004ccc]
- Updated dependencies [f59644e]
- Updated dependencies [3e3e571]
- Updated dependencies [4af36f7]
- Updated dependencies [068111c]
- Updated dependencies [0b6d3af]
- Updated dependencies [f9caea4]
- Updated dependencies [bb41334]
- Updated dependencies [a2f7d10]
- Updated dependencies [8f6e8fd]
- Updated dependencies [77b229d]
- Updated dependencies [3702818]
- Updated dependencies [aa910b0]
- Updated dependencies [63335a1]
- Updated dependencies [6b600c2]
- Updated dependencies [88680bb]
- Updated dependencies [c4d095d]
- Updated dependencies [1655193]
- Updated dependencies [f26c5ec]
- Updated dependencies [3fd9271]
- Updated dependencies [0f6dd1c]
- Updated dependencies [23c6cbd]
- Updated dependencies [0902c04]
- Updated dependencies [c7665c8]
- Updated dependencies [91cb179]
- Updated dependencies [091a05f]
- Updated dependencies [7fbbbef]
- Updated dependencies [9a4ba4c]
- Updated dependencies [6cd3bbd]
    - @chimera-engine/simulation@1.0.0-rc.6
    - @chimera-engine/renderer@1.0.0-rc.6
    - @chimera-engine/ai@1.0.0-rc.6
    - @chimera-engine/networking@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- @chimera-engine/simulation@1.0.0-rc.5
- @chimera-engine/ai@1.0.0-rc.5
- @chimera-engine/networking@1.0.0-rc.5
- @chimera-engine/renderer@1.0.0-rc.5

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
    - Fixed the F9 inspector in standalone builds: `build:app` now falls back to the
      `debug-api.js` sibling of the resolved api preload, so the Inspector preload comes
      from the installed `@chimera-engine/electron` layout when no engine source tree exists.

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
