---
name: merge
description: "Merge a feature/fix/refactor branch into main following Chimera's branch standards. Use when ready to land a branch: validates branch name, checks for downmerged main commits, verifies commit structure (first commit has body, subsequent commits are fixup!), rebases with autosquash onto main, resolves conflicts, then fast-forward merges. If any check fails, reports all problems and does NOT merge. Use for: merging feature branches, fix branches, refactor branches, landing completed work."
argument-hint: 'branch name (defaults to current branch) — optionally add --dry-run'
---

# Merge Skill

Validates branch, rebases onto `main` with autosquash, fast-forward merges. Aborts and reports all problems on any check failure — never touches `main`.

## Run

```bash
bash .claude/skills/git/merge/scripts/check-and-merge.sh
bash .claude/skills/git/merge/scripts/check-and-merge.sh --dry-run  # checks + rebase only
```

## Step 1 — Pre-flight (all must pass)

1. Current branch ≠ `main`.
2. Working tree clean.
3. Branch name matches `feature/<name>`/`fix/<name>`/`refactor/<name>` (lowercase kebab-case).
4. No downmerged main commits (no merge commits bringing main back).
5. First commit (oldest vs `main`) has non-empty body.
6. All later commits start with `fixup!`.
7. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm verify:packaged-bundle` all exit 0.

Any failure → print all problems, exit non-zero, do not touch `main`.

## Step 2 — Rebase

```bash
git fetch origin main
GIT_SEQUENCE_EDITOR=true git rebase --interactive --autosquash origin/main
```

Autosquash collapses `fixup!`s non-interactively.

**Conflicts**:

1. Resolve preferring branch intent + [Architecture Invariants](../../../../docs/executive-architecture/architecture-invariants.md).
2. `git add <file>` → `git rebase --continue`.
3. If unsafe: `git rebase --abort`, report, stop.

## Step 3 — Fast-forward merge

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```

`--ff-only` blocks accidental merge commits. If branch is not strictly ahead post-rebase, abort.

## Step 4 — Cleanup

Auto on success: `git branch -d <branch>` + `git push origin --delete <branch>` (skipped with warning if remote absent).

## Problem Report

```
[error] Found N problem(s) — merge aborted:

  1. Branch name 'my-branch' does not follow: feature/<n>, fix/<n>, refactor/<n>.
  2. First commit (a1b2c3d4) has no body.
  3. Non-fixup commits after the first:
       e5f6a7b8: add more stuff
       c9d0e1f2: WIP
```

Never merge partially. All problems must be resolved before re-running.

## Architecture Checks (manual scan)

Even if structural checks pass, scan diff for:

- Forbidden module imports (arch §3 boundary table)
- New `any`/`@ts-ignore`
- Float fields added to `GameSnapshot`
- `Math.random()`/`Date.now()` in `simulation/`
- `AssetManager`/`renderer/assets/` importing `games/*`
