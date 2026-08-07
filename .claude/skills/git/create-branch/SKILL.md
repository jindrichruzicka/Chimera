---
name: create-branch
description: 'Create a correctly-named local feature/fix branch from a GitHub issue (validates the issue is an open task or bug, pulls latest main first). Use when: starting work on a task or bug issue.'
argument-hint: 'GitHub issue number (e.g. 42)'
---

# Create Branch Skill

## Run

```bash
bash .claude/skills/git/create-branch/scripts/create-branch.sh <issue-number>
```

## What the Script Does

1. **Resolve issue**:

    ```bash
    gh issue view <N> --repo jindrichruzicka/Chimera --json number,title,labels,state,milestone
    ```

    Validate (abort + report on any failure): command exits 0; `state == "OPEN"`; labels contain `task` or `bug`, not `feature`-only; not a milestone-stub (`milestone:*` without `task`/`bug`).

2. **Derive branch name** `<prefix>/<slug>` — `task` → `feature`, `bug` → `fix`. Slug: strip `(§X.Y)` suffix → lowercase → replace non-`[a-z0-9-]` with `-` → collapse `-` → trim → max 50 chars → append `-<NUMBER>`. Example: #2 "Implement `BrowserWindow` creation and app lifecycle" → `feature/implement-browserwindow-creation-and-app-lifecycle-2`.

3. **Check existing branch** — if exists, ask whether to checkout instead of creating:

    ```bash
    git branch --list "<branch-name>"
    git ls-remote --heads origin "<branch-name>"
    ```

4. **Update main** — abort if diverged; never force-reset:

    ```bash
    git checkout main && git pull --ff-only origin main
    ```

5. **Create branch**:

    ```bash
    git checkout -b "<branch-name>"
    git rev-parse --abbrev-ref HEAD
    ```

6. **Report**: issue, branch, base SHA, next-steps reminder (commit body, fixup, merge skill).

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
