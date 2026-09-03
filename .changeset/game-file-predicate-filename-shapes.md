---
'@chimera-engine/electron': patch
---

Pin the `apps/<name>/` filename predicate the curated ESLint rules gate on.

`isGameFile` decides whether `no-raw-r3f-canvas` and `no-game-renderer-internals` run at all — a
rule that says no returns `{}` and sees nothing. Three independent deletions from that one regex
survived every test in the repo: the `(?:^|/)` segment anchor, the trailing `/`, and the
`normalizePath` call. The filename side had none of the three axes the specifier-side classifier
already pins in `game-path.test.ts`.

Each deletion buys reachable wrong behaviour. Without the anchor, `webapps/` — anything whose
directory name merely ENDS in `apps` — reads as a game app, so checking the repo out under such a
directory misreads every engine renderer file as a game file. Without the trailing slash, a file
sitting directly under `apps/` fires. Without `normalizePath`, both rules go silently inert on
every Windows path. `no-fromfloat-in-simulation` carried its own untested backslash normalisation,
under a header claiming it "normalises Windows backslashes" — the same shape, inert the same way.

The rules are unchanged and correct; this is test coverage. `no-raw-r3f-canvas` and
`no-game-renderer-internals` each gain one case per axis, and the latter's Windows case is a
`screens/*.tsx` path so it traverses `isGameRendererSurface` alongside `isGameFile`; two further
Windows cases there pin `isGameI18nCatalogue` and `isAppNextHostRoute`.
`no-fromfloat-in-simulation` gains the backslash case its own normalisation needed. Each was
verified RED against its own mutant. The `[^/]+` → `[^/]*` variant deliberately gets no case: it is equivalent over the
reachable domain, since `path.resolve` collapses the doubled slash an empty app-name segment would
need, and the test file records that reason where the next reader meets it.
