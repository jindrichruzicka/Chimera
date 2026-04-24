---
name: pull-latest
description: 'Update local main branch with the latest changes from origin. Fetches remote updates, checks out main, and performs a fast-forward-only pull. Use when: starting a new task and wanting the latest main, before creating a new branch, before merging a branch, syncing local main with remote.'
---

# Pull Latest Skill

Updates the local `main` branch with the latest changes from `origin/main` using a safe fast-forward-only pull strategy.

## When to Use

- Starting work on a new task or issue
- Before creating a new feature/fix branch
- Before running the merge skill to land a branch
- Syncing your local `main` with the remote repository
- Ensuring you have the latest architecture changes before implementing new features

---

## Procedure

### Automated path (preferred)

Run the script to execute all steps automatically:

```bash
bash .github/skills/git/pull-latest/scripts/pull-latest.sh
```

The script performs all validation and update steps below. The manual steps that follow are reference documentation explaining what the script does.

---

### Manual steps (reference)

#### Step 1 — Check current branch and working tree

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

**Validate the following before continuing:**

| Check                 | Pass condition                                 |
| --------------------- | ---------------------------------------------- |
| Working tree is clean | No uncommitted changes or staged files         |
| Current branch noted  | Record which branch you're on for later return |

If the working tree is dirty, abort and instruct the user to commit or stash changes first. **Do not overwrite local work.**

#### Step 2 — Fetch latest from origin

```bash
git fetch origin
```

This updates the remote-tracking branches without modifying your local branches.

#### Step 3 — Checkout main

```bash
git checkout main
```

Switch to the `main` branch. If this fails (e.g., a local branch with a conflicting name exists), abort and report the error.

#### Step 4 — Pull with fast-forward-only

```bash
git pull --ff-only origin main
```

The `--ff-only` flag ensures:

- **Safe update**: Only pulls if `main` can be fast-forwarded (no commits are lost)
- **No merge commits**: If local `main` has diverged from `origin/main`, the pull fails instead of creating a merge commit
- **Clear error**: User is informed that local `main` has unpushed changes that need resolution

If `pull --ff-only` fails, abort and instruct the user to resolve the divergence manually (e.g., by pushing local changes or rebasing). **Do not force-reset or merge.**

#### Step 5 — Report update summary

```bash
git log -1 --oneline
git log origin/main..HEAD --oneline  # Should show nothing if fully up to date
```

Print a confirmation block:

```
[pull-latest] Main branch updated successfully.

  Branch:  main
  Latest:  <short-sha> <commit message>
  Ahead:   <N> commits from origin/main (if any)

Next steps:
  - Create a new branch: git checkout -b feature/<description>
  - Return to previous branch: git checkout <previous-branch>
```

#### Step 6 — Return to previous branch (optional)

If the user was on a different branch before running this skill, offer to return:

```bash
git checkout <previous-branch>
```

---

## Error Cases

| Situation                             | Action                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Working tree is dirty                 | Abort — "Working tree has uncommitted changes. Commit or stash before pulling."        |
| `git checkout main` fails             | Abort — "Cannot checkout main: <error>. Resolve conflicts first."                      |
| `git pull --ff-only` fails (diverged) | Abort — "Local main has diverged from origin/main. Push your changes or rebase first." |
| Network error during fetch            | Abort — "Cannot reach origin. Check network connection and try again."                 |
| No `origin` remote configured         | Abort — "No 'origin' remote configured. Configure with: git remote add origin <url>"   |

---

## Integration with Other Skills

This skill is automatically invoked by:

- **create-branch skill**: Before creating a new branch from a GitHub issue
- **merge skill**: Before rebasing a feature branch onto main

You can also run it standalone when you need to ensure your local `main` is up to date without creating or merging branches.

---

## Running the Script Directly

```bash
# Update local main with latest from origin
bash .github/skills/git/pull-latest/scripts/pull-latest.sh

# With verbose output
bash .github/skills/git/pull-latest/scripts/pull-latest.sh --verbose
```
