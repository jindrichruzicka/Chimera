---
name: bootstrap-milestone
description: 'Bootstrap a full GitHub milestone from the architecture overview: creates milestone, labels, feature issues, and task issues in dependency order. Use when: setting up M1/M2/M3 from scratch, decomposing architecture sections into GitHub issues, creating the full issue backlog for a release.'
argument-hint: 'Milestone identifier (e.g. "M1" or "M2")'
---

# Bootstrap Milestone Skill

Creates a full milestone backlog from the architecture: milestone → labels → feature issues → task issues, in dependency order.

## Procedure

### 1. Read architecture

`docs/architecture-overview.md`:

- M1: §4.1–4.15 (Core Engine), §12.1 checklist
- M2: §4.16–4.25 (Multiplayer), §12.2 checklist
- M3: §4.26–4.35 (AI & Content), §12.3 checklist

### 2. Check existing state

```bash
export GH_REPO=jindrichruzicka/Chimera
gh api repos/$GH_REPO/milestones --jq '.[] | "\(.number) \(.title)"'
gh issue list --repo $GH_REPO --state open --label "milestone:<M>" --json number,title
```

### 3. Resolve / create milestone

```bash
M_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("M<N>")) | .number')
```

If missing, use [create-milestone skill](../create-milestone/SKILL.md).

### 4. Create labels

Use [create-labels skill](../create-labels/SKILL.md). At minimum:

```bash
gh label create "milestone:M1" --color "6b3ea1" --description "Core Engine (M1)" --repo $GH_REPO || true
gh label create "feature" --color "0e8a16" --description "Feature issue" --repo $GH_REPO || true
gh label create "task" --color "0075ca" --description "Task/implementation issue" --repo $GH_REPO || true
gh label create "simulation" --color "0596ca" --description "Simulation core" --repo $GH_REPO || true
gh label create "renderer"   --color "0596ca" --description "React/R3F renderer" --repo $GH_REPO || true
```

### 5. Present decomposition (USER APPROVAL REQUIRED)

Before creating any issues, show:

```
Milestone: M1 — Core Engine

Feature Issues:
  #1: Save/Load System (§4.11)
  #2: Settings System (§4.12)
  #3: Renderer Bootstrap (§4.13)

Task Issues:
  Under #1: Implement SaveRepository / InMemorySaveRepository / FileSaveRepository / save-load actions / integration tests
  Under #2: Settings schema / SettingsStore / settings UI / persistence
  Under #3: AssetManager / useAsset / R3F scene components / IPC bridge

Total: 3 features, 11 tasks. Proceed? (y/n)
```

Wait for approval.

### 6. Create feature issues

In dependency order, via [create-issue skill](../create-issue/SKILL.md). Record numbers:

```bash
FEATURE_SAVELOAD=$(gh issue create --repo $GH_REPO \
  --title "Save/Load System (§4.11)" \
  --label "feature,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/feature-save-load.md \
  --json number --jq '.number')
```

### 7. Create task issues

Each body **must include `Part of #$FEATURE_SAVELOAD`** on line 1.

```bash
gh issue create --repo $GH_REPO \
  --title "Implement SaveRepository interface" \
  --label "task,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/task-save-repo.md
```

### 8. Verify

```bash
gh issue list --repo $GH_REPO --state open --milestone "M1 — Core Engine" \
  --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

URL: `https://github.com/jindrichruzicka/Chimera/milestone/$M_ID`.

### 9. Report

```
✅ Milestone bootstrapped — M1 — Core Engine (#$M_ID)
Features: N · Tasks: N
Next: bash .claude/skills/git/create-branch/scripts/create-branch.sh <task-N>
```

## Rules

- **Always present decomposition first** — never auto-create.
- **Features before tasks** — tasks need parent issue number.
- **Verify both label AND milestone field** are set.
- **Architecture order** — §4.1 before §4.2 etc.
