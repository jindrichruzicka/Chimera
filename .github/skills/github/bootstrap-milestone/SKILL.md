---
name: bootstrap-milestone
description: 'Bootstrap a full GitHub milestone from the architecture overview: creates milestone, labels, feature issues, and task issues in dependency order. Use when: setting up M1/M2/M3 from scratch, decomposing architecture sections into GitHub issues, creating the full issue backlog for a release.'
argument-hint: 'Milestone identifier (e.g. "M1" or "M2")'
---

# Bootstrap Milestone Skill

Bootstraps a complete GitHub milestone from the architecture overview: creates the milestone, all required labels, feature issues, and task issues in the correct dependency order.

## When to Use

-   Setting up M1, M2, or M3 from scratch
-   Decomposing architecture sections into GitHub issues
-   Creating the full issue backlog for a release
-   Initializing a new milestone before starting implementation work

---

## Procedure

### Step 1 — Read the architecture

Read the relevant sections from `docs/architecture-overview.md`:

-   **M1:** §4.1-4.15 (Core Engine), §12.1 (M1 checklist)
-   **M2:** §4.16-4.25 (Multiplayer), §12.2 (M2 checklist)
-   **M3:** §4.26-4.35 (AI & Content), §12.3 (M3 checklist)

### Step 2 — Check existing state

```bash
export GH_REPO=jindrichruzicka/Chimera

# Check existing milestones
gh api repos/$GH_REPO/milestones --jq '.[] | "\(.number) \(.title)"'

# Check existing issues for this milestone
gh issue list --repo $GH_REPO --state open --label "milestone:<M>" --json number,title
```

### Step 3 — Resolve milestone number

```bash
M_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("M<N>")) | .number')
```

If the milestone doesn't exist yet, create it using the [create-milestone skill](./create-milestone/SKILL.md).

### Step 4 — Create labels

Create all required labels using the [create-labels skill](./create-labels/SKILL.md):

```bash
# Milestone label
gh label create "milestone:M1" --color "6b3ea1" --description "Core Engine (M1)" --repo $GH_REPO || true

# Type labels
gh label create "feature" --color "0e8a16" --description "Feature issue" --repo $GH_REPO || true
gh label create "task" --color "0075ca" --description "Task/implementation issue" --repo $GH_REPO || true

# Module labels (as needed)
gh label create "simulation" --color "0596ca" --description "Simulation core" --repo $GH_REPO || true
gh label create "renderer" --color "0596ca" --description "React/R3F renderer" --repo $GH_REPO || true
```

### Step 5 — Present decomposition to user

**Before creating any issues, present the planned decomposition:**

```
Milestone: M1 — Core Engine
============================

Feature Issues:
  #1: Save/Load System (§4.11)
  #2: Settings System (§4.12)
  #3: Renderer Bootstrap (§4.13)

Task Issues:
  Under #1 (Save/Load):
    - Implement SaveRepository interface
    - Implement InMemorySaveRepository
    - Implement FileSaveRepository
    - Add save/load actions to ActionPipeline
    - Write integration tests

  Under #2 (Settings):
    - Implement Settings schema
    - Implement SettingsStore
    - Wire settings UI components
    - Add settings persistence

  Under #3 (Renderer):
    - Implement AssetManager
    - Implement useAsset hook
    - Create R3F scene components
    - Wire IPC bridge

Total: 3 feature issues, 11 task issues

Proceed? (y/n)
```

**Wait for user approval before creating any issues.**

### Step 6 — Create feature issues

Create feature issues in dependency order using the [create-issue skill](./create-issue/SKILL.md). Record each issue number:

```bash
# Feature 1: Save/Load
FEATURE_SAVELOAD=$(gh issue create \
  --repo $GH_REPO \
  --title "Save/Load System (§4.11)" \
  --label "feature,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/feature-save-load.md \
  --json number --jq '.number')

echo "Created feature issue #$FEATURE_SAVELOAD"
```

### Step 7 — Create task issues

Create task issues under each feature, referencing the parent:

```bash
# Task under Save/Load feature
gh issue create \
  --repo $GH_REPO \
  --title "Implement SaveRepository interface" \
  --label "task,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/task-save-repo.md \
  --json number --jq '.number'
```

The task body must include `Part of #$FEATURE_SAVELOAD` on line 1.

### Step 8 — Verify all issues

```bash
# List all issues under the milestone
gh issue list --repo $GH_REPO --state open --milestone "M1 — Core Engine" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# Verify at milestone URL
echo "Check: https://github.com/jindrichruzicka/Chimera/milestone/$M_ID"
```

### Step 9 — Report summary

```
✅ Milestone bootstrapped successfully

Milestone: M1 — Core Engine (#$M_ID)
Feature Issues: 3
Task Issues: 11

| Feature         | Issue | Tasks |
| --------------- | ----- | ----- |
| Save/Load §4.11 | #12   | 5     |
| Settings §4.12  | #13   | 3     |
| Renderer §4.13  | #14   | 3     |

Next steps:
  - Review issues at: https://github.com/jindrichruzicka/Chimera/milestone/$M_ID
  - Start implementation with: .github/skills/git/create-branch/SKILL.md
```

---

## Notes

-   **Always present the decomposition first** — never create issues without user approval
-   **Create features before tasks** — tasks need the feature issue number for `Part of #N`
-   **Verify milestone assignment** — check both label and milestone field are set
-   **Follow architecture order** — create issues in dependency order (§4.1 before §4.2, etc.)
