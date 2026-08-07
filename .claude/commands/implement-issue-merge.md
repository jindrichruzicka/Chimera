---
description: 'Implement a GitHub issue end-to-end - branch, TDD cycle, code-review loop, and merge. Usage - /implement-issue-merge <issue-number>'
argument-hint: '<issue-number>'
---

Given issue number `$1`:

1. Load the issue with `gh issue view $1 --repo jindrichruzicka/Chimera --json number,title,body,labels,state,milestone,url`; extract acceptance criteria, docs, invariants. Issue rationale is a claim, not an authority — measure any library/tooling fact it asserts before repeating it.
2. Load and follow [create-branch](../skills/git/create-branch/SKILL.md), [TDD](../skills/tdd/SKILL.md), [commit-and-push](../skills/git/commit-and-push/SKILL.md), [merge](../skills/git/merge/SKILL.md), and [close-issue](../skills/github/close-issue/SKILL.md).
3. Load the touched area's docs: [architecture overview](../../docs/architecture-overview.md), [module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md), [coding standards](../../docs/coding-standards.md).
4. Implement red → green → refactor, keep scope tight, run focused tests plus the full merge gate (`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm verify:packaged-bundle`). If the change touches rendering, e2e page objects, or Electron wiring, also run `pnpm test:e2e` every round — no review gate runs it for you.
5. Commit/push with the git skill.
6. **Review loop — repeat until merge-ready:**
    1. Run the **chimera-code-reviewer** subagent against the current branch; capture its findings report.
    2. Verify each finding against diff and tree. Valid → fix via red → green → refactor; invalid → record a one-line rationale instead of changing code.
        - Prose findings converge by **deletion** or a bare pointer — never by swapping a false absolute for a narrower one; a reworded qualifier is next round's BLOCK.
        - Mutation findings converge by adding the test that kills the exact mutant, then re-running that mutant to confirm the kill.
        - A false sentence in the FIRST commit's message cannot be fixed by a fixup: `git reset --soft <merge-base>`, re-commit with a body written from the final tree, force-push.
    3. If code changed, re-run focused tests plus the full merge gate; commit/push (subsequent commits are `fixup!`).
    4. Hand the next round a fix report: each finding → its hunk + the re-measurement proving it (the reviewer verifies both).
    5. Loop while the report has any BLOCK or `❌ CHANGES REQUIRED`; exit only on `✅ APPROVED` with zero BLOCKs.
7. Merge with the merge skill, then close only the implemented task/bug issue after the merge succeeds.

Report: branch, merge commit, closed issue, criteria covered, gates run, and review rounds with each round's finding counts.
