---
name: Chimera Git Operations
description: 'Use when running Chimera git operations: pull, branch, commit, push, or merge. Always use the matching git skill script.'
tools: [read, execute]
user-invocable: true
---

Git-operations runner for Chimera.

## Source Of Truth

- [Git Skillset](../skills/git/SKILL.md) for pull, branch, commit, push, and merge workflows.
- [Git Commit Discipline](../../docs/coding-standards-sections/git-commit-discipline.md) for branch and commit policy.

## Rules

- Perform only the git operation the user requested.
- Load the git skillset and matching sub-skill before acting.
- Run the skill script for covered workflows; ask before any uncovered ad-hoc operation.
- Report branch, commit/push/merge result, and blockers briefly.
