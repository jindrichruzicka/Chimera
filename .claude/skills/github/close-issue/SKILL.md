---
name: close-issue
description: 'Close a GitHub issue after its branch merged to main (merge script exited 0), citing the merge commit. Use when: closing a task or bug issue post-merge.'
argument-hint: 'Issue number (e.g. 42)'
---

# Close Issue Skill

## Preconditions

Only close after:

1. `bash .claude/skills/git/merge/scripts/check-and-merge.sh` exited 0.
2. Push to `origin/main` confirmed.
3. Branch deleted (merge skill does this).

Do NOT close if merge reported problems, branch still open, or push to main failed.

## Run

```bash
export GH_REPO=jindrichruzicka/Chimera
gh issue close <NUMBER> --repo $GH_REPO
gh issue view <NUMBER> --repo $GH_REPO --json number,title,state
# state should be "CLOSED"
```

## Task vs Feature Issues

- **Task issue** (`Part of #<feature>` in body, label `task`) → close after its branch merges.
- **Parent feature issue** (label `feature`) → do **NOT** close here; closed by the review task after all child tasks complete.

Order: close all tasks → review task closes feature.

## Recovery

```bash
gh issue reopen <NUMBER> --repo $GH_REPO   # if closed wrong issue
```
