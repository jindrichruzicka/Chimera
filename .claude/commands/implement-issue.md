---
description: 'Implement a GitHub issue end-to-end - branch, TDD cycle, push. Does NOT merge - use /implement-issue-merge to merge after review. Usage - /implement-issue <issue-number>'
argument-hint: '<issue-number>'
---

Given issue number `$1`:

## Procedure

1. Load the issue with `gh issue view $1 --repo jindrichruzicka/Chimera --json number,title,body,labels,state,milestone,url` and extract acceptance criteria, touched docs, and invariants.
2. Load and follow [create-branch](../skills/git/create-branch/SKILL.md), [TDD](../skills/tdd/SKILL.md), and [commit-and-push](../skills/git/commit-and-push/SKILL.md).
3. Load the source docs for the touched area from [architecture overview](../../docs/architecture-overview.md), [module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md), and [coding standards](../../docs/coding-standards.md).
4. Implement strictly red -> green -> refactor. Keep the change scoped to the issue and update docs only when behavior, APIs, commands, or workflows change.
5. Run the focused tests first, then the gate required by risk; default full gate is `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
6. Stage only intentional files and run the commit/push skill. If this is the first branch commit, pass a conventional `-m` subject plus body that mentions red confirmation; otherwise let the skill create a `fixup!` commit.

Report back with:

- Branch name and HEAD commit SHA
- Which acceptance criteria were addressed
- Tests/gates run
- Any open questions or known gaps

Do **not** merge. Use `/implement-issue-merge $1` to merge after review.
