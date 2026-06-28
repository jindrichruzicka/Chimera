---
name: github
description: 'Use when fetching, creating, or managing GitHub milestones, issues, or releases — or publishing the @chimera-engine/* packages to npm. How: load the matching sub-skill (fetch-issue, list-issues, create-issue, create-milestone, bootstrap-milestone, close-issue, create-release, publish-packages).'
argument-hint: "Operation type (e.g. 'fetch-issue', 'create-milestone', 'create-issue', 'bootstrap-milestone', 'close-issue', 'list-issues', 'create-release', 'publish-packages')"
user-invocable: true
---

# GitHub Meta-Skill

Repo: `jindrichruzicka/Chimera`. Set once per session: `export GH_REPO=jindrichruzicka/Chimera`.

## Sub-Skills

| Sub-skill           | Use when                                     | Load                           |
| ------------------- | -------------------------------------------- | ------------------------------ |
| create-milestone    | Setting up M1/M2/…                           | `create-milestone/SKILL.md`    |
| create-labels       | Ensuring labels exist before creating issues | `create-labels/SKILL.md`       |
| create-issue        | Creating feature/task/bug issues             | `create-issue/SKILL.md`        |
| fetch-issue         | Fetching one issue by number or URL          | `fetch-issue/SKILL.md`         |
| bootstrap-milestone | Setting up full milestone from scratch       | `bootstrap-milestone/SKILL.md` |
| close-issue         | Closing a task issue after merge             | `close-issue/SKILL.md`         |
| list-issues         | Querying issues                              | `list-issues/SKILL.md`         |
| create-release      | Cutting a versioned release                  | `create-release/SKILL.md`      |
| publish-packages    | Publishing @chimera-engine/\* to npm         | `publish-packages/SKILL.md`    |

Templates: `assets/feature-template.md`, `assets/task-template.md`, `assets/release-template.md`. Labels: `references/labels.md`.

---

## Notes

- **Always use sub-skills** — they contain the validated procedures.
- **Sub-skills are independent**.
- **Milestone number ≠ label** — resolve numeric ID before creating issues.

### Closing an issue (quick path)

```bash
gh issue close <N> --repo $GH_REPO --comment "Implemented in $(git rev-parse --short HEAD) on main."
```

**Parent-feature exception**: if the task belongs to a parent `feature` issue, do NOT close the parent — only the review task closes it.

---

## Errors

| Error                                     | Cause                  | Fix                                                                     |
| ----------------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `gh: command not found`                   | Not installed          | `brew install gh && gh auth login`                                      |
| `422` (milestone)                         | Already exists         | Skip, use existing                                                      |
| `422` (label)                             | Already exists         | `\|\| true` or `--force`                                                |
| `Resource not accessible`                 | Token scope            | `gh auth refresh -s issues`                                             |
| Milestone not found on create             | Title mismatch         | Use exact title or PATCH with numeric ID                                |
| Issue label set but not on milestone page | Milestone not assigned | `gh api repos/$GH_REPO/issues/$N --method PATCH --field milestone=<ID>` |
| Tag exists                                | Re-releasing           | Ask user                                                                |
| `gh release create` fails                 | Token scope            | `gh auth refresh -s write:packages,contents`                            |
