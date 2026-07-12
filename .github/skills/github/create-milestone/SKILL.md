---
name: create-milestone
description: 'Create a GitHub milestone for the Chimera project. Validates milestone title format, sets due date, and creates the milestone on jindrichruzicka/Chimera. Use when: bootstrapping a new release milestone, creating M1/M2/etc milestones, setting up project timeline.'
argument-hint: 'Milestone title and due date (e.g. "M1 2025-06-01")'
---

# Create Milestone Skill

## Steps

```bash
export GH_REPO=jindrichruzicka/Chimera

# 1. Check existing — abort if open milestone with same title exists
gh api repos/$GH_REPO/milestones --jq '.[] | "\(.number) \(.title) \(.state)"'

# 2. Create
gh api repos/$GH_REPO/milestones --method POST \
  --field title="M1 — Core Engine" \
  --field description="Core simulation, save/load, settings, and renderer bootstrap" \
  --field due_on="2025-06-01T00:00:00Z"

# 3. Verify + record number (needed for issue creation)
gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | contains("M1")) | "\(.number) \(.title)"'
```

## Title Format

`<MILESTONE> — <SHORT_DESCRIPTION>` — e.g. `M1 — Core Engine`, `M2 — Multiplayer & Networking`, `M3 — AI & Content Pipeline`.

## Milestone ↔ version (locked `1.X.Y`, from `1.0.0`)

A milestone defines the shared **compatibility line** `X`: it releases as **`1.X.0`** across the whole first-party set (every `@chimera-engine/*` package + `create-chimera-game`), and its `X` may contain breaking changes. See [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md).

- **M10** → `1.0.0` (first public release). The next coordinated milestone → `1.1.0`, then `1.2.0`, …
- Between-milestone package updates are **patches** (`1.X.Y`), shipped via `/publish-packages`, not new milestones.
- Legacy (retired at `1.0.0`): `M1`→`0.1.0` … `M9`→`0.9.0`, independent per-package semver.

Reflect the target version in the milestone description (e.g. "First public 1.0.0 release …").

## Notes

- Safe to re-run: 422 if exists (ignore).
- Milestone number ≠ label name — record numeric ID for issue creation.
- Also create the matching `milestone:M<n>` label (color `5319e7`) if the repo's issues use both the milestone field and label (they do).
