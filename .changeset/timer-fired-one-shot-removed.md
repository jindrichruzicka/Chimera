---
'@chimera-engine/simulation': patch
---

Remove a fired one-shot timer from `snapshot.timers` instead of rewriting it as an
`{ active: false }` tombstone.

`TimerManager.advance()` had no delete path: once a one-shot fired, its entry stayed in the registry
inactive for the rest of the session. The registry is snapshot-resident, so every tombstone sat in
every later save checkpoint the body checksum covers and under every later beat's walk of the
registry — one dead entry per fire, for a game that schedules per-entity timers. (It never crossed
to a client: `StateProjector.project()` carries no `timers` field — Invariant #8.)

The removal happens inside `advance()`'s own pure pass (Invariant #55): the fired entry is simply
not carried into the returned registry. Everything else is as it was — a repeating timer resets and
stays, a timer still counting down keeps its slot, and an entry that was ALREADY inactive (a
cancelled timer, or a tombstone written by an engine that still left them behind) is passed through
untouched, so a save carrying tombstones loads with no migration and the tombstone is skipped on
the next beat exactly as before. When nothing in the registry is active, `advance()` still returns
its input reference, so `engine:tick` keeps `snapshot.timers` by reference and the pipeline's
clock-only broadcast stays reachable; with the fired entry gone, the beat after a one-shot fires is
that fast path rather than a walk over a dead entry.

`GameTimer.active` and `TimerManager.cancel()` are unchanged. A sweep of production code under
`simulation/`, `ai/`, `networking/`, `renderer/`, `electron/`, `apps/` and the scaffold templates
for readers of a timer's `active` field, and for callers of `TimerManager.create` / `cancel`,
found none outside `GameTimer.ts` itself.
