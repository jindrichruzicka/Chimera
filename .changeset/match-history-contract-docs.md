---
'@chimera-engine/simulation': patch
'create-chimera-game': patch
---

Document the declared match-history contract, and amend Invariant #45 so its two numbers read
correctly after it.

Only one of Invariant #45's two numbers moved across this arc.
`TURN_MEMENTO_RETENTION = 4` is unchanged and the row now says so: it is turn-scoped, reached only
from `ActionPipeline`'s `engine:end_turn` branch, and no manifest declaration touches it. The entry
cap is what became per-game — a hosted session's history is constructed with the game's resolved
`matchHistory.retainActions`, for which `MAX_ACTION_HISTORY_ENTRIES = 10_000` is the turn-based
default and the ceiling a declaration may not exceed, and `DEFAULT_REALTIME_RETAIN_ACTIONS` is the
real-time default.

§4.5/§7 gains the contract: the interface, the `realtime`-keyed default table, the never-throws
rule, and what the host and the renderer each read from the resolved capability. §4.28 gains the
declining path, including that the save and preview refusals are the ones a never-recorded match
already gets. The Turn Boundary Rules table gains the declared-no-undo row. §4.26 gains
`useInputAction`'s `enabled` option, and its "what stays internal" paragraph no longer enumerates
names it cannot keep complete.

The blank scaffold template documents `matchHistory` on its manifest with a commented-out example,
and its `renderer/loaders.ts` forwards the resolved capability. Without that forward a scaffolded
game that declares no undo would still bind its undo key — the renderer half of the declaration
exists only because a game forwards it.

The traceability matrix names F96 on the §4.5, §4.28 and §4.37 rows and in the feature-to-milestone
index.
