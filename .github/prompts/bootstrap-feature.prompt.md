---
description: "Bootstrap a single feature on GitHub: create the feature issue from the roadmap, decompose into task issues with full descriptions. Usage: /bootstrap-feature <feature-designator> (e.g. F12, F03, or a short name like 'LobbyStore')"
---

Given feature designator `{{feature-designator}}`:

## Step 1 — Load skills

`.github/skills/github/SKILL.md` + `.github/skills/github/create-issue/SKILL.md`.

## Step 2 — Read source of truth

1. `docs/ROADMAP.md` — locate feature row matching `{{feature-designator}}`.
2. Relevant `docs/architecture-overview.md` §X.Y referenced by that feature.
3. Relevant `docs/core-components/` doc if one exists.

Extract: feature title, milestone (M1/…), module label, §X.Y, all §12 checklist items for this feature, all Appendix B invariants touched, explicit non-goals/deferred items.

## Step 3 — Check existing GitHub state

```bash
export GH_REPO=jindrichruzicka/Chimera
gh issue list --repo $GH_REPO --state open   --label feature --limit 50
gh issue list --repo $GH_REPO --state closed --label feature --limit 50
```

If a feature issue for `{{feature-designator}}` already exists → **stop, report URL**, do not duplicate.

```bash
MILESTONE_ID=$(gh api repos/$GH_REPO/milestones \
  --jq '.[] | select(.title | startswith("<MILESTONE_TITLE>")) | .number')
```

## Step 4 — Present decomposition (USER APPROVAL)

```
Feature: <title> (§X.Y) — Milestone: M<N>
Labels:  feature, milestone:M<N>, <module>

Tasks:
  T01 — <verb> <what>
  T02 — <verb> <what>
  ...
  T<NN> — Review all F<NN> changes and merge to main  ← always last
```

Wait for approval / changes.

## Step 5 — Create feature issue

Populate `.github/skills/github/assets/feature-template.md`. Replace **every** placeholder. `## Child tasks` section: placeholder entries (updated in Step 7).

```bash
cat > /tmp/feature-body.md << 'BODYEOF'
<populated feature template>
BODYEOF

gh issue create --repo $GH_REPO \
  --title "<feature title> (§X.Y)" \
  --label "feature,milestone:M<N>,<module>" \
  --milestone "<Milestone title>" \
  --body-file /tmp/feature-body.md
```

Record `FEATURE_NUM`.

## Step 6 — Create task issues

For each task in approved plan (in order), populate `.github/skills/github/assets/task-template.md` replacing every placeholder:

- `Part of #<FEATURE_ISSUE_NUMBER>` → `Part of #$FEATURE_NUM`
- `Architecture: §<X.Y>` → real section
- `## What to do` → one concrete paragraph
- `## Implementation notes` → exact files/types, forbidden imports
- `## Acceptance Criteria` → testable, specific (unit tests, lint, §12 checklist)
- `## Invariants touched` → only genuinely relevant

```bash
cat > /tmp/task-body.md << 'BODYEOF'
<populated task template for T<NN>>
BODYEOF

gh issue create --repo $GH_REPO \
  --title "<verb> <what>" \
  --label "task,milestone:M<N>,<module>" \
  --milestone "<Milestone title>" \
  --body-file /tmp/task-body.md
```

Record all task numbers.

**Last task always:**

- Title: `Review all F<NN> changes and merge to main`
- Labels: `task`, `milestone:M<N>`, `<module>`
- Body: invokes **Chimera Code Reviewer** agent + lists every F<NN>-specific invariant.

## Step 7 — Update feature with child task list

```bash
gh issue edit $FEATURE_NUM --repo $GH_REPO --body-file /tmp/feature-body-updated.md
```

Each checklist line: `- [ ] #<task-issue-number> — <task title>`.

## Step 8 — Report

| Field         | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| Feature issue | #`FEATURE_NUM` — `<title>` (§X.Y)                               |
| Milestone     | M<N>                                                            |
| Tasks created | N (incl. review task)                                           |
| Feature URL   | `https://github.com/jindrichruzicka/Chimera/issues/FEATURE_NUM` |

## Quality checks (before reporting done)

- [ ] Every §12 checklist item maps to ≥1 task
- [ ] No task spans two module boundaries (one task = one module)
- [ ] Every task has testable criteria (no "verify manually")
- [ ] Review task is **last** and names this feature's invariants
- [ ] Feature `## Child tasks` populated with real numbers
