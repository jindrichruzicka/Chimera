---
name: commit-and-push
description: 'Smart commit + push for the Chimera feature-branch workflow. Checks if on a feature/fix/refactor branch, then: if the branch already has commits ahead of main → creates a fixup! commit targeting the first branch commit and pushes; if no prior commits exist → creates a normal first commit using the supplied message and pushes. Use when: saving progress on a feature branch, adding incremental changes to an in-progress branch, performing any commit + push on a topic branch.'
argument-hint: 'git commit message flags for first commit (e.g. -m "feat(x): subject" -m "Body.")'
---

# Commit and Push Skill

Smart commit + push that enforces the Chimera [git workflow](../SKILL.md): the first commit on a branch must carry a conventional commit message with a body, and every subsequent commit must be a `fixup!` targeting that first commit.

## When to Use

- You have staged changes and want to commit + push on a feature/fix/refactor branch
- You want the script to automatically decide whether to create a first commit or a fixup commit
- You are partway through a task and want to push progress without manually looking up the first commit SHA

---

## Behaviour

| Situation                                          | Action                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Not on a `feature/*`, `fix/*`, `refactor/*` branch | **Abort** — print error, exit non-zero                                  |
| Nothing staged in the index                        | **Abort** — print error, exit non-zero                                  |
| Branch has **no commits** ahead of `main`          | `git commit <your message args>` then `git push origin <branch>`        |
| Branch has **one or more commits** ahead of `main` | `git commit --fixup <first-commit-sha>` then `git push origin <branch>` |

---

## Procedure

### Automated path (preferred)

```bash
# First commit on the branch (message is required):
bash .github/skills/git/commit-and-push/scripts/commit-and-push.sh \
    -m "feat(module): concise subject" \
    -m "Body: what was done and why, including tests written first."

# All subsequent commits (fixup is created automatically, no message needed):
bash .github/skills/git/commit-and-push/scripts/commit-and-push.sh
```

### What the script does

1. **Validates the branch** — aborts if the current branch is not `feature/*`, `fix/*`, or `refactor/*`.
2. **Validates staged changes** — aborts if the git index is empty.
3. **Fetches `origin/main`** — ensures the ahead-of-main commit count is accurate.
4. **Counts commits ahead of `main`**:
    - **Zero** → runs `git commit` with the provided message flags, then pushes.
    - **One or more** → finds the oldest commit on the branch (the first commit), runs `git commit --fixup <first-sha>`, then pushes.
5. **Pushes** — `git push origin <branch>` (sets upstream automatically on first push).

---

## First Commit Message Requirements

The first commit **must** follow the conventional-commit format with a body (required by the [merge skill](../merge/SKILL.md)):

```
feat(module): concise description of what was changed

- Tests written first (red); implementation added to turn them green.
- Describe the root cause / motivation for the change.
- All tests pass.
```

Pass the subject and body as separate `-m` flags:

```bash
bash .github/skills/git/commit-and-push/scripts/commit-and-push.sh \
    -m "feat(simulation): add ActionPipeline stage decomposition" \
    -m "- Tests written first; each stage method tested independently.
- Root cause: monolithic process() was untestable at the stage level.
- All tests pass; 100% branch coverage on new methods."
```

---

## Notes

- Message arguments are **silently ignored** for fixup commits — the fixup subject is derived from the first commit automatically.
- The script calls `git fetch origin main` before counting commits to avoid stale counts.
- If `git push` fails (e.g. remote has diverged), resolve the issue and re-run. The commit is already local; re-running will skip the commit step and only push.
- After all work is complete, use the [merge skill](../merge/SKILL.md) to land the branch onto `main`.
