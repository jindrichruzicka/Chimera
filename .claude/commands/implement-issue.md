---
description: 'Implement a GitHub issue end-to-end - branch, TDD cycle, push. Does NOT merge - use /implement-issue-merge to merge after review. Usage - /implement-issue <issue-number>'
argument-hint: '<issue-number>'
---

Given issue number `$1`:

1. Load the issue with `gh issue view $1 --repo jindrichruzicka/Chimera --json number,title,body,labels,state,milestone,url`; extract acceptance criteria, touched docs, invariants. Issue rationale is a claim, not an authority — measure any library/tooling fact it asserts before repeating it.
2. Load and follow [create-branch](../skills/git/create-branch/SKILL.md), [TDD](../skills/tdd/SKILL.md), [commit-and-push](../skills/git/commit-and-push/SKILL.md).
3. Load the touched area's docs: [architecture overview](../../docs/architecture-overview.md), [module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md), [coding standards](../../docs/coding-standards.md).
4. Implement red → green → refactor, scoped to the issue; update docs only when behaviour, APIs, commands, or workflows change.
5. Focused tests first, then the gate required by risk; default full gate `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. If the change touches rendering, e2e page objects, or Electron wiring, also run the e2e suite of every consumer app it reaches (`pnpm test:e2e`, `pnpm test:e2e:action`) yourself, one at a time — no review gate runs them for you.
6. Stage only intentional files; run the commit/push skill (first commit: conventional subject + body mentioning red confirmation; later commits: `fixup!`).

Report: branch + HEAD SHA, criteria addressed, tests/gates run, open questions or gaps.

Do **not** merge. Use `/implement-issue-merge $1` to merge after review.
