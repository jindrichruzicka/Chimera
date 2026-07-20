---
'@chimera-engine/electron': minor
'create-chimera-game': minor
---

Scaffolded games get the Invariant #27 packaged-bundle guard, driven from a new engine export (§4.12).

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
