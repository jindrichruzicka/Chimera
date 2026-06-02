---
name: commit-and-push
description: 'Smart commit + push for the Chimera feature-branch workflow. Checks if on a feature/fix/refactor branch, then: if the branch already has commits ahead of main → creates a fixup! commit targeting the first branch commit and pushes; if no prior commits exist → creates a normal first commit using the supplied message and pushes. Use when: saving progress on a feature branch, adding incremental changes to an in-progress branch, performing any commit + push on a topic branch.'
argument-hint: 'git commit message flags for first commit (e.g. -m "feat(x): subject" -m "Body.")'
---

# Commit and Push Skill

Auto-detects first vs fixup commit. First commit needs conventional message + body; subsequent commits are `fixup!` to the first.

## Behaviour

| Situation                               | Action                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| Not on `feature/*`/`fix/*`/`refactor/*` | Abort, exit non-zero                                          |
| Nothing staged                          | Abort, exit non-zero                                          |
| Branch has 0 commits ahead of `main`    | `git commit <args>` → `git push origin <branch>`              |
| Branch has ≥1 commits ahead of `main`   | `git commit --fixup <first-sha>` → `git push origin <branch>` |

## Run

First commit (message required):

```bash
bash .claude/skills/git/commit-and-push/scripts/commit-and-push.sh \
    -m "feat(module): concise subject" \
    -m "Body: what was done and why; tests written first."
```

Subsequent commits (no message needed):

```bash
bash .claude/skills/git/commit-and-push/scripts/commit-and-push.sh
```

## Steps

1. Validate branch prefix.
2. Validate index non-empty.
3. `git fetch origin main` for accurate ahead count.
4. Count commits ahead of `main`:
    - 0 → run `git commit` with provided args.
    - ≥1 → find oldest branch commit (first), run `git commit --fixup <sha>`.
5. `git push origin <branch>` (sets upstream on first push).

## First Commit Format

Required by merge skill:

```
feat(module): concise description

- Tests written first (red); implementation added to turn green.
- Root cause / motivation.
- All tests pass.
```

## Notes

- Message args ignored for fixup commits (subject derived automatically).
- `git fetch origin main` runs first to avoid stale counts.
- Push fails (remote diverged): resolve, re-run; commit is local — re-run skips commit step.
- Use merge skill to land branch.
