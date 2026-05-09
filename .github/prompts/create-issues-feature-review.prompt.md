---
description: 'Parse review findings and create GitHub issues linked to the parent feature review issue. Usage: /create-issues-feature-review <feature-review-issue> <review-report>'
argument-hint: '<feature-review-issue-url-or-number> <review-report>'
---

Given:

- `{{feature-review-issue}}` — parent feature review issue number/URL
- `{{review-report}}` — review report text (BLOCKs/WARNs/suggestions)

1. Load [GitHub skill](../skills/github/SKILL.md) and [create-issue skill](../skills/github/create-issue/SKILL.md).
2. Load the parent issue with `gh issue view {{feature-review-issue}} --repo jindrichruzicka/Chimera --json number,title,body,labels,milestone,url`.
3. Parse `{{review-report}}` into distinct root-cause findings: severity, title, location, full description, suggested fix, and cited invariants.
4. Map labels: `BLOCK` -> `bug, priority: high`; correctness `WARN` -> `bug` or `tech-debt`; `INFO`/`SUGGESTION` -> `enhancement` or `tech-debt`; add a domain label when path evidence makes it clear.
5. Create one issue per finding in the parent milestone. Each body includes Finding, Location, Suggested fix, Architecture invariants, and `Part of feature review #<parent>`.
6. Comment on the parent issue with the created issue list, then verify every child links back to the parent.

Report:

| #   | Title | Severity | Labels              | URL |
| --- | ----- | -------- | ------------------- | --- |
| 1   | …     | BLOCK    | bug, priority: high | …   |
| …   |       |          |                     |     |

State total created + parent URL.
