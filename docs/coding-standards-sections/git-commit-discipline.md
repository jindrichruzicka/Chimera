---
title: 'Chimera Coding Standards — §14 Git and Commit Discipline'
description: 'Branch naming conventions, conventional commit structure (first commit + fixup!), merge policy (fast-forward only, no merge commits), and the git skillset workflow.'
tags: [git, commits, branches, merge, fixup, conventional-commits, coding-standards]
---

# §14 Git and Commit Discipline

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 14.1 Branch naming

| Work type            | Prefix      | Example                             |
| -------------------- | ----------- | ----------------------------------- |
| Feature / task issue | `feature/`  | `feature/action-pipeline-stages-12` |
| Bug fix              | `fix/`      | `fix/snapshot-tick-overflow-7`      |
| Refactor             | `refactor/` | `refactor/lobby-manager-ipc`        |

Branch names are lowercase kebab-case only. When branching from a GitHub issue, the branch slug ends with `-<issue-number>`.  
Use the **git skillset → create-branch sub-skill** to create branches from issues.

## 14.2 Commit structure

- The **first commit** on a branch must have a non-empty body describing what was done and why:

    ```
    feat(simulation): decompose ActionPipeline into stage methods

    - Tests written first (red); resolve(), parse(), intercept(),
      validate(), reduce(), record(), broadcast() stage methods
      implemented to turn each test green
    - Each stage receives only the narrow context it needs
    ```

- All subsequent commits must be `fixup!` commits targeting the first:
    ```
    git commit --fixup <first-commit-sha>
    ```
- Plain free-form commit messages beyond the first are not permitted.

## 14.3 Merge policy

- Only the **git skillset → merge sub-skill** may land branches onto `main`.
- `main` is always fast-forward only. Merge commits are forbidden.
- Never `git merge main` into a topic branch. Use `git rebase origin/main`.
