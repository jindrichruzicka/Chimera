---
name: github
description: "GitHub project management operations for the Chimera engine: create milestones, create/list/close issues, apply labels, link tasks to features, bootstrap the full roadmap from the architecture overview. Use when: creating GitHub issues, creating milestones, labelling issues, bootstrapping the roadmap, decomposing features into tasks, checking what issues exist."
argument-hint: "Describe what to create or manage (e.g. 'bootstrap M1 milestone and issues')"
user-invocable: true
---

# GitHub Skill — Chimera Project Management

## When to Use

- Bootstrap GitHub milestones for a release
- Create feature-level or task-level issues from the architecture overview
- Apply or create labels
- List open issues / milestones to check current state
- Link task issues to their parent feature issue

## Repository

`https://github.com/jindrichruzicka/Chimera`  
All `gh` commands below target this repo. Set the repo once per session:

```bash
export GH_REPO=jindrichruzicka/Chimera
```

---

## Procedure: Create a Milestone

```bash
gh api repos/$GH_REPO/milestones --method POST \
  --field title="<title>" \
  --field description="<description>" \
  --field due_on="<YYYY-MM-DDT00:00:00Z>"
```

Run once per milestone. Safe to re-run — if the milestone already exists, the command returns a 422 which can be ignored.

List existing milestones to avoid duplicates:

```bash
gh api repos/$GH_REPO/milestones --jq '.[].title'
```

---

## Procedure: Create Labels

```bash
gh label create "<name>" --color "<hex>" --description "<desc>" --repo $GH_REPO
```

If a label already exists the command exits non-zero — pass `--force` to overwrite or skip with `|| true`.

See [label catalogue](./references/labels.md) for the full set required by Chimera.

---

## Procedure: Create a Task Issue

Use the [task template](./assets/task-template.md) as the issue body:

```bash
gh issue create \
  --repo $GH_REPO \
  --title "<imperative verb + what>" \
  --body "$(cat .github/skills/github/assets/task-template.md)" \
  --label "task,milestone:<M>,<module>" \
  --milestone "<milestone title>"
```

**Rules:**
1. Title must start with an imperative verb: "Implement", "Add", "Write", "Wire", "Refactor".
2. Replace all `<placeholders>` in the template before submitting.
3. Always include `Part of #<feature-issue-number>` on line 1 of the body.
4. Always include at least one `Invariant` line if the task touches Appendix B.
5. Module label must be one of: `simulation`, `networking`, `renderer`, `electron`, `ai`, `testing`, `tooling`.

---

## Procedure: Create a Feature Issue

Use the [feature template](./assets/feature-template.md):

```bash
gh issue create \
  --repo $GH_REPO \
  --title "<feature name> (§<X.Y>)" \
  --body "$(cat .github/skills/github/assets/feature-template.md)" \
  --label "feature,milestone:<M>,<module>" \
  --milestone "<milestone title>"
```

Record the returned issue number — every child task issue must reference it.

---

## Procedure: Bootstrap a Full Milestone

Follow this sequence exactly. Do not skip steps.

1. **Read architecture** — relevant §12 checklist and §4 sub-sections.
2. **Check existing state:**
   ```bash
   gh api repos/$GH_REPO/milestones --jq '.[].title'
   gh issue list --repo $GH_REPO --state open --label "milestone:<M>" --json number,title
   ```
3. **Present the feature decomposition to the user and wait for approval.**
4. **Create the milestone** (skip if exists).
5. **Create labels** (skip if exists, use `|| true`).
6. **Create feature issues** in dependency order; note each issue number.
7. **Create task issues** under each feature, cross-linking `Part of #N`.
8. **Report summary table:**

   | Feature | Issue | Tasks created |
   |---------|-------|---------------|
   | Save/Load §4.11 | #12 | 5 |

---

## Procedure: List Open Issues for a Milestone

```bash
gh issue list \
  --repo $GH_REPO \
  --state open \
  --label "milestone:<M>" \
  --json number,title,labels \
  --jq '.[] | "#\(.number) \(.title)"'
```

---

## Procedure: Close a Task Issue

```bash
gh issue close <number> --repo $GH_REPO --comment "Completed in PR #<pr>"
```

---

## Error Handling

| Error | Cause | Resolution |
|---|---|---|
| `gh: command not found` | gh CLI not installed | `brew install gh && gh auth login` |
| `422 Unprocessable Entity` (milestone) | Milestone already exists | Skip creation, use existing |
| `422 Unprocessable Entity` (label) | Label already exists | Add `\|\| true` or use `--force` |
| `Resource not accessible by integration` | Token lacks `issues` scope | Re-auth: `gh auth refresh -s issues` |
| Milestone not found on issue create | Milestone title mismatch | Use exact title from `gh api .../milestones` |
