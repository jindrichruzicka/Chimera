---
name: github
description: 'GitHub project management operations for the Chimera engine: create milestones, create/list/close issues, apply labels, link tasks to features, bootstrap the full roadmap from the architecture overview. Use when: creating GitHub issues, creating milestones, labelling issues, bootstrapping the roadmap, decomposing features into tasks, checking what issues exist.'
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

## Procedure: Resolve the GitHub Milestone Number

GitHub milestones have a numeric ID that is **different** from labels like `milestone:M1`. Every `gh issue create` or patch call that should appear under a milestone must use this numeric ID, not the label. Resolve it once per session:

```bash
gh api repos/$GH_REPO/milestones --jq '.[] | "\(.number) \(.title)"'
```

Store the number in a shell variable:

```bash
M1_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("M1")) | .number')
```

Use `$M1_ID` (or the appropriate variable) in all subsequent calls. Never guess the number — always resolve it first.

---

## Procedure: Create a Task Issue

Use the [task template](./assets/task-template.md) as the issue body.

> **IMPORTANT — two separate things must both be set for an issue to appear under a milestone:**
>
> 1. The `milestone:M<N>` **label** (a coloured tag — cosmetic).
> 2. The GitHub **milestone assignment** — done via `--field milestone=<NUMERIC_ID>` on the API, or via the `--milestone "<title>"` flag on `gh issue create`.
>
> Omitting (2) means the issue will not appear at `github.com/.../milestone/<N>`. Always do both.

Create using a body file (avoids shell quoting issues with heredocs):

```bash
# Write the body to a temp file first
cat > /tmp/issue-body.md << 'BODYEOF'
<body content here>
BODYEOF

gh issue create \
  --repo $GH_REPO \
  --title "<imperative verb + what>" \
  --label "task,milestone:<M>,<module>" \
  --milestone "<exact milestone title from gh api>" \
  --body-file /tmp/issue-body.md
```

If `--milestone` fails (title mismatch), assign via the API after creation:

```bash
ISSUE=<number>
gh api repos/$GH_REPO/issues/$ISSUE --method PATCH --field milestone=$M1_ID
```

To assign multiple issues to a milestone at once:

```bash
for issue in 10 11 12 13; do
  gh api repos/$GH_REPO/issues/$issue --method PATCH --field milestone=$M1_ID \
    --jq '"#\(.number) → \(.milestone.title)"'
done
```

**Rules:**

1. Title must start with an imperative verb: "Implement", "Add", "Write", "Wire", "Refactor".
2. Replace all `<placeholders>` in the template before submitting.
3. Always include `Part of #<feature-issue-number>` on line 1 of the body.
4. Always include at least one `Invariant` line if the task touches Appendix B.
5. Module label must be one of: `simulation`, `networking`, `renderer`, `electron`, `ai`, `testing`, `tooling`.
6. Always verify the issue appears under the correct milestone URL after creation.

---

## Procedure: Create a Feature Issue

Use the [feature template](./assets/feature-template.md):

```bash
cat > /tmp/feature-body.md << 'BODYEOF'
<body content here>
BODYEOF

gh issue create \
  --repo $GH_REPO \
  --title "<feature name> (§<X.Y>)" \
  --label "feature,milestone:<M>,<module>" \
  --milestone "<exact milestone title from gh api>" \
  --body-file /tmp/feature-body.md
```

Record the returned issue number — every child task issue must reference it. Verify the issue appears at the milestone URL.

---

## Procedure: Bootstrap a Full Milestone

Follow this sequence exactly. Do not skip steps.

1. **Read architecture** — relevant §12 checklist and §4 sub-sections.
2. **Check existing state:**
    ```bash
    gh api repos/$GH_REPO/milestones --jq '.[] | "\(.number) \(.title)"'
    gh issue list --repo $GH_REPO --state open --label "milestone:<M>" --json number,title
    ```
3. **Resolve the milestone numeric ID** and store it:
    ```bash
    M_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("M<N>")) | .number')
    ```
4. **Present the feature decomposition to the user and wait for approval.**
5. **Create the milestone** (skip if exists).
6. **Create labels** (skip if exists, use `|| true`).
7. **Create feature issues** in dependency order, passing `--milestone` by title and verifying each has a non-null `.milestone` in the API response. Note each issue number.
8. **Create task issues** under each feature, cross-linking `Part of #N`, also with `--milestone`.
9. **Verify** all created issues appear at the milestone URL:
    ```bash
    gh issue list --repo $GH_REPO --state open --milestone "<title>" --json number,title \
      --jq '.[] | "#\(.number) \(.title)"'
    ```
10. **Report summary table:**

    | Feature         | Issue | Tasks created |
    | --------------- | ----- | ------------- |
    | Save/Load §4.11 | #12   | 5             |

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

Only close a task issue **after** the merge script (`check-and-merge.sh`) exits 0 and the push to `origin/main` is confirmed.

```bash
gh issue close <ISSUE_NUMBER> --repo $GH_REPO --comment "Implemented in $(git rev-parse --short HEAD) on main."
```

**Parent-feature-issue exception:** If this task belongs to a feature issue (i.e. it is a child task of a parent `feature`-labelled issue), do **not** close the parent here. The parent is closed only by the review task ("Review all F<NN> changes and merge to main") after all child tasks are merged.

---

## Error Handling

| Error                                     | Cause                             | Resolution                                                                  |
| ----------------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `gh: command not found`                   | gh CLI not installed              | `brew install gh && gh auth login`                                          |
| `422 Unprocessable Entity` (milestone)    | Milestone already exists          | Skip creation, use existing                                                 |
| `422 Unprocessable Entity` (label)        | Label already exists              | Add `\|\| true` or use `--force`                                            |
| `Resource not accessible by integration`  | Token lacks `issues` scope        | Re-auth: `gh auth refresh -s issues`                                        |
| Milestone not found on issue create       | Milestone title mismatch          | Use exact title from `gh api .../milestones`; prefer API PATCH as fallback  |
| Issue has label but not on milestone page | Label set; milestone not assigned | Run `gh api repos/$GH_REPO/issues/$N --method PATCH --field milestone=<ID>` |
