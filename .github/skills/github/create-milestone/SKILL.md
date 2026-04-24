---
name: create-milestone
description: 'Create a GitHub milestone for the Chimera project. Validates milestone title format, sets due date, and creates the milestone on jindrichruzicka/Chimera. Use when: bootstrapping a new release milestone, creating M1/M2/etc milestones, setting up project timeline.'
argument-hint: 'Milestone title and due date (e.g. "M1 2025-06-01")'
---

# Create Milestone Skill

Creates a GitHub milestone for the Chimera project with proper title, description, and due date.

## When to Use

- Bootstrapping a new release milestone (M1, M2, etc.)
- Setting up project timeline in GitHub
- Creating milestones before creating feature/task issues

---

## Procedure

### Step 1 — Check existing milestones

```bash
export GH_REPO=jindrichruzicka/Chimera
gh api repos/$GH_REPO/milestones --jq '.[] | "\(.number) \(.title) \(.state)"'
```

**Validate:** Milestone with the same title does not already exist in "open" state.

### Step 2 — Create the milestone

```bash
gh api repos/$GH_REPO/milestones --method POST \
  --field title="<MILESTONE_TITLE>" \
  --field description="<DESCRIPTION>" \
  --field due_on="<YYYY-MM-DDT00:00:00Z>"
```

**Example:**

```bash
gh api repos/$GH_REPO/milestones --method POST \
  --field title="M1 — Core Engine" \
  --field description="Core simulation, save/load, settings, and renderer bootstrap" \
  --field due_on="2025-06-01T00:00:00Z"
```

### Step 3 — Verify creation

```bash
gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | contains("M1")) | "\(.number) \(.title)"'
```

Record the milestone number — it will be needed when creating issues.

---

## Milestone Title Format

Follow the pattern: `<MILESTONE> — <SHORT_DESCRIPTION>`

Examples:

- `M1 — Core Engine`
- `M2 — Multiplayer & Networking`
- `M3 — AI & Content Pipeline`

---

## Notes

- Safe to re-run: if milestone already exists, the API returns 422 (ignore it)
- Due date is optional but recommended for project tracking
- Milestone number is different from labels — resolve it before creating issues
