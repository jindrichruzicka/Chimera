---
'@chimera-engine/electron': patch
---

Pin `APP_AI_PATH`'s segment anchor, trailing slash, and single-segment app name.

`APP_AI_PATH` gates Invariant #76's per-game AI arm in `no-fromfloat-in-simulation`, so widening it
silently turns unrelated code into a forbidden zone. Three independent widenings of that one regex
left the whole `electron/dev-tools/eslint` directory green — the `(?:^|/)` segment anchor, the
trailing `/`, and `[^/]+` relaxed to `.+`. No `valid` case in the file carried `apps/<x>/ai` as a
substring, so no fixture sat on the far side of any of them.

Each widening buys reachable wrong behaviour. Without the anchor, a directory whose name merely ENDS
in `apps` contains `apps/<game>/ai/` as a substring, so a `webapps/` tree's AI code is reported.
Without the trailing slash, a file directly under `apps/<game>/` whose name merely starts with `ai`
fires. With `.+` the app-name segment crosses slashes, so any nested `ai/` inside a game app — a
renderer one, say — becomes a forbidden zone.

The rule is unchanged and correct; this is test coverage. Three `valid` cases, one per axis, each
carrying a real `fromFloat` call imported from FixedPoint so it can only pass because the zone check
said no, and each verified RED against its own spliced mutant first. The sibling rules' "file
directly under `apps/`" fixture does not transfer: `APP_AI_PATH` ends one segment later than
`isGameFile`, so such a path matches neither the shipped regex nor the mutant.
