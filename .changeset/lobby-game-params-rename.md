---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': minor
'@chimera-engine/renderer': minor
'@chimera-engine/networking': minor
'@chimera-engine/tactics': patch
---

Rename the host-authored lobby-configuration family from `matchSettings` to `gameParams`. This is a
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
