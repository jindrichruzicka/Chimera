---
title: 'Chimera Versioning Policy — Locked 1.X.Y'
description: 'The canonical versioning rules for the published Chimera surface: every @chimera-engine/* package and create-chimera-game share one locked 1.X.Y version, synced per milestone and re-published together on every patch. Effective from 1.0.0 (M10).'
tags: [versioning, semver, release, publishing, lock-step, changesets]
---

# Chimera Versioning Policy — Locked `1.X.Y`

**Effective from `1.0.0` (milestone M10).** This is the single source of truth for how the published Chimera surface is versioned. Agents, skills, and CI all defer to this document.

> **Scope.** This policy governs the **first-party published set**: the `@chimera-engine/*` engine packages and the `create-chimera-game` initializer. It does **not** govern third-party extension libraries (`@chimera-engine/<domain>` adopters), which follow independent semver per the [Adopter On-Ramp](adopter-on-ramp.md).

---

## The rule

Every published first-party package shares **one locked version**, read as **`1.X.Y`**:

| Field   | Name               | Meaning                                                                                                                                                         | Who moves it                          |
| ------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **`1`** | Public major line  | The first public Chimera API surface. Reserved for a future wholesale re-platform.                                                                              | A generational rewrite (not planned). |
| **`X`** | Compatibility line | The major/compatibility number. **May contain breaking changes.** A matching `X` across packages signals **mutual compatibility**. Synced across the whole set. | A **milestone** (`1.X.0`).            |
| **`Y`** | Patch              | Any package update between milestones — fix, non-breaking feature, doc/asset refresh. **All packages re-release together at the same `1.X.Y`.**                 | A package update between milestones.  |

### Two invariants

1. **Alignment** — at every published state, **all** first-party packages (including `create-chimera-game`) are on the **identical** `1.X.Y`. There is no such thing as `@chimera-engine/ai@1.0.2` alongside `@chimera-engine/renderer@1.0.1`.
2. **Lock-step bumps** — a bump to _any_ package bumps the _whole set_ to the next shared version. A milestone advances `X` and resets patch to `0`; a between-milestone update advances `Y`.

### Worked example

| Event                                                         | Version (every package)   |
| ------------------------------------------------------------- | ------------------------- |
| **M10** ships                                                 | `1.0.0`                   |
| `create-chimera-game` needs a fix                             | `1.0.1` (all republished) |
| `@chimera-engine/ai` needs a fix                              | `1.0.2` (all republished) |
| another `@chimera-engine/ai` fix                              | `1.0.3` (all republished) |
| `@chimera-engine/simulation` new feature line via a milestone | `1.1.0` (all republished) |

Even when only one package changed, **the entire set republishes at the new `1.X.Y`** so the shared version number is always an honest "these are compatible" signal.

---

## Why lock-step (and not independent semver)

Chimera's packages are a tightly-coupled inward DAG (`simulation` ← `ai`/`networking` ← `renderer` ← `electron`), consumed together by a game app and by `create-chimera-game`. A consumer never mixes versions across the boundary in practice. Independent per-package semver optimizes for the case where consumers upgrade packages à la carte — which Chimera consumers do not do. The shared `1.X.Y` makes "which versions go together?" answerable at a glance and removes an entire class of skew bugs.

> **History.** Through `0.x` (M1–M9) the engine used **independent** per-package semver with a `simulation`-major cascade gate. The `0.x` drift (`simulation@0.10.0`, `ai@0.9.1`, `create-chimera-game@0.2.0`, …) is exactly what this policy retires. `1.0.0` re-aligns everything and locks it.

---

## Milestone ↔ version mapping

- A milestone defines the **compatibility line**: `M<n>` → `1.X.0` for the next `X`. M10 → `1.0.0`; the next milestone with a coordinated release → `1.1.0`; and so on.
- The milestone keeps the version **in sync**: closing a milestone re-publishes the whole set at `1.X.0`.
- Between milestones, individual package updates ship as patches `1.X.Y` — still the whole set, still one version.
- `create-chimera-game` is **not special**: it tracks the same `1.X.Y` as the engine packages so a scaffolded game always pins a mutually-compatible set.

---

## Enforcement

### 1. Changesets `fixed` group

`.changeset/config.json` declares a single `fixed` version group containing every first-party package (`@chimera-engine/*` + `create-chimera-game`). Changesets then treats them as one unit: a changeset touching any member bumps **all** members to the same version, and per-package `CHANGELOG`s stay in step. The old `simulation`-major cascade gate (`tools/changeset-policy.ts`) is subsumed — under a `fixed` group there is no "under-bumped dependent" to catch, because everything moves together.

### 2. `verify:version-alignment` gate

`tools/version-alignment.ts` (script: `pnpm verify:version-alignment`) reads every first-party `package.json` and **fails** unless:

- all versions are byte-identical, and
- the shared version matches `1.X.Y` (major `>= 1`).

It runs:

- in the **pre-release gate** (before tagging a milestone), and
- in **`release.yml`** before `changeset publish`,

so a misaligned set can never reach the registry.

### 3. Release skills

Both `/create-release` (milestone tag) and `/publish-packages` (package tags) treat the version as **one shared `1.X.Y`**. They pick the next shared version (milestone → `1.X.0`, otherwise → `1.X.(Y+1)`), let Changesets apply it to the whole `fixed` group, and run `verify:version-alignment` before pushing.

---

## Quick reference for agents

- **Never** propose a version for a single package. Versions are always the shared `1.X.Y`.
- **Milestone release** → `1.X.0` (advance the compatibility line `X`, reset patch).
- **Any package update between milestones** → `1.X.(Y+1)` (advance patch; republish all).
- **Breaking change** → it belongs to a milestone, which advances `X`. A matching `X` is the compatibility promise.
- Run `pnpm verify:version-alignment` before any tag/publish; if it fails, re-align, don't override.

---

## Cross-References

- [Product Roadmap — M10 (v1.0.0)](roadmap-sections/m10-first-public-release-v1.0.0.md)
- [Adopter On-Ramp](adopter-on-ramp.md) — third-party `@chimera-engine/<domain>` extension libraries use **independent** semver (out of scope for this lock-step policy).
- Changesets config: [`.changeset/config.json`](../.changeset/config.json) and [`.changeset/README.md`](../.changeset/README.md)
- Alignment gate: [`tools/version-alignment.ts`](../tools/version-alignment.ts)
