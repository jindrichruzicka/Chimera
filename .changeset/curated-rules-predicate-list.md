---
'@chimera-engine/electron': patch
---

Correct the curated-rules predicate list: `no-raw-r3f-canvas` has an `apps/<name>/` predicate too.

`curated-rules.ts` is what an adopter reads to understand why a curated rule went quiet in their
layout, and its enumeration named three rules with an `apps/<name>/` path predicate. There are four
— `no-raw-r3f-canvas` carries one and says so in its own source, and `preset.ts` already counted it.
A reader trusting the shorter list would conclude that rule is layout-independent when it is not.

The same passage said those predicates "read the ABSOLUTE filename". What they want is the
`apps/<name>/` SEGMENT, not a leading slash — a relative filename satisfies them just as well, which
`no-raw-r3f-canvas.test.ts` already measured through its existing relative and absolute cases. That
file gains one case: a game surface at a bare project root, which must NOT fire — the layout
`preset.ts` warns a standalone game about.

No rule behaviour changes. The same "ABSOLUTE" wording is struck wherever this branch's repaired
passage would send a reader — `preset.ts`, its test header, `electron/dev-tools/eslint/README.md`,
§4.32, and the pending `standalone-lint-config-preset` changeset, which republishes at `pre exit`.
The published copy in `electron/CHANGELOG.md` is a release record and is left as written.
