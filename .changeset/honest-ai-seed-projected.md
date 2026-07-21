---
'@chimera-engine/electron': patch
---

`buildDefaultAIPlayerAgent()` now projects an honest AI's **initial** snapshot through
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
