---
name: create-branch
description: 'Create a correctly-named feature or fix branch from a GitHub issue on jindrichruzicka/Chimera. Validates the issue exists, is a task or bug (not a feature/milestone), checks out the latest main, and creates the branch locally. Use when: starting a task issue, starting a bug issue, spinning up a branch before implementing a GitHub issue.'
argument-hint: 'GitHub issue number (e.g. 42)'
---

# Create Branch Skill

Validates issue is workable (open, `task` or `bug` — not `feature`-only or milestone-stub), pulls latest `main`, creates correctly-named branch.

## Run

```bash
bash .github/skills/git/create-branch/scripts/create-branch.sh <issue-number>
```

## What the Script Does

### 1. Resolve issue

```bash
gh issue view <N> --repo jindrichruzicka/Chimera --json number,title,labels,state,milestone
```

Validate (abort + report on any failure):

| Check              | Pass condition                                     |
| ------------------ | -------------------------------------------------- |
| Exists             | command exits 0                                    |
| Open               | `state == "OPEN"`                                  |
| Workable type      | labels contain `task` or `bug`, not `feature`-only |
| Not milestone-stub | not just `milestone:*` without `task`/`bug`        |

### 2. Derive branch name `<prefix>/<slug>`

| Label  | Prefix    |
| ------ | --------- |
| `task` | `feature` |
| `bug`  | `fix`     |

Slug derivation: strip `(§X.Y)` suffix → lowercase → replace non-`[a-z0-9-]` with `-` → collapse `-` → trim → max 50 chars → append `-<NUMBER>`.

Example: #2 "Implement `BrowserWindow` creation and app lifecycle" → `feature/implement-browserwindow-creation-and-app-lifecycle-2`.

### 3. Check existing branch

```bash
git branch --list "<branch-name>"
git ls-remote --heads origin "<branch-name>"
```

If exists, ask whether to checkout instead of creating.

### 4. Update main

```bash
git checkout main && git pull --ff-only origin main
```

Abort if diverged. Never force-reset.

### 5. Create branch

```bash
git checkout -b "<branch-name>"
git rev-parse --abbrev-ref HEAD
```

### 6. Report

Issue, branch, base SHA, next-steps reminder (commit body, fixup, merge skill).

## Errors

| Situation              | Action                            |
| ---------------------- | --------------------------------- |
| Issue 404              | Abort                             |
| Closed                 | Abort: reopen first               |
| `feature`-only         | Abort: decompose into tasks first |
| No `task`/`bug` label  | Abort: add one                    |
| Branch exists locally  | Ask: checkout instead?            |
| `pull --ff-only` fails | Abort: resolve divergence         |
| Working tree dirty     | Abort: commit/stash               |
