---
name: git
description: 'Use when branching, committing, pushing, or merging. How: run the relevant sub-skill script (create-branch, commit-and-push, merge, pull-latest).'
---

# Git Skillset

| Sub-skill       | When                                        | Script                                                               |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| pull-latest     | Sync local `main` with `origin`             | `bash .claude/skills/git/pull-latest/scripts/pull-latest.sh`         |
| create-branch   | Branch from GitHub issue                    | `bash .claude/skills/git/create-branch/scripts/create-branch.sh <N>` |
| commit-and-push | Commit + push (auto-detects first vs fixup) | `bash .claude/skills/git/commit-and-push/scripts/commit-and-push.sh` |
| merge           | Validate + land branch onto `main`          | `bash .claude/skills/git/merge/scripts/check-and-merge.sh`           |

Docs: [pull-latest](./pull-latest/SKILL.md) · [create-branch](./create-branch/SKILL.md) · [commit-and-push](./commit-and-push/SKILL.md) · [merge](./merge/SKILL.md).

For git operations not covered, ask the user before proceeding ad-hoc.
