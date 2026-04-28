---
name: github
description: 'GitHub project management meta-skill for the Chimera engine. Delegates to focused sub-skills for milestones, labels, issues, bootstrapping, and releases. Use when: managing GitHub project state, creating issues, bootstrapping milestones, closing issues after merge, cutting a versioned release.'
argument-hint: "Operation type (e.g. 'create-milestone', 'create-issue', 'bootstrap-milestone', 'close-issue', 'list-issues', 'create-release')"
user-invocable: true
---

# GitHub Meta-Skill — Chimera Project Management

This is a **meta-skill** that delegates to focused sub-skills. Each sub-skill handles one specific GitHub operation.

## Repository

`https://github.com/jindrichruzicka/Chimera`

All sub-skills target this repo. Set once per session:

```bash
export GH_REPO=jindrichruzicka/Chimera
```

---

## Sub-Skills

### 🎯 Create Milestone

Creates a GitHub milestone with title, description, and due date.

**Use when:** Setting up M1/M2/M3 milestones, creating release timelines

**Load:** `.github/skills/github/create-milestone/SKILL.md`

---

### 🏷️ Create Labels

Creates or updates GitHub labels (milestone, type, module labels).

**Use when:** Setting up labels for a new milestone, ensuring labels exist before creating issues

**Load:** `.github/skills/github/create-labels/SKILL.md`

---

### 📝 Create Issue

Creates feature, task, or bug issues with proper labels, milestone assignment, and templates.

**Use when:** Creating new issues from architecture, decomposing features into tasks, reporting bugs

**Load:** `.github/skills/github/create-issue/SKILL.md`

---

### 🚀 Bootstrap Milestone

Bootstraps a complete milestone: creates milestone, labels, feature issues, and task issues in dependency order.

**Use when:** Setting up M1/M2/M3 from scratch, creating full issue backlog for a release

**Load:** `.github/skills/github/bootstrap-milestone/SKILL.md`

---

### ✅ Close Issue

Closes a GitHub issue after the corresponding branch has been merged to main.

**Use when:** Completing a task issue, closing a bug fix after merge

**Load:** `.github/skills/github/close-issue/SKILL.md`

---

### 🔍 List Issues

Lists and queries GitHub issues with filters (milestone, label, state, search).

**Use when:** Checking what issues exist, finding open tasks, reviewing milestone progress

**Load:** `.github/skills/github/list-issues/SKILL.md`

---

### 🚢 Create Release

Cuts a versioned release from a completed milestone: verifies all issues are closed, determines the SemVer version, updates README and CHANGELOG, bumps `package.json`, runs the full pre-release gate, commits, tags, pushes, creates the GitHub release, and closes the milestone.

**Use when:** Shipping a milestone, cutting a release tag, publishing a new version to GitHub Releases

**Load:** `.github/skills/github/create-release/SKILL.md`

---

## Workflow Examples

### Bootstrap M1 from scratch

```bash
# 1. Load the bootstrap skill
load .github/skills/github/bootstrap-milestone/SKILL.md

# 2. Follow the procedure:
#    - Read architecture §12.1
#    - Check existing state
#    - Present decomposition to user
#    - Create milestone, labels, features, tasks
#    - Verify and report summary
```

### Create a single task issue

```bash
# 1. Load the create-issue skill
load .github/skills/github/create-issue/SKILL.md

# 2. Follow the procedure:
#    - Resolve milestone number
#    - Prepare issue body from template
#    - Create issue with labels and milestone
#    - Verify creation
```

### Close an issue after merge

```bash
# 1. Verify merge script exited 0
bash .github/skills/git/merge/scripts/check-and-merge.sh

# 2. Load the close-issue skill
load .github/skills/github/close-issue/SKILL.md

# 3. Close the issue
gh issue close <NUMBER> --repo $GH_REPO
```

---

## Notes

- **Always use sub-skills** — they contain the complete, validated procedures
- **Sub-skills are independent** — each can be loaded and used separately
- **Templates are in `./assets/`** — feature-template.md, task-template.md
- **Label catalogue is in `./references/labels.md`** — standard colours and descriptions
- **Milestone number ≠ label** — always resolve the numeric ID before creating issues

```bash
gh issue close <ISSUE_NUMBER> --repo $GH_REPO --comment "Implemented in $(git rev-parse --short HEAD) on main."
```

**Parent-feature-issue exception:** If this task belongs to a feature issue (i.e. it is a child task of a parent `feature`-labelled issue), do **not** close the parent here. The parent is closed only by the review task ("Review all F<NN> changes and merge to main") after all child tasks are merged.

---

## Procedure: Create a GitHub Release

Use the dedicated **create-release sub-skill** — it supersedes this inline procedure.

```
Load and follow: .github/skills/github/create-release/SKILL.md
```

Or invoke via prompt:

```
/create-release <milestone-designator>
```

The sub-skill covers: milestone validation, open-issue check, SemVer determination (with user confirmation), README review and update, CHANGELOG promotion, `package.json` bump, full pre-release gate, release commit, annotated tag, GitHub release creation, and milestone closure.

---

## Error Handling

| Error                                     | Cause                             | Resolution                                                                  |
| ----------------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `gh: command not found`                   | gh CLI not installed              | `brew install gh && gh auth login`                                          |
| `422 Unprocessable Entity` (milestone)    | Milestone already exists          | Skip creation, use existing                                                 |
| `422 Unprocessable Entity` (label)        | Label already exists              | Add `\|\| true` or use `--force`                                            |
| `Resource not accessible by integration`  | Token lacks `issues` scope        | Re-auth: `gh auth refresh -s issues`                                        |
| Milestone not found on issue create       | Milestone title mismatch          | Use exact title from `gh api .../milestones`; prefer API PATCH as fallback  |
| Issue has label but not on milestone page | Label set; milestone not assigned | Run `gh api repos/$GH_REPO/issues/$N --method PATCH --field milestone=<ID>` |
| Tag already exists                        | Re-releasing same version         | Ask user whether to re-release or abort                                     |
| `gh release create` fails                 | Token lacks contents scope        | `gh auth refresh -s write:packages,contents`                                |
