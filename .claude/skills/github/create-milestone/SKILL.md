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

## Notes

- Safe to re-run: 422 if exists (ignore).
- Milestone number ≠ label name — record numeric ID for issue creation.
