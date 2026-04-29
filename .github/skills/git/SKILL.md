---
name: git
description: 'Git operations skillset for the Chimera engine. Contains sub-skills for all git workflows: creating branches from GitHub issues, merging branches, managing history, and enforcing commit standards. Use when: starting work on a task or bug issue, merging feature/fix/refactor branches, validating branch structure, performing autosquash rebases, resolving conflicts, landing completed work on main. Delegates to the appropriate sub-skill based on the requested operation.'
---

# Git Skillset

| Sub-skill       | When                                        | Script                                                               |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| pull-latest     | Sync local `main` with `origin`             | `bash .github/skills/git/pull-latest/scripts/pull-latest.sh`         |
| create-branch   | Branch from GitHub issue                    | `bash .github/skills/git/create-branch/scripts/create-branch.sh <N>` |
| commit-and-push | Commit + push (auto-detects first vs fixup) | `bash .github/skills/git/commit-and-push/scripts/commit-and-push.sh` |
| merge           | Validate + land branch onto `main`          | `bash .github/skills/git/merge/scripts/check-and-merge.sh`           |

Sub-skill files: [`pull-latest/SKILL.md`](./pull-latest/SKILL.md) · [`create-branch/SKILL.md`](./create-branch/SKILL.md) · [`commit-and-push/SKILL.md`](./commit-and-push/SKILL.md) · [`merge/SKILL.md`](./merge/SKILL.md).

For new git operations not covered, ask the user before proceeding ad-hoc.
