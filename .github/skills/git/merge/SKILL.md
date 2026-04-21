---
name: merge
description: "Merge a feature/fix/refactor branch into main following Chimera's branch standards. Use when ready to land a branch: validates branch name, checks for downmerged main commits, verifies commit structure (first commit has body, subsequent commits are fixup!), rebases with autosquash onto main, resolves conflicts, then fast-forward merges. If any check fails, reports all problems and does NOT merge. Use for: merging feature branches, fix branches, refactor branches, landing completed work."
argument-hint: "branch name (defaults to current branch) — optionally add --dry-run"
---

# Merge Skill

Validates the current branch against the Chimera standard, rebases it cleanly onto `main` using autosquash, and fast-forward merges. **Aborts and reports every problem found without touching `main` if any check fails.**

## When to Use

- You have completed work on a `feature/*`, `fix/*`, or `refactor/*` branch
- You want to verify the branch is clean before landing it
- You want to rebase + squash fixup commits and merge in one step

---

## Procedure

### Step 1 — Pre-flight checks (all must pass)

Run [check-and-merge.sh](./scripts/check-and-merge.sh) which performs the following checks automatically. If running manually, verify each item:

1. **Current branch is not `main`** — must be checked out on a topic branch.
2. **Working tree is clean** — no uncommitted changes or staged files.
3. **Branch name follows convention** — must match `feature/<name>`, `fix/<name>`, or `refactor/<name>` (lowercase kebab-case only).
4. **No downmerged main commits** — the branch must not contain merge commits that brought `main` back into it. Rebase, never merge-down.
5. **First commit has a body** — the oldest commit on the branch (relative to `main`) must have a non-empty commit body describing what was done and why.
6. **All subsequent commits are `fixup!` commits** — every commit after the first must start with `fixup!` in the subject line.

If **any** check fails: print all problems, exit non-zero, and **do not touch `main`**.

### Step 2 — Fetch and rebase

```bash
git fetch origin main
GIT_SEQUENCE_EDITOR=true git rebase --interactive --autosquash origin/main
```

`autosquash` collapses all `fixup!` commits into their targets non-interactively. The branch history is reduced to the single canonical commit per task (or explicitly authored commits for multi-commit features).

If the rebase surfaces **conflicts**:
1. Open each conflicted file, resolve by preferring the branch's intent while preserving the invariants from `docs/architecture-overview.md`.
2. Stage resolved files: `git add <file>`
3. Continue: `git rebase --continue`
4. If a conflict cannot be resolved safely, run `git rebase --abort`, report the conflict in detail, and stop — do not merge.

### Step 3 — Fast-forward merge

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```

`--ff-only` ensures no accidental merge commits land on `main`. The branch must be strictly ahead of `main` after the rebase; if it is not, abort and report.

### Step 4 — Post-merge cleanup

After a successful push, the script automatically deletes both the local and remote branch:

```bash
git branch -d <branch>
git push origin --delete <branch>
```

If the remote branch does not exist (e.g. was never pushed), the remote delete is skipped with a warning.

---

## Running the Script Directly

```bash
# Full merge (checks + rebase + merge to main + push)
bash .github/skills/git/merge/scripts/check-and-merge.sh

# Dry run (checks + rebase only, no merge to main)
bash .github/skills/git/merge/scripts/check-and-merge.sh --dry-run
```

---

## Problem Report Format

When checks fail, emit a numbered list for every problem found before exiting:

```
[error] Found N problem(s) — merge aborted:

  1. Branch name 'my-branch' does not follow the required pattern: feature/<name>, fix/<name>, or refactor/<name>.
  2. First commit (a1b2c3d4) has no body.
  3. The following commits after the first are not fixup! commits:
       e5f6a7b8: add more stuff
       c9d0e1f2: WIP
```

Never merge partially. All problems must be resolved before re-running.

---

## Invariants to Verify Before Merging

Even if all structural checks pass, scan the diff for architecture violations before completing the merge:

- No imports from forbidden module boundaries (see §3 module boundary table in `docs/architecture-overview.md`)
- No `any` or `@ts-ignore` introduced
- No float fields added to `GameSnapshot`
- No `Math.random()` or `Date.now()` inside `simulation/`
- `AssetManager` or any `renderer/assets/` file does not import from `games/*`
