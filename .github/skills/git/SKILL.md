---
name: git
description: 'Git operations skillset for the Chimera engine. Contains sub-skills for all git workflows: creating branches from GitHub issues, merging branches, managing history, and enforcing commit standards. Use when: starting work on a task or bug issue, merging feature/fix/refactor branches, validating branch structure, performing autosquash rebases, resolving conflicts, landing completed work on main. Delegates to the appropriate sub-skill based on the requested operation.'
---

# Git Skillset

A collection of git workflow skills for the Chimera project. Each sub-skill covers a distinct git operation with a defined procedure and set of invariants.

## Available Sub-skills

| Sub-skill         | When to use                                                                               | File                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **create-branch** | Create a correctly-named branch from a GitHub issue number before starting implementation | [git/create-branch/SKILL.md](./create-branch/SKILL.md) |
| **merge**         | Validate and land a `feature/*`, `fix/*`, or `refactor/*` branch onto `main`              | [git/merge/SKILL.md](./merge/SKILL.md)                 |

---

## Selecting the Right Sub-skill

**Starting work on a task or bug issue** → load and follow [create-branch/SKILL.md](./create-branch/SKILL.md)

**Merging a branch into main** → load and follow [merge/SKILL.md](./merge/SKILL.md)

When a new git operation is needed that no existing sub-skill covers, note the gap and ask the user before proceeding ad-hoc.
