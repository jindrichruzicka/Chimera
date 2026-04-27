---
description: 'Review production readiness of a delivered GitHub feature issue on main. Usage: /review-feature <feature-issue-number-or-url>'
argument-hint: '<feature-issue-number-or-url>'
---

Given GitHub feature issue `{{feature-issue-number-or-url}}`, review the current state of `main` and decide whether the feature is production-ready to deliver.

This is a review-only workflow: do not edit source files, do not commit, and do not merge. Produce a readiness report grounded in issue scope, repository evidence, local validation, and Chimera architecture invariants.

## Step 0 - Prepare main safely

1. Load and follow `.github/skills/git/pull-latest/SKILL.md`.
2. Run:

```bash
bash .github/skills/git/pull-latest/scripts/pull-latest.sh
```

3. Confirm the review is being performed against `main` after the pull succeeds.
4. If the working tree is dirty, the pull fails, or `main` cannot be checked out safely, stop and report the blocker.

## Step 1 - Load authoritative context

Read these before reviewing implementation evidence:

- `docs/architecture-overview.md`
- `docs/coding-standards.md`
- `.github/skills/invariants/SKILL.md`

Use the architecture invariants and coding standards as hard readiness criteria.

## Step 2 - Load the feature issue and scope

1. Resolve `{{feature-issue-number-or-url}}` to an issue number.
2. Fetch the issue:

```bash
gh issue view {{feature-issue-number-or-url}} --repo jindrichruzicka/Chimera --json number,title,body,labels,state,milestone,comments,url
```

3. Verify this is a feature issue. If the labels do not include `feature`, continue the review but record a warning.
4. Extract:
    - feature goal and user-facing outcome
    - acceptance criteria
    - required invariants or architecture constraints
    - referenced task issues, PRs, docs, and test expectations
    - milestone and domain labels
5. Find child task issues linked to the feature:

```bash
gh issue list --repo jindrichruzicka/Chimera --state all --search '"Part of #<feature-number>" in:body,comments' --json number,title,state,labels,body,url
```

If the search cannot discover all tasks, inspect the feature body and comments manually for issue references.

## Step 3 - Build the evidence map from main

Review `main`, not a topic branch. Do not rely only on closed issue state.

For each acceptance criterion and child task:

1. Identify the files, modules, tests, docs, and commands that prove whether the criterion is implemented.
2. Use repository search and targeted file reads to inspect the implementation.
3. Check ownership boundaries:
    - Electron main owns lifecycle, secure IPC, local host server, and process wiring.
    - Renderer owns UI, R3F rendering, and client state through narrow Zustand selectors.
    - Simulation owns deterministic game rules and never imports UI, Electron, DOM APIs, or game-specific renderer data.
    - Networking is an adapter around host-authoritative simulation, not the source of truth.
4. Check that docs or roadmap references were updated when the feature changes public architecture, commands, APIs, or user-visible workflows.

## Step 4 - Run validation gates

Run and summarize these commands:

```bash
bash .github/skills/invariants/scripts/check-invariants.sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

A failing invariant check, lint, typecheck, format check, or test run is a blocking readiness issue. Include the relevant failure excerpt, not the full noisy log.

## Step 5 - Review production readiness

Classify findings using these rules:

- **BLOCK** - The feature must not ship. Use for missing acceptance criteria, failing gates, architecture invariant violations, security issues, broken module boundaries, deterministic simulation violations, `GameSnapshot` leakage, unvalidated IPC input, missing required tests, or user-facing workflows that cannot succeed.
- **WARNING** - The feature can ship only with explicit acceptance of residual risk. Use for maintainability concerns, incomplete docs, performance risks, weak diagnostics, non-blocking UX rough edges, or test coverage gaps that do not invalidate the feature.
- **IMPROVEMENT** - Follow-up suggestion that should not block delivery.

Evaluate at minimum:

- scope completeness against the feature issue and child tasks
- architecture alignment and module ownership
- deterministic simulation behavior and Appendix B invariants
- IPC, networking, and trust boundaries
- renderer state subscriptions and React/R3F patterns, if UI is involved
- test coverage and regression risk
- performance and operational diagnostics
- documentation, changelog, and migration notes where relevant

## Step 6 - Produce the report

Emit a Markdown report in this format:

```markdown
# Feature Readiness Review - #<issue-number> <title>

## Verdict

<READY | NOT READY | READY WITH WARNINGS>

Decision: <one paragraph explaining the production-readiness decision>

## Scope Reviewed

- Feature issue: <url>
- Milestone: <milestone or none>
- Child tasks reviewed: <N>
- Main commit reviewed: <short-sha> <subject>

## Gate Results

| Gate       | Result    | Notes     |
| ---------- | --------- | --------- |
| Invariants | PASS/FAIL | <summary> |
| Format     | PASS/FAIL | <summary> |
| Lint       | PASS/FAIL | <summary> |
| Typecheck  | PASS/FAIL | <summary> |
| Tests      | PASS/FAIL | <summary> |

## Acceptance Criteria Coverage

| Criterion   | Evidence on main             | Status            | Notes   |
| ----------- | ---------------------------- | ----------------- | ------- |
| <criterion> | <files/tests/docs inspected> | PASS/PARTIAL/FAIL | <notes> |

## Findings

### Blocking Issues (<N>)

**[BLOCK-1] <title>**
Area: <Architecture | Scope | Tests | Security | Determinism | IPC | Networking | Renderer | Performance | Docs>
Evidence: <file paths, issue refs, or command output excerpt>
Impact: <why this blocks production delivery>
Required fix: <specific fix>

### Warnings (<N>)

**[WARN-1] <title>**
Area: <area>
Evidence: <evidence>
Risk: <risk>
Suggested fix: <specific improvement>

### Improvements (<N>)

- <follow-up suggestion>

## Delivery Decision

<Ship / Do not ship / Ship only after explicitly accepting warnings>

Next action: <specific next step>
```

A feature is **READY** only when all acceptance criteria pass and all validation gates pass with zero blocking findings.
