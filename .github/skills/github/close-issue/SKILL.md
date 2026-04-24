---
name: close-issue
description: 'Close a GitHub issue after the corresponding branch has been merged to main. Validates that the merge script exited successfully, then closes the issue with the merge commit reference. Use when: completing a task issue, closing a bug fix, marking an issue as resolved after merge.'
argument-hint: 'Issue number (e.g. 42)'
---

# Close Issue Skill

Closes a GitHub issue after the corresponding branch has been successfully merged to `main`.

## When to Use

- After completing a task issue and merging the branch
- After fixing a bug and landing the fix
- Marking an issue as resolved after `check-and-merge.sh` exits 0

---

## Procedure

### Step 1 — Verify merge completed successfully

**Only close the issue after:**

1. The merge script (`.github/skills/git/merge/scripts/check-and-merge.sh`) exited 0
2. The push to `origin/main` was confirmed
3. The branch was deleted (by the merge script)

**Do NOT close the issue if:**

- The merge script reported problems
- The branch is still open
- The push to main failed

### Step 2 — Close the issue

```bash
export GH_REPO=jindrichruzicka/Chimera
gh issue close <NUMBER> --repo $GH_REPO
```

**Example:**

```bash
gh issue close 42 --repo jindrichruzicka/Chimera
```

### Step 3 — Verify closure

```bash
gh issue view <NUMBER> --repo $GH_REPO --json number,title,state
```

The `state` field should be `"CLOSED"`.

---

## Important Rules

### Only Close Task Issues, Not Feature Issues

If the issue you're closing is a **task** that belongs to a parent **feature** issue:

- ✅ Close the task issue (the one you just implemented)
- ❌ Do NOT close the parent feature issue

The parent feature issue is closed by the review task (e.g., "#N — Review all F<NN> changes and merge to main") after all child tasks are complete.

**How to tell:**

- Task issues have `Part of #<feature-number>` in the body
- Feature issues have task issues linked to them
- Task issues are labelled `task`; feature issues are labelled `feature`

### Close Issues in Order

If multiple issues were created for a single branch:

1. Close all task issues first
2. Close the feature issue only after all tasks are done
3. The review task closes the feature issue

---

## Example Workflow

```bash
# After merge script exits 0:
bash .github/skills/git/merge/scripts/check-and-merge.sh
# → exits 0, branch merged to main

# Close the task issue:
gh issue close 42 --repo jindrichruzicka/Chimera

# Verify:
gh issue view 42 --repo jindrichruzicka/Chimera --json state
# → "state": "CLOSED"
```

---

## Troubleshooting

### Issue already closed

If the issue is already closed, the command will fail. Check the state first:

```bash
gh issue view <NUMBER> --repo $GH_REPO --json state
```

### Wrong issue closed

If you accidentally close the wrong issue (e.g., a feature issue instead of a task):

```bash
gh issue reopen <NUMBER> --repo $GH_REPO
```

Then close the correct issue.
