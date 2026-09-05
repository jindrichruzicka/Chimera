---
name: merge
description: 'Land a feature/fix/refactor branch on main: validates branch name + commit structure, runs the full gate, rebases with autosquash, fast-forward merges; on any failed check reports all problems and does NOT merge. Use when: merging a completed branch.'
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
4. No downmerged main commits.
5. First commit (oldest vs `main`) has a non-empty body.
6. All later commits start with `fixup!`.
7. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm verify:packaged-bundle` all exit 0. Each step's output is captured to its own file under a `chimera-merge-gate-*` temp directory; a red step is reported with its label, that file's path and the file's last 60 lines, and the directory is removed when the gate is green.

Any failure → print all problems, exit non-zero, do not touch `main`.

## Step 2 — Rebase

```bash
git fetch origin main
GIT_SEQUENCE_EDITOR=true git rebase --interactive --autosquash origin/main
```

The gate runs BEFORE this rebase — if `origin/main` moved since the branch's last full gate, the rebased tree is ungated: re-run the full gate on it before merging.

**Conflicts**: resolve preferring branch intent + [Architecture Invariants](../../../../docs/executive-architecture/architecture-invariants.md); `git add <file>` → `git rebase --continue`; if unsafe, `git rebase --abort`, report, stop.

## Step 3 — Fast-forward merge

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```

`--ff-only` blocks accidental merge commits; abort if the branch is not strictly ahead post-rebase.

## Step 4 — Cleanup

Auto on success: `git branch -d <branch>` + `git push origin --delete <branch>` (skipped with warning if remote absent).

## Problem Report

```
[error] Found N problem(s) — merge aborted:

  1. Branch name 'my-branch' does not follow: feature/<n>, fix/<n>, refactor/<n>.
  2. First commit (a1b2c3d4) has no body.
  3. Non-fixup commits after the first:
       e5f6a7b8: add more stuff
```

A red gate step is reported the same way, with its own output rather than a label alone:

```
[error] Pre-merge gate failed:
  ✗ pnpm test   (full output: /var/folders/…/chimera-merge-gate-XXXXXX.149XO84xpV/pnpm_test.log)
  ── last 60 lines ──
    FAIL  |chimera| electron/main/index.test.ts > … > …
    …
```

Never merge partially; resolve all problems before re-running.

## Architecture Checks (manual scan)

Even if structural checks pass, scan the diff for: forbidden module imports (arch §3 boundary table); new `any`/`@ts-ignore`; float fields added to `GameSnapshot`; `Math.random()`/`Date.now()` in `simulation/`; `AssetManager`/`renderer/assets/` importing a game (`apps/*`, `games/*`, `@chimera-engine/<game>`).
