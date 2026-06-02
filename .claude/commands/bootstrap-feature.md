---
description: "Bootstrap a single feature on GitHub - create the feature issue from the roadmap, decompose into task issues with full descriptions. Usage - /bootstrap-feature <feature-designator> (e.g. F12, F03, or a short name like 'LobbyStore')"
argument-hint: '<feature-designator>'
---

Given feature designator `$1`:

1. Load [GitHub skill](../skills/github/SKILL.md) and [create-issue skill](../skills/github/create-issue/SKILL.md).
2. Read [ROADMAP](../../docs/ROADMAP.md), the relevant architecture/core-component docs, [module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md), and [architecture invariants](../../docs/executive-architecture/architecture-invariants.md).
3. Resolve title, milestone, module label, architecture section, checklist items, invariants, non-goals, and existing GitHub issues. If the feature already exists, stop and report its URL.
4. Present the proposed feature and task decomposition for user approval before creating anything. The final task is always the feature review/merge task.
5. After approval, use the GitHub issue templates and create-issue skill to create the feature, then task issues. Each task has `Part of #<feature>`, one module owner, testable criteria, and only genuinely touched invariants.
6. Update the feature issue child-task checklist with real task numbers.
7. Report feature URL, milestone, created tasks, and any assumptions.

Before reporting done, verify: every roadmap/checklist item maps to a task, no task crosses module ownership, all criteria are testable, the review task is last, and the feature issue links the real child tasks.
