---
name: create-branch
description: 'Create a correctly-named feature or fix branch from a GitHub issue on jindrichruzicka/Chimera. Validates the issue exists, is a task or bug (not a feature/milestone), checks out the latest main, and creates the branch locally. Use when: starting work on a task issue, starting work on a bug issue, spinning up a branch before implementing a GitHub issue.'
argument-hint: 'GitHub issue number (e.g. 42)'
---

# Create Branch Skill

Given a GitHub issue number, validates the issue is workable (exists, is a `task` or `bug`, not a `feature` or milestone-only issue), pulls the latest `main`, and creates a correctly-named branch ready for implementation.

## When to Use

- You are about to start implementing a task or bug issue
- You want to ensure the branch name follows the merge skill's naming convention before writing any code

---

## Procedure

### Automated path (preferred)

Run the script to execute all steps automatically:

```bash
bash .github/skills/git/create-branch/scripts/create-branch.sh <issue-number>
```

The script performs all validation and branch creation steps below. The manual steps that follow are reference documentation explaining what the script does.

---

### Manual steps (reference)

#### Step 1 — Resolve the issue

```bash
export GH_REPO=jindrichruzicka/Chimera
gh issue view <NUMBER> --repo $GH_REPO --json number,title,labels,state,milestone
```

**Validate all of the following before continuing. Stop and report any failure.**

| Check                         | Pass condition                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Issue exists                  | Command exits 0; issue returned                                                                                               |
| Issue is open                 | `state == "OPEN"`                                                                                                             |
| Issue type is workable        | Labels contain `task` **or** `bug`; must NOT be labelled `feature` only                                                       |
| Issue is not a milestone stub | `milestone` field may be set (that is fine); but if the _only_ label is a `milestone:*` label with no `task`/`bug`, reject it |

If any check fails, print a clear error and **do not create a branch**.

#### Step 2 — Derive the branch name

Branch name format follows the merge skill convention: `<prefix>/<slug>`

| Issue label | Prefix    |
| ----------- | --------- |
| `task`      | `feature` |
| `bug`       | `fix`     |

Derive `<slug>` from the issue title:

1. Strip the `(§X.Y)` architecture reference suffix if present
2. Lowercase the whole string
3. Replace any character that is not `a-z`, `0-9`, or `-` with `-`
4. Collapse consecutive `-` into one
5. Strip leading/trailing `-`
6. Truncate to 50 characters max
7. Append `-<NUMBER>` (the issue number) at the end

**Example:**  
Issue #2 "Implement `BrowserWindow` creation and app lifecycle" → `feature/implement-browserwindow-creation-and-app-lifecycle-2`

#### Step 3 — Check for existing local/remote branch

```bash
git branch --list "<branch-name>"
git ls-remote --heads origin "<branch-name>"
```

If the branch already exists locally or remotely, report it and ask the user whether to check it out instead of creating a new one. **Do not overwrite an existing branch.**

#### Step 4 — Update main

```bash
git checkout main
git pull --ff-only origin main
```

If `pull --ff-only` fails (local main has diverged), abort and instruct the user to resolve the divergence manually. **Do not force-reset main.**

#### Step 5 — Create the branch

```bash
git checkout -b "<branch-name>"
```

Confirm the branch was created:

```bash
git rev-parse --abbrev-ref HEAD
```

#### Step 6 — Report

Print a confirmation block:

```
[create-branch] Branch created successfully.

  Issue:   #<NUMBER> — <title>
  Branch:  <branch-name>
  Base:    main @ <short-sha>

Next steps:
  1. Implement the changes described in issue #<NUMBER>.
  2. Commit with a descriptive body: git commit -m "subject" -m "body..."
  3. Additional commits must use fixup!: git commit --fixup HEAD
  4. When ready, use the git skillset → merge sub-skill to land the branch.
```

---

## Error Cases

| Situation                                   | Action                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Issue not found (404)                       | Abort — "Issue #N does not exist in jindrichruzicka/Chimera."                           |
| Issue is closed                             | Abort — "Issue #N is closed. Reopen it before starting work."                           |
| Issue labelled `feature` (not `task`/`bug`) | Abort — "Issue #N is a feature issue. Break it into task issues first."                 |
| Issue has no `task` or `bug` label          | Abort — "Issue #N has no workable label (task or bug). Add one before branching."       |
| Branch already exists locally               | Ask — "Branch already exists locally. Check it out instead? (y/n)"                      |
| `git pull --ff-only` fails                  | Abort — "Local main has diverged from origin. Resolve manually before branching."       |
| Working tree is dirty on main               | Abort — "Working tree is not clean. Commit or stash changes before switching branches." |
