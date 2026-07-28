---
'create-chimera-game': patch
---

A scaffolded project no longer inherits the engine's image codecs. `sharp` and `png2icons`
are the monorepo's own icon-generation tooling, and the frozen toolchain snapshot a
standalone root declares is derived from the monorepo's root devDependencies — so every
scaffolded game was installing both, including `sharp`'s multi-megabyte platform-specific
native binary, for a tool it had opted out of.

That defeated the optional-peer declaration on `@chimera-engine/electron` upstream of
itself: the peers were correct, and the root manifest handed the codecs over before the
peer declaration was ever consulted. Both are now excluded from the snapshot, and a game
opts in the documented way with `pnpm add -D sharp png2icons`.

`sharp` remains present transitively — Next declares it as an `optionalDependency`, which
is why the emitted root still names it under `ignoredBuiltDependencies` — but it is no
longer a direct dependency the project asked for. `png2icons` leaves a scaffold entirely.

Found by the new `verify:scaffold` `generate-icons` arm on its first run against a real
installed probe.
