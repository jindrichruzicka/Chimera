---
name: pull-latest
description: 'Sync local main with origin via fast-forward-only pull. Use when: before creating a branch, before merging, or whenever local main may be behind.'
---

# Pull Latest Skill

## Run

```bash
bash .claude/skills/git/pull-latest/scripts/pull-latest.sh
```

`--verbose` available.

## What the Script Does

1. **Pre-check**: working tree clean (else abort); record current branch.
2. `git fetch origin`.
3. `git checkout main` (abort on error).
4. `git pull --ff-only origin main` — fails if local diverged. Never force-resets.
5. Print summary (latest commit; ahead-of-origin count).
6. Optional: return to previous branch.

## Errors

| Situation                         | Action                                              |
| --------------------------------- | --------------------------------------------------- |
| Working tree dirty                | Abort: commit/stash first                           |
| `checkout main` fails             | Abort with error                                    |
| `pull --ff-only` fails (diverged) | Abort: push or rebase first                         |
| Network error on fetch            | Abort: check network                                |
| No `origin` remote                | Abort: configure with `git remote add origin <url>` |

Used by create-branch (before creating a branch) and merge (before rebasing onto main); can run standalone.
