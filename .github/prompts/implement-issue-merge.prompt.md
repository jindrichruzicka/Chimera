---
description: 'Implement a GitHub issue end-to-end: branch, TDD cycle, and merge. Usage: /implement-issue-merge <issue-number>'
argument-hint: '<issue-number>'
---

Given issue number `{{issue-number}}`:

1. Load the issue with `gh issue view {{issue-number}} --repo jindrichruzicka/Chimera --json number,title,body,labels,state,milestone,url`; extract acceptance criteria, docs, and invariants.
2. Load and follow [create-branch](../skills/git/create-branch/SKILL.md), [TDD](../skills/tdd/SKILL.md), [commit-and-push](../skills/git/commit-and-push/SKILL.md), [merge](../skills/git/merge/SKILL.md), and [close-issue](../skills/github/close-issue/SKILL.md).
3. Load the source docs for the touched area from [architecture overview](../../docs/architecture-overview.md), [module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md), and [coding standards](../../docs/coding-standards.md).
4. Implement red -> green -> refactor, keep scope tight, and run focused tests plus the full merge gate (`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm verify:packaged-bundle`).
5. Commit/push with the git skill, merge with the merge skill, then close only the implemented task/bug issue after the merge succeeds.

Report branch, merge commit, closed issue, criteria covered, and gates run.
