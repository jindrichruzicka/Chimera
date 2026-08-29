---
'@chimera-engine/electron': patch
'create-chimera-game': patch
---

`validate-assets` now discovers a game's shell background manifest as well as its
match one. Asset manifests are found under `apps/` by whole basename, and the set is
now `asset-manifest.ts` plus `shell-asset-manifest.ts` — the inventory a game forwards
as the shell payload's `shellBackgroundAssets`, for what its menu background loads
outside a match.

Both names go through the same reader, so the shell manifest gets the existing
statically-readable-ref rules unchanged, is resolved against disk, has its `kind` and
any cue or animation sheet it carries checked, feeds the per-game manifest-const map,
and joins the declared-ref set the on-demand membership check is stated over. A
background asset the shell surface loads is therefore a declared load.

Invariant #22's manifest-coverage check is deliberately NOT widened: content JSON and
scene `requiredAssets` are match refs, resolved by the manager `GameShell` builds, and
that manager is handed the match manifest and never the background's. A content ref the
match manifest omits still fails even when the shell manifest declares it.

Two consequences of a game shipping two manifests are documented in §4.10 rather than
worked around: a const name the two disagree about resolves to nothing (the load
degrades to the unresolved-ref warning instead of picking whichever file the crawl
reached last), and the declared-ref union stays workspace-wide, so a shell-only ref
also satisfies a match-surface load.

Discovery stays a whole-basename match rather than a suffix or case-folded one: a
game's test doubles and per-screen helpers must not be read as inventories it ships,
because a manifest nobody ships satisfying membership is how a ref that is not really
there passes.

Nothing changes for a game with no shell background manifest — none exists in the tree
today and the reported ref count is unmoved.
