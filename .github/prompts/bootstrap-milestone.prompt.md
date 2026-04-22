---
description: "Bootstrap a milestone's features and tasks on GitHub. Usage: /bootstrap-milestone <milestone-designator> (e.g. M1, M2)"
---

Given milestone designator `{{milestone-designator}}`:

Load `.github/skills/github/SKILL.md` and follow the **Procedure: Bootstrap a Full Milestone** section.

The workflow:

1. Read `docs/ROADMAP.md` to identify the features scoped to `{{milestone-designator}}`
2. Create the GitHub milestone via `gh api`
3. For each feature in the milestone:
    - Create a feature issue using the feature template
    - Decompose into task issues using the task template
    - Link each task to its parent feature with "Part of #N"
    - Apply the correct labels (`feature`, `task`, `milestone:{{milestone-designator}}`, domain label)
4. Report a summary: milestone created, N features, M tasks

Reference: `.github/skills/github/SKILL.md`
