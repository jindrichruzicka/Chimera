---
description: 'Implement a GitHub issue end-to-end - branch, TDD cycle, code-review loop, and merge. Usage - /implement-issue-merge <issue-number>'
argument-hint: '<issue-number>'
---

Given issue number `$1`:

1. Load the issue with `gh issue view $1 --repo jindrichruzicka/Chimera --json number,title,body,labels,state,milestone,url`; extract acceptance criteria, docs, and invariants.
2. Load and follow [create-branch](../skills/git/create-branch/SKILL.md), [TDD](../skills/tdd/SKILL.md), [commit-and-push](../skills/git/commit-and-push/SKILL.md), [merge](../skills/git/merge/SKILL.md), and [close-issue](../skills/github/close-issue/SKILL.md).
3. Load the source docs for the touched area from [architecture overview](../../docs/architecture-overview.md), [module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md), and [coding standards](../../docs/coding-standards.md).
4. Implement red -> green -> refactor, keep scope tight, and run focused tests plus the full merge gate (`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm verify:packaged-bundle`).
5. Commit/push with the git skill.
6. **Review loop — repeat until merge-ready:**
    1. Run the **chimera-code-reviewer** subagent against the current branch and capture its findings report.
    2. Verify each reported finding against the diff and current tree. For every valid point, implement the fix via red -> green -> refactor; for any point you judge invalid, record a one-line rationale instead of changing code.
    3. If you changed code, re-run focused tests plus the full merge gate and commit/push with the git skill (subsequent commits are `fixup!`).
    4. Re-run the reviewer. Continue looping while the report has any BLOCKing finding or a `❌ CHANGES REQUIRED` verdict.
    5. Exit the loop only when the reviewer returns `✅ APPROVED` with zero BLOCKs (the branch is merge-ready).
7. Merge with the merge skill, then close only the implemented task/bug issue after the merge succeeds.

Report branch, merge commit, closed issue, criteria covered, gates run, and the number of review rounds with each round's finding counts.
