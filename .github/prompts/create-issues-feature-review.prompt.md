---
description: 'Given a text report from a code/feature review and a GitHub feature review issue URL or number, parse the report findings and create detailed GitHub issues for each finding, linked as sub-issues of the parent feature review issue. Usage: /create-issues-feature-review <feature-review-issue> <review-report>'
argument-hint: '<feature-review-issue-url-or-number> <review-report>'
---

Given:

- `{{feature-review-issue}}` — GitHub issue number or URL of the parent feature review issue
- `{{review-report}}` — text of the code/feature review report (findings, BLOCKs, WARNs, suggestions, etc.)

## Step 1 — Load the parent feature review issue

Resolve `{{feature-review-issue}}` to an issue number and fetch it:

```bash
gh issue view {{feature-review-issue}} --repo jindrichruzicka/Chimera --json number,title,body,labels,milestone,url
```

Record:

- The issue number (used as the parent for all sub-issues)
- The milestone (apply the same milestone to every created issue)
- The labels on the parent (apply relevant ones, e.g. `bug`, `tech-debt`, to sub-issues)

## Step 2 — Parse the review report

Read `{{review-report}}` and extract every distinct finding. For each finding identify:

| Field             | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| **severity**      | `BLOCK` / `WARN` / `INFO` / `SUGGESTION`                     |
| **title**         | Short one-line summary of the problem                        |
| **location**      | File path(s) and line numbers if mentioned                   |
| **description**   | Full explanation of the problem as written in the report     |
| **suggested fix** | Any fix described or implied in the report                   |
| **invariants**    | Architecture invariant numbers referenced (e.g. `#1`, `#43`) |

Group findings of the same root cause into one issue rather than creating duplicates.

## Step 3 — Determine labels per finding

Map severity and domain to Chimera labels:

- `BLOCK` → `bug` + `priority: high`
- `WARN` → `tech-debt` (or `bug` if it is a correctness issue)
- `INFO` / `SUGGESTION` → `enhancement` or `tech-debt`

Add the relevant domain label if determinable from the file path (`electron`, `renderer`, `simulation`, `shared`, `networking`, `testing`).

## Step 4 — Create one GitHub issue per finding

For each finding, create an issue with a structured body:

```bash
gh issue create \
  --repo jindrichruzicka/Chimera \
  --title "<severity-prefix>: <title>" \
  --body "<body — see template below>" \
  --label "<labels>" \
  --milestone "<milestone-from-parent>"
```

**Issue body template:**

```markdown
## Finding

<full description from the review report>

## Location

<file path(s) and line numbers, or "N/A">

## Suggested fix

<suggested fix from the report, or "See review report for details">

## Architecture invariants

<comma-separated invariant numbers, or "None cited">

## Context

Part of feature review #<parent-issue-number>.
```

Record the URL of each newly created issue.

## Step 5 — Link all created issues as sub-issues of the parent

For every issue created in Step 4, add it as a sub-issue of the parent feature review issue using the GitHub CLI:

```bash
gh issue develop {{feature-review-issue}} --repo jindrichruzicka/Chimera
```

Because the GitHub CLI does not have a native sub-issue command, add a reference in a comment on the parent issue listing all created issues:

```bash
gh issue comment {{feature-review-issue}} \
  --repo jindrichruzicka/Chimera \
  --body "## Issues created from this review\n\n<bullet list of issue URLs and titles>"
```

Then edit each created issue's body to include the line `Part of #<parent-issue-number>` (already included in the template above — verify it is present).

## Step 6 — Report back

Emit a summary table:

| #   | Title | Severity | Labels              | Issue URL |
| --- | ----- | -------- | ------------------- | --------- |
| 1   | …     | BLOCK    | bug, priority: high | …         |
| …   |       |          |                     |           |

State the total number of issues created and the parent issue URL.
