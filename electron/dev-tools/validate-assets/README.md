# validate-assets

The build-time asset-reference gate. It reads every place an `AssetRef` can be
declared and asserts that each one resolves to a file on disk, plus a handful of
adjacent rules. `AssetValidationReport`'s buckets in [`index.ts`](index.ts) are the
enumeration of what it checks; the printed report names one section per
non-empty bucket, and `ok` is the conjunction over the ones that fail a build
(`unresolvedOnDemandLoads` prints as a warning and does not).

A game may ship two manifests — `asset-manifest.ts` for the match, and
`shell-asset-manifest.ts` for what its shell surfaces load (forwarded as
`shellBackgroundAssets` and/or `shellAudioAssets`). How the two are discovered and where they differ is
[§4.10 CI Validation](../../../docs/core-components/asset-reference-system.md#ci-validation)'s.

It enforces **Invariants #22, #52, #97 and #125**, and satisfies **#20** by
living outside `simulation/` — the simulation never resolves an `AssetRef`, so
whatever does has to be somewhere else, and this is it.

## Running it

**In the monorepo** — no arguments, so the workspace root is the cwd:

```bash
pnpm validate:assets
```

**In a standalone game** — the published bin, from the game package:

```bash
pnpm --filter <your-game> validate:assets    # runs: chimera-validate-assets ../..
```

Both forms run the same discovery against the same layout. Nothing about the
tool changes between them.

## Why the standalone form passes `../..`

A project scaffolded by `create-chimera-game` is **not flat**. The game lands at
`apps/<kebab>` under an `apps/*` pnpm workspace, which is the same shape the
monorepo has — so the existing discovery works unchanged the moment it is
pointed at the project root.

Getting it pointed there is the whole trick, and it turns on cwd:

- pnpm runs a package script with **cwd = that package's directory**, so an
  app-level script runs in `apps/<kebab>`.
- The tool resolves its positional argument against the cwd
  (`resolve(argv[0] ?? process.cwd())`).
- From `apps/<kebab>`, `../..` is therefore the **project root** — whose
  `apps/*` scan finds the one game and resolves `apps/<kebab>/assets/…`.

The script is app-level for two independent reasons, and either alone would
settle it:

1. **The depth depends on it.** Run from the project root instead, `../..`
   resolves to the root's _parent_ — some unrelated ancestor directory.
2. **The bin is only linked there.** A standalone project's root manifest
   carries no `@chimera-engine/electron`, so pnpm links
   `chimera-validate-assets` into `apps/<kebab>/node_modules/.bin` and nowhere
   else.

## What it refuses

Pointed at a directory with no `apps/`, the tool **exits non-zero** rather than
reporting success. Games are discovered at `<root>/apps/<gameId>/`, so such a
root can only ever produce `Checked 0 asset refs; all files exist.` — the answer
"nothing is broken" about a tree in which no game could be found. For a
validator that is the worst possible failure, because it is indistinguishable
from a clean run.

This is reachable by hand, not hypothetical: running the bin **bare** from a
game package defaults the root to that package. `apps/` is the discriminator
precisely because a game package never has one while both supported layouts do
— and it cannot be any of the other directories the crawl reads, because a game
is invited to hold `simulation/` and `renderer/` of its own.

A root that _does_ have `apps/` is scanned normally, whatever it contains. A
freshly scaffolded game genuinely declares no assets yet and reports
`Checked 0 asset refs` for that reason — an answer about a tree that was read.

**In the monorepo, read the count and not just the exit code.** A crawl
regression — a walker that stops reading a manifest shape, a ref const it can no
longer resolve — reports success with a smaller `N` and no other symptom. The
absolute number is not the signal; a drop in it is.

## Dependencies

The on-demand-load scan parses TypeScript, so the tool imports `createSourceFile`,
`forEachChild`, `isCallExpression` and friends from the `typescript` package as
runtime **values**. `typescript` is therefore a declared **dependency** of
`@chimera-engine/electron`, not a devDependency: a consumer installing the
package must get it transitively, and `npm install @chimera-engine/electron`
reads only the manifest.

Note that a _resolution_ cannot prove this. Under pnpm every route to
`typescript` — this package's own closure, the project root's devDependency,
`.pnpm/node_modules` — realpaths to the same store directory, so
`require.resolve` returns an identical answer either way, and the scaffold
probe's own root declares `typescript` regardless. `verify:scaffold` therefore
reads the **installed manifest** for the declaration, and takes resolvability
from the fact that the bin ran at all: an unresolvable top-level import would
have failed both of its invocations.

## Layout

| Path                 | What                                                    |
| -------------------- | ------------------------------------------------------- |
| `index.ts`           | The tool: pure validation core + `runValidateAssetsCli` |
| `index.test.ts`      | Unit + real-FS integration tests for both               |
| `bin.test.ts`        | Anti-rot for the bin wiring, shebang, and the CLI entry |
| `relocation.test.ts` | Anti-rot for the tool's home and its reference surfaces |

The CLI entry guard is the shared `isDirectInvocation` from
[`../dev-harness/harness.ts`](../dev-harness/harness.ts), which canonicalises
both paths. A local copy comparing them raw never matches under a pnpm bin
shim — the shim execs node _through_ the `node_modules` symlink while node
reports the realpathed module — and the bin then exits 0 having written nothing.

See [§4.10 Asset Reference System](../../../docs/core-components/asset-reference-system.md)
for the rules themselves, and [§4.32 Dev Tooling](../../../docs/core-components/dev-tooling.md)
for the bin alongside its siblings.
