---
description: 'Implement a GitHub issue end-to-end: branch, TDD cycle, and merge. Usage: /implement-issue-merge <issue-number>'
argument-hint: '<issue-number>'
---

Given issue number `{{issue-number}}`:

## Step 1 — Load the issue

```bash
gh issue view {{issue-number}} --repo jindrichruzicka/Chimera --json number,title,body,labels,state,milestone
```

Read the full issue body, acceptance criteria, and invariants before proceeding.

## Step 2 — Create the branch

Load and follow `.github/skills/git/create-branch/SKILL.md`.

Run the script:

```bash
bash .github/skills/git/create-branch/scripts/create-branch.sh {{issue-number}}
```

## Step 3 — Implement using TDD

Load and follow `.github/skills/tdd/SKILL.md`.

Work through the full red → green → refactor cycle:

1. Write failing tests first — confirm red with `pnpm test:watch`
2. Implement minimum code to make tests green
3. Refactor under green

## Step 4 — Merge

Once all acceptance criteria are met and the full gate passes (`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`), load and follow `.github/skills/git/merge/SKILL.md`.

Run the merge script:

```bash
bash .github/skills/git/merge/scripts/check-and-merge.sh
```

After a successful merge, close the issue:

```bash
gh issue close {{issue-number}} --repo jindrichruzicka/Chimera --comment "Implemented and merged."
```
