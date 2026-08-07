---
name: commit-and-push
description: 'Commit + push on a Chimera feature/fix/refactor branch: first branch commit uses the supplied conventional message; later commits become fixup! to it automatically. Use when: any commit + push on a topic branch.'
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

Subsequent commits (message args ignored — the `fixup!` subject is derived automatically):

```bash
bash .claude/skills/git/commit-and-push/scripts/commit-and-push.sh
```

Steps: validate branch prefix → validate index non-empty → `git fetch origin main` for an accurate ahead count → 0 ahead ⇒ normal commit, ≥1 ⇒ `--fixup <oldest-branch-sha>` → push (sets upstream on first push).

Recovery: push fails (remote diverged) → resolve, re-run — the commit is local, so the re-run skips the commit step. Land the branch with the merge skill.

## First Commit Format

Required by the merge skill:

```
feat(module): concise description

- Tests written first (red); implementation added to turn green.
- Root cause / motivation.
- All tests pass.
```

## The body is reviewed prose

- Write claims that survive re-measurement, from the FINAL tree only. Scope sweep results ("0 under <classes>", never a bare 0); state gate results as measured at this tree.
- A `fixup!` can never amend the first commit's message. A false sentence there converges only by `git reset --soft <merge-base>` + re-commit + force-push — so keep the body free of coverage claims, magnitudes, and mechanisms you have not measured.
