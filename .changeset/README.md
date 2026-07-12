# Changesets — Chimera locked `1.X.Y` versioning

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets). From
`1.0.0` onward it drives the **locked lock-step versioning scheme**: every first-party
published package — the `@chimera-engine/*` engine packages **and** the `create-chimera-game`
initializer — shares **one version, `1.X.Y`**. The canonical rules live in
[`docs/versioning-policy.md`](../docs/versioning-policy.md); this file is the operational
summary for working with changesets.

> Through `0.x` (M1–M9) the engine used **independent** per-package semver with a
> `@chimera-engine/simulation`-major cascade gate. That is retired at `1.0.0`. The `fixed`
> group in [`config.json`](./config.json) now locks the whole set to one version.

## The locked group

[`config.json`](./config.json) declares a single `fixed` group:

```
@chimera-engine/simulation, @chimera-engine/ai, @chimera-engine/networking,
@chimera-engine/renderer, @chimera-engine/electron, create-chimera-game
```

Changesets treats a `fixed` group as **one unit**: a changeset touching _any_ member bumps
**all** members to the same version, so they are always aligned. The private
`@chimera-engine/tactics` reference app and the `templates/blank` scaffolding source are **not**
in the group — they publish nothing.

## Declaring a change

Run `pnpm changeset`, pick the affected package(s), a bump level (`patch` / `minor` /
`major`), and a one-line summary. Because the packages are `fixed`, it does not matter which
member(s) you select — the whole group moves together. Bump level maps to the shared version:

| You want                                   | Bump level | Shared version effect |
| ------------------------------------------ | ---------- | --------------------- |
| A between-milestone package update (patch) | `patch`    | `1.X.Y` → `1.X.(Y+1)` |
| A milestone / new compatibility line       | `minor`    | `1.X.Y` → `1.(X+1).0` |

> A **breaking change** belongs to a milestone, which advances the middle `X` (`minor` bump in
> Changesets terms, since the leading `1` is the fixed public line). Reserve a `major` bump
> (`1` → `2`) for a future wholesale re-platform only.

## Applying versions

At release time:

```bash
pnpm verify:version-alignment   # fails unless every first-party pkg is on the SAME 1.X.Y
pnpm version-packages           # = changeset version && pnpm install --lockfile-only
```

`version-packages` consumes every pending changeset, bumps the whole `fixed` group to the
next shared version, and writes each member's `CHANGELOG.md`. `pnpm release` then builds and
publishes. **All members republish together at the new `1.X.Y`**, even the ones with no
source change — the shared version is the compatibility signal.

## Enforcement

- **`fixed` group** (this folder's `config.json`) keeps bumps in lock-step.
- **`pnpm verify:version-alignment`** ([`tools/version-alignment.ts`](../tools/version-alignment.ts))
  fails the release unless all first-party versions are the identical `1.X.Y`. It runs in the
  pre-release gate and in `release.yml` before publish.
