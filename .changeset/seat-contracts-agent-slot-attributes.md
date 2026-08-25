---
'@chimera-engine/simulation': minor
'@chimera-engine/networking': minor
'@chimera-engine/electron': minor
---

Widen the seat contracts so every seat kind can carry picks, and stop the preload schema from
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
human's own-seat write frame uses. There is no attribute-setter channel for an agent slot —
`chimera:lobby:host` is the sole write path for its attributes — so the caps ride the state frame as well
as the `.strict()` `HostLobbyParamsSchema`, whose transform now carries the field through.
`matchSettings` and a
player's `attributes` stay uncapped on the state frame, exactly as before: capping them at the
preload boundary would reject a state the host legitimately broadcast.

New: `simulation/foundation/quick-start-contract.ts`, a zero-import foundation leaf declaring
`QuickStartConfig` / `QuickStartSeat` / `QuickStartAiSeat`, plus the optional
`GameLobbySetup.quickStart` defaults block. Every seat kind carries its own `attributes` (an AI seat
adds `omniscient?`) — a bare seat count can say how many seats to open but not what any of them is
playing. It sits on the lobby setup rather than the manifest because a seat's attributes are drawn
from the same vocabulary as `playerAttributeOptions`, and the lobby setup is built from the game's
`GameContent`. The verb that consumes it lands separately; this is the type both ends compile
against.

Additive throughout — every new field is optional and backward-compatible.
