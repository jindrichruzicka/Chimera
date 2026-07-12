---
title: 'M10 — First Public Release (v1.0.0)'
description: 'The first public 1.0.0 release of Chimera. Introduces the locked 1.X.Y versioning scheme: every @chimera-engine/* package and create-chimera-game share one version, kept in sync per milestone and re-published together on every patch. Features are TBD.'
tags: [milestone, m10, release, v1, versioning, semver, lock-step, create-chimera-game, publishing]
---

# M10 — First Public Release (v1.0.0)

> **Goal**: Cut Chimera's first public **`1.0.0`** release and adopt the **locked `1.X.Y` versioning scheme** across the whole published surface. From this milestone on, every `@chimera-engine/*` package and the `create-chimera-game` initializer ship at **one shared version**.
>
> **Status**: Open. **Features TBD** — this section will be filled in as work is planned.

---

## Versioning scheme (adopted at 1.0.0)

`1.0.0` is the first _public_ Chimera release, and from it forward the version is read as **`1.X.Y`**:

- **`1`** — the major "Chimera 1" line: the first public API surface.
- **`X`** (middle) — the **major/compatibility line**. It may contain breaking changes and is **synced across every package** (including `create-chimera-game`) so a matching `X` always signals mutual compatibility. A milestone advances `X` and resets the patch to `0` (`1.X.0`).
- **`Y`** (patch) — any package update between milestones. **All packages re-release together at the same `1.X.Y`**, even when only one changed, so the shared version always signals a compatible set.

Worked example (matches the design intent):

| Event                                                     | Resulting version (all packages) |
| --------------------------------------------------------- | -------------------------------- |
| M10 release                                               | `1.0.0`                          |
| `create-chimera-game` needs a fix                         | `1.0.1`                          |
| `@chimera-engine/ai` needs a fix                          | `1.0.2`                          |
| `@chimera-engine/simulation` new feature line (milestone) | `1.1.0`                          |

The complete rules, the lock-step rationale, and the release-time enforcement live in **[`docs/versioning-policy.md`](../versioning-policy.md)**.

---

## Enforcement

- **Changesets** are configured with a single `fixed` version group so a bump to any package bumps the whole set to one version (`.changeset/config.json`).
- A **`verify:version-alignment`** gate (`tools/version-alignment.ts`) fails the release if the published `@chimera-engine/*` packages and `create-chimera-game` are not all on the identical `1.X.Y`. It runs in the pre-release gate and in `release.yml` before publish.

---

## Features

_TBD — to be planned. This milestone currently carries no features._

---

## Cross-References

- [Versioning Policy](../versioning-policy.md) — the canonical `1.X.Y` lock-step rules and enforcement.
- [Product Roadmap (Index Hub)](../ROADMAP.md) — milestone/version overview.
- [M9 — Package Extraction & Game Scaffolding (v0.9.0)](m9-package-extraction-v0.9.0.md) — the package hierarchy this scheme locks together.
