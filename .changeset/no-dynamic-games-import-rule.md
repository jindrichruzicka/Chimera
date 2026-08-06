---
'@chimera-engine/electron': minor
---

New `chimera/no-dynamic-games-import` lint rule (Invariant #1), plus dynamic-`import()` coverage for two existing rules.

Stock `no-restricted-imports` never visits `ImportExpression`, so every zone that banned a game through it was silent on `import('…/apps/<game>/…')`. The new rule covers that position. It classifies a game the way its sibling `chimera/*` game-import rules do — an `apps/`/`games/` path segment, or a non-engine `@chimera-engine/*` package — which is broader than any one zone's `no-restricted-imports` group, so neither guard subsumes the other. It carries no path predicate of its own: the flat-config zone that declares it is its scope.

`chimera/no-main-provider-internals` now reads a no-substitution template specifier, so ``import(`…/networking/provider/local/…`)`` is caught alongside the quoted form. `chimera/no-game-renderer-internals` gains an `ImportExpression` visitor, so Invariant #96's game-side barrel boundary holds for a code-split load as well as a static one.

Withheld from `standaloneLintConfig()`: a scaffolded game is itself a non-engine `@chimera-engine/*` package and self-imports through that specifier, so a game that code-splits one of those self-imports would be reported for lazily loading itself. `curated-rules.ts` records the reason as data, alongside the other withheld rules.
