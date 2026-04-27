---
description: "Bootstrap a single feature on GitHub: create the feature issue from the roadmap, decompose into task issues with full descriptions. Usage: /bootstrap-feature <feature-designator> (e.g. F12, F03, or a short name like 'LobbyStore')"
---

Given feature designator `{{feature-designator}}`:

## Step 1 — Load the GitHub skill

Load `.github/skills/github/SKILL.md` and the sub-skill `.github/skills/github/create-issue/SKILL.md`.

## Step 2 — Read the source of truth

1. Read `docs/ROADMAP.md` — locate the feature row matching `{{feature-designator}}`.
2. Read the relevant section of `docs/architecture-overview.md` referenced by that feature (§X.Y).
3. Read the relevant core-component doc under `docs/core-components/` if one exists for this feature.

From these documents extract:

- Feature title, milestone designator (M1/M2/…), and module area (label)
- Architecture section number (§X.Y)
- All §12 checklist items scoped to this feature
- All Appendix B invariants touched by this feature
- Any explicit non-goals / deferred items (Appendix E or later milestone)

## Step 3 — Check existing GitHub state

```bash
export GH_REPO=jindrichruzicka/Chimera
gh issue list --repo $GH_REPO --state open --label feature --limit 50
gh issue list --repo $GH_REPO --state closed --label feature --limit 50
```

If a feature issue for `{{feature-designator}}` already exists, **stop and report its URL** — do not create a duplicate.

Resolve the milestone number for the target milestone:

```bash
MILESTONE_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("<MILESTONE_TITLE>")) | .number')
```

## Step 4 — Present decomposition for approval

Before creating any GitHub issues, print the following plan to the user and **wait for explicit confirmation**:

```
Feature: <title> (§X.Y) — Milestone: M<N>
Labels:  feature, milestone:M<N>, <module>

Tasks:
  T01 — <imperative verb> <what>
  T02 — <imperative verb> <what>
  ...
  T<NN> — Review all F<NN> changes and merge to main  ← always last
```

Do not proceed until the user approves (or requests changes to) this plan.

## Step 5 — Create the feature issue

Populate the feature template (`.github/skills/github/assets/feature-template.md`). Replace **every** placeholder with real content drawn from Step 2. The `## Child tasks` section should list placeholder entries for now — you will update it after creating task issues.

```bash
cat > /tmp/feature-body.md << 'BODYEOF'
<populated feature template>
BODYEOF

gh issue create \
  --repo $GH_REPO \
  --title "<feature title> (§X.Y)" \
  --label "feature,milestone:M<N>,<module>" \
  --milestone "<Milestone title>" \
  --body-file /tmp/feature-body.md
```

Record the new feature issue number as `FEATURE_NUM`.

## Step 6 — Create task issues

For **each** task in the approved plan (in order), populate the task template (`.github/skills/github/assets/task-template.md`). Replace every placeholder:

- `> Part of #<FEATURE_ISSUE_NUMBER>` → `> Part of #$FEATURE_NUM`
- `> Architecture: §<X.Y>` → real section
- `## What to do` → one concrete paragraph for this specific task
- `## Implementation notes` → exact files/types to create or modify, forbidden imports
- `## Acceptance Criteria` → testable, specific conditions (unit tests, lint, §12 checklist item)
- `## Invariants touched` → only invariants genuinely relevant to this task

```bash
cat > /tmp/task-body.md << 'BODYEOF'
<populated task template for T<NN>>
BODYEOF

gh issue create \
  --repo $GH_REPO \
  --title "<imperative verb> <what>" \
  --label "task,milestone:M<N>,<module>" \
  --milestone "<Milestone title>" \
  --body-file /tmp/task-body.md
```

Repeat for every task. Record all task issue numbers.

The **last** task must always be:

- Title: `Review all F<NN> changes and merge to main`
- Labels: `task`, `milestone:M<N>`, `<module>`
- Body invokes the **Chimera Code Reviewer** agent and lists every F<NN>-specific invariant to verify

## Step 7 — Update the feature issue with child task list

Edit the feature issue body to replace the placeholder `## Child tasks` section with real issue links:

```bash
# Build updated body with real task numbers, then:
gh issue edit $FEATURE_NUM \
  --repo $GH_REPO \
  --body-file /tmp/feature-body-updated.md
```

Each line in the checklist must follow the format:

```
- [ ] #<task-issue-number> — <task title>
```

## Step 8 — Report summary

Print a completion table:

| Field         | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| Feature issue | #`FEATURE_NUM` — `<title>` (§X.Y)                               |
| Milestone     | M<N>                                                            |
| Tasks created | N (including review task)                                       |
| Feature URL   | `https://github.com/jindrichruzicka/Chimera/issues/FEATURE_NUM` |

---

## Quality checks (run before reporting done)

- [ ] Every §12 checklist item for this feature maps to at least one task
- [ ] No task spans two module boundaries (one task = one module area)
- [ ] Every task has testable acceptance criteria (no "verify manually")
- [ ] Review task is **last** and its body names this feature's invariants
- [ ] Feature issue `## Child tasks` is fully populated with real issue numbers
