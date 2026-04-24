---
name: create-issue
description: 'Create a GitHub issue (feature, task, or bug) for the Chimera project. Validates issue type, applies correct labels, assigns to milestone, and uses the appropriate template. Use when: creating a new feature issue from architecture, creating task issues under a feature, creating bug reports, decomposing features into tasks.'
argument-hint: 'Issue type and details (e.g. "task #42 Implement X" or "feature §4.1 Save/Load")'
---

# Create Issue Skill

Creates a GitHub issue (feature, task, or bug) for the Chimera project with proper labels, milestone assignment, and template.

## When to Use

-   Creating a new feature issue from the architecture overview
-   Creating task issues under a parent feature
-   Creating bug reports
-   Decomposing features into implementation tasks

---

## Procedure

### Step 1 — Resolve milestone number (if applicable)

```bash
export GH_REPO=jindrichruzicka/Chimera
M1_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("M1")) | .number')
```

**IMPORTANT:** Milestone number is different from the label. Always resolve it before creating issues.

### Step 2 — Prepare the issue body

Use the appropriate template:

-   **Feature issues:** [feature-template.md](../assets/feature-template.md)
-   **Task issues:** [task-template.md](../assets/task-template.md)

Write the body to a temp file to avoid shell quoting issues:

```bash
cat > /tmp/issue-body.md << 'BODYEOF'
<body content here with all placeholders replaced>
BODYEOF
```

### Step 3 — Create the issue

#### For a task issue:

```bash
gh issue create \
  --repo $GH_REPO \
  --title "<imperative verb> <what>" \
  --label "task,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/issue-body.md
```

#### For a feature issue:

```bash
gh issue create \
  --repo $GH_REPO \
  --title "<feature name> (§<X.Y>)" \
  --label "feature,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/issue-body.md
```

#### For a bug issue:

```bash
gh issue create \
  --repo $GH_REPO \
  --title "fix: <what is broken>" \
  --label "bug,milestone:M1,simulation" \
  --milestone "M1 — Core Engine" \
  --body-file /tmp/issue-body.md
```

---

## Critical Rules

### Two Separate Things for Milestone Assignment

> **IMPORTANT — both must be set for an issue to appear under a milestone:**
>
> 1. The `milestone:M<N>` **label** (a coloured tag — cosmetic).
> 2. The GitHub **milestone assignment** — done via `--milestone "<title>"` or `--field milestone=<NUMERIC_ID>`.
>
> Omitting (2) means the issue will not appear at `github.com/.../milestone/<N>`.

### Title Format

-   **Task:** Start with imperative verb: "Implement", "Add", "Write", "Wire", "Refactor"
-   **Feature:** `<feature name> (§<X.Y>)` — include architecture section reference
-   **Bug:** `fix: <what is broken>`

### Body Requirements

1. **Task issues:** Always include `Part of #<feature-issue-number>` on line 1
2. **Task issues:** Always include at least one `Invariant` line if the task touches Appendix B
3. **Module label:** Must be one of: `simulation`, `networking`, `renderer`, `electron`, `ai`, `testing`, `tooling`
4. **Replace all placeholders:** Never submit a template with `<placeholders>` still in it

### Verify Creation

After creating the issue, verify it appears under the correct milestone:

```bash
gh issue view <NUMBER> --repo $GH_REPO --json number,title,milestone,labels
```

Check the milestone URL: `https://github.com/jindrichruzicka/Chimera/milestone/<MILESTONE_NUMBER>`

---

## Troubleshooting

### Milestone assignment fails

If `--milestone` fails due to title mismatch, assign via API after creation:

```bash
ISSUE=<number>
gh api repos/$GH_REPO/issues/$ISSUE --method PATCH --field milestone=$M1_ID
```

### Label doesn't exist

Create the label first using the [create-labels skill](./create-labels/SKILL.md):

```bash
gh label create "milestone:M1" --color "6b3ea1" --description "Core Engine (M1)" --repo $GH_REPO
```
