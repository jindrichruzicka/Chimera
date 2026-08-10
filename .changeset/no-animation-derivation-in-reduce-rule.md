---
'@chimera-engine/electron': minor
---

Add `chimera/no-animation-derivation-in-reduce`, the tenth rule in the `chimera` ESLint plugin
and the sixth the standalone preset curates. It reports a `compileAnimationWindows(...)` or
`beatsForRealSeconds(...)` call made from inside a function named `reduce` or `validate`. Both
derive a beat count from `tickRateMs`, the host's pacing knob, and both belong at content-load,
where the derivation is compared once against the window the game authored. Called at reduce
time they make the LENGTH of a gameplay window a function of the tick rate: raising it silently
widens or narrows every window in the game, and two hosts on different rates diverge.

Both halves of the rule are name-based and both are checked. WHAT: the two callees, in either
the bare or the `namespace.member` position, so a re-export cannot launder the call. WHERE:
lexical containment in a function BOUND to one of the two names — its declaration name, its
variable, its object or class key, or its assignment target. A callback merely handed to
`Array#reduce` is bound to nothing and is not a `reduce` body, which is the false positive the
rule's name invites.

Unlike its `no-fromfloat-in-simulation` sibling it declares no path predicate of its own: the
flat-config zone that switches it on IS its scope. In the monorepo that is `simulation/**`,
`apps/*/simulation/**` and `apps/*/ai/**`, off under `simulation/content/loaders/**` and on test
files; in a standalone game the preset maps it onto `simulation/**` and `ai/**` with the same
test-file exemption. The practical difference from its sibling is that its `ai/**` arm stays
live for a game that does not sit under an `apps/<name>/` directory.

The zone is proved by `--print-config` against real files in `simulation/__tests__/eslint-animation-derivation-zone.test.ts`,
because a rule can be correct, registered and resolvable while guarding zero files.
