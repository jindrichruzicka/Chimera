---
description: 'Given a text report from a code/feature review and a GitHub feature review issue URL or number, parse the report findings and create detailed GitHub issues for each finding, linked as sub-issues of the parent feature review issue. Usage: /create-issues-feature-review <feature-review-issue> <review-report>'
argument-hint: '<feature-review-issue-url-or-number> <review-report>'
---

Given:

- `{{feature-review-issue}}` — parent feature review issue number/URL
- `{{review-report}}` — review report text (BLOCKs/WARNs/suggestions)

## Step 1 — Load parent issue

```bash
gh issue view {{feature-review-issue}} --repo jindrichruzicka/Chimera \
  --json number,title,body,labels,milestone,url
```

Record: issue number (parent for sub-issues), milestone (apply to every created issue), parent labels (apply relevant ones e.g. `bug`, `tech-debt`).

## Step 2 — Parse report

For each distinct finding extract:

| Field         | Description                                       |
| ------------- | ------------------------------------------------- |
| severity      | `BLOCK` / `WARN` / `INFO` / `SUGGESTION`          |
| title         | One-line summary                                  |
| location      | File path(s) + line numbers if mentioned          |
| description   | Full explanation as written                       |
| suggested fix | Fix described/implied                             |
| invariants    | Architecture invariant numbers (e.g. `#1`, `#43`) |

Group same-root-cause findings into one issue.

## Step 3 — Map labels per finding

- `BLOCK` → `bug` + `priority: high`
- `WARN` → `tech-debt` (or `bug` if correctness)
- `INFO` / `SUGGESTION` → `enhancement` or `tech-debt`

Add domain label from path when determinable: `electron`, `renderer`, `simulation`, `shared`, `networking`, `testing`.

## Step 4 — Create one issue per finding

```bash
gh issue create --repo jindrichruzicka/Chimera \
  --title "<severity-prefix>: <title>" \
  --body "<body — see template>" \
  --label "<labels>" \
  --milestone "<milestone-from-parent>"
```

Body template:

```markdown
## Finding

<full description>

## Location

<file path(s) + line numbers, or "N/A">

## Suggested fix

<from report, or "See review report for details">

## Architecture invariants

<comma-separated numbers, or "None cited">

## Context

Part of feature review #<parent-issue-number>.
```

Record each new issue URL.

## Step 5 — Link sub-issues to parent

GitHub CLI has no native sub-issue command. Comment on parent listing all created issues:

```bash
gh issue comment {{feature-review-issue}} --repo jindrichruzicka/Chimera \
  --body "## Issues created from this review

<bullet list of issue URLs and titles>"
```

Verify each child body contains `Part of #<parent-issue-number>` (already in template).

## Step 6 — Report

| #   | Title | Severity | Labels              | URL |
| --- | ----- | -------- | ------------------- | --- |
| 1   | …     | BLOCK    | bug, priority: high | …   |
| …   |       |          |                     |     |

State total created + parent URL.
