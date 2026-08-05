---
'@chimera-engine/electron': patch
---

`chimera/no-shell-games-import` and `chimera/no-main-games-import` now recognise a
game reached by its on-disk `apps/<name>/` path, not just a legacy `games/` path or
a non-engine `@chimera-engine/<game>` specifier. Games moved to `apps/` in F63, so
until now a shell page or an `electron/main` module could import one by relative
path and neither rule fired.

On a shell page the static form of that import was still blocked by the monorepo's
own `no-restricted-imports` zone; for an `electron/main` module reaching
`../../apps/<game>/…` nothing blocked it at all. A **dynamic**
`import('../../apps/<game>/…')` was blocked nowhere on either surface, because stock
`no-restricted-imports` does not inspect `import()` expressions. Both rules already
visited `ImportExpression`, so widening the specifier classifier each of them carries
closes the static and dynamic forms together, alongside a side-effect `import '…'`,
`export … from` and `export * from`.

A dynamic `import()` whose specifier is a no-substitution template literal is now
classified too — it names exactly one module, so treating it as unresolvable let one
swapped quote character walk a game past both rules.

Matching is path-SEGMENT-anchored at both ends (`(^|/)(apps|games)/`), so neither a
specifier that contains those letters mid-segment (`…/webapps/Panel.js`) nor one that
merely starts a longer segment (`…/gamestate.js`) is mistaken for a game. Rule tests
pin each classified form, accepted and rejected.

No engine or game source changed: the widened classifier matches nothing in the
current tree, and both rules stay withheld from the games-facing
`standaloneLintConfig` preset for the reasons recorded in `curated-rules.ts`.
