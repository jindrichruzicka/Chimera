---
name: create-issue
description: 'Create a GitHub issue (feature, task, or bug) for the Chimera project. Validates issue type, applies correct labels, assigns to milestone, and uses the appropriate template. Use when: creating a new feature issue from architecture, creating task issues under a feature, creating bug reports, decomposing features into tasks.'
argument-hint: 'Issue type and details (e.g. "task #42 Implement X" or "feature §4.1 Save/Note")'
---

# Create Issue Skill

## Step 1 — Resolve milestone number

```bash
export GH_REPO=jindrichruzicka/Chimera
M1_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("M1")) | .number')
```

**Milestone number ≠ label.** Always resolve numeric ID before creating issues.

## Step 2 — Prepare body

Templates: [feature-template.md](../assets/feature-template.md), [task-template.md](../assets/task-template.md).

Write to temp file (avoids shell quoting):

```bash
cat > /tmp/issue-body.md << 'BODYEOF'
<body with placeholders replaced>
BODYEOF
```

## Step 3 — Create

```bash
# Task
gh issue create --repo $GH_REPO \
  --title "<imperative-verb> <what>" \
  --label "task,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/issue-body.md

# Feature
gh issue create --repo $GH_REPO \
  --title "<feature name> (§<X.Y>)" \
  --label "feature,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/issue-body.md

# Bug
gh issue create --repo $GH_REPO \
  --title "fix: <what is broken>" \
  --label "bug,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/issue-body.md
```

## Critical Rules

**Both required for milestone view:**

1. `milestone:M<N>` **label** (cosmetic tag).
2. GitHub **milestone assignment** via `--milestone "<title>"` or `--field milestone=<NUMERIC_ID>`.

Omitting (2) → issue won't appear at `github.com/.../milestone/<N>`.

**Title format:**

- Task: imperative verb ("Implement", "Add", "Write", "Wire", "Refactor")
- Feature: `<name> (§<X.Y>)` with arch section reference
- Bug: `fix: <what is broken>`

**Body:**

- Tasks: `Part of #<feature-issue-number>` on line 1.
- Tasks: at least one `Invariant` line if touching [Architecture Invariants](../../../../docs/executive-architecture/architecture-invariants.md).
- Module label ∈ `simulation`/`networking`/`renderer`/`electron`/`ai`/`testing`/`tooling`.
- Replace ALL `<placeholders>`.

## Verify

```bash
gh issue view <NUMBER> --repo $GH_REPO --json number,title,milestone,labels
```

URL: `https://github.com/jindrichruzicka/Chimera/milestone/<MILESTONE_NUMBER>`.

## Troubleshooting

```bash
# Milestone assignment failed (title mismatch) — assign by ID
gh api repos/$GH_REPO/issues/<ISSUE> --method PATCH --field milestone=$M1_ID

# Label missing
gh label create "milestone:M1" --color "6b3ea1" --description "Core Engine (M1)" --repo $GH_REPO
```
