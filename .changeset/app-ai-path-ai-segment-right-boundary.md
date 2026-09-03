---
'@chimera-engine/electron': patch
---

Pin `APP_AI_PATH`'s `ai`-segment right boundary.

`APP_AI_PATH` gates Invariant #76's per-game AI arm in `no-fromfloat-in-simulation`. Widening the
`ai` segment from `ai\/` to `ai[^/]*\/` — the segment gaining a `[^/]*` suffix before its own
trailing slash — left the whole `electron/dev-tools/eslint` directory green. No case pinned this
boundary for a sibling directory whose name merely starts with `ai`.

The widening buys reachable wrong behaviour: a directory such as `apps/tactics/aiHelpers/` — a
plausible helper directory that is not the sanctioned AI zone — becomes a forbidden zone, so
`fromFloat` inside it is wrongly reported.

The rule is unchanged and correct; this is test coverage. One `valid` case added
(`apps/tactics/aiHelpers/util.ts`), carrying a real `fromFloat` call imported from FixedPoint so it
can only pass because the zone check said no, and verified RED against its own spliced mutant first.
