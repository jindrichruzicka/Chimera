---
description: 'Review production readiness of a delivered GitHub milestone on main. Usage: /review-milestone <milestone-designator-or-title>'
argument-hint: '<milestone-designator-or-title>'
---

Given milestone `{{milestone-designator-or-title}}`, review the current state of `main` and decide whether the whole milestone is production-ready to deliver.

This is a review-only workflow: do not edit source files, do not commit, and do not merge. Produce a milestone readiness report grounded in roadmap scope, GitHub issue state, repository evidence, local validation, and Chimera architecture invariants.

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
- `docs/ROADMAP.md`
- `.github/skills/invariants/SKILL.md`

Use the architecture invariants and coding standards as hard readiness criteria. Use `docs/ROADMAP.md` to confirm the intended milestone scope.

## Step 2 - Resolve milestone scope

1. Resolve `{{milestone-designator-or-title}}` to the GitHub milestone title and roadmap section.
2. Fetch milestone issues:

```bash
gh issue list --repo jindrichruzicka/Chimera --milestone '{{milestone-designator-or-title}}' --state all --limit 200 --json number,title,state,labels,body,milestone,url
```

3. If the milestone designator does not match the GitHub milestone title exactly, use `docs/ROADMAP.md` and `gh api repos/jindrichruzicka/Chimera/milestones` to find the matching milestone.
4. Group issues into:
    - feature issues
    - task issues
    - bugs or regressions
    - docs or infrastructure issues
5. For each feature issue, discover linked task issues via body/comments using the same `Part of #<feature-number>` convention used by `/bootstrap-milestone`.
6. Record any roadmap feature without a GitHub issue, any open issue, any unlabeled issue, and any orphan task that is not linked to a parent feature.

## Step 3 - Build the milestone evidence map from main

Review `main`, not a topic branch. Do not rely only on closed issue state.

For every milestone feature:

1. Extract acceptance criteria and expected user-facing outcomes.
2. Map each criterion to concrete evidence on `main`: source files, tests, docs, scripts, and commands.
3. Check that cross-feature integrations work together, especially shared state, IPC contracts, networking messages, persistence formats, settings, and renderer store boundaries.
4. Check module ownership:
    - Electron main owns lifecycle, secure IPC, local host server, and process wiring.
    - Renderer owns UI, R3F rendering, and client state through narrow Zustand selectors.
    - Simulation owns deterministic game rules and never imports UI, Electron, DOM APIs, or game-specific renderer data.
    - Networking is an adapter around host-authoritative simulation, not the source of truth.
5. Check milestone-level documentation, changelog entries, migration notes, diagnostics, and user-facing operational guidance.
6. Find potential problems and suggest improvements.

## Step 4 - Run validation gates

Run and summarize these commands:

```bash
bash .github/skills/invariants/scripts/check-invariants.sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

A failing invariant check, lint, typecheck, format check, or test run is a blocking milestone readiness issue. Include the relevant failure excerpt, not the full noisy log.

## Step 5 - Review milestone production readiness

Classify findings using these rules:

- **BLOCK** - The milestone must not ship. Use for open required issues, missing roadmap scope, missing acceptance criteria, failing gates, architecture invariant violations, security issues, broken module boundaries, deterministic simulation violations, `GameSnapshot` leakage, unvalidated IPC input, missing required tests, or cross-feature workflows that cannot succeed.
- **WARNING** - The milestone can ship only with explicit acceptance of residual risk. Use for maintainability concerns, incomplete docs, performance risks, weak diagnostics, non-blocking UX rough edges, or test coverage gaps that do not invalidate milestone outcomes.
- **IMPROVEMENT** - Follow-up suggestion that should not block delivery.

Evaluate at minimum:

- roadmap scope completion
- feature issue and task issue completion
- acceptance criteria coverage per feature
- cross-feature integration and regression risk
- architecture alignment and module ownership
- deterministic simulation behavior and Appendix B invariants
- IPC, networking, and trust boundaries
- renderer state subscriptions and React/R3F patterns, if UI is involved
- test coverage at unit, integration, and relevant end-to-end levels
- performance and operational diagnostics
- documentation, changelog, and migration notes

## Step 6 - Produce the report

Emit a Markdown report in this format:

```markdown
# Milestone Readiness Review - <milestone-title>

## Verdict

<READY | NOT READY | READY WITH WARNINGS>

Decision: <one paragraph explaining the production-readiness decision>

## Scope Reviewed

- Milestone: <title or designator>
- Main commit reviewed: <short-sha> <subject>
- Feature issues reviewed: <N>
- Task issues reviewed: <N>
- Open required issues: <N>

## Gate Results

| Gate       | Result    | Notes     |
| ---------- | --------- | --------- |
| Invariants | PASS/FAIL | <summary> |
| Format     | PASS/FAIL | <summary> |
| Lint       | PASS/FAIL | <summary> |
| Typecheck  | PASS/FAIL | <summary> |
| Tests      | PASS/FAIL | <summary> |

## Feature Readiness Matrix

| Feature         | Issue | Required tasks | Evidence on main             | Status            | Notes   |
| --------------- | ----- | -------------- | ---------------------------- | ----------------- | ------- |
| <feature title> | #<N>  | <done/total>   | <files/tests/docs inspected> | PASS/PARTIAL/FAIL | <notes> |

## Milestone-Level Findings

### Blocking Issues (<N>)

**[BLOCK-1] <title>**
Area: <Scope | Architecture | Tests | Security | Determinism | IPC | Networking | Renderer | Performance | Docs | Integration>
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

A milestone is **READY** only when every required feature is ready, all required issues are closed or demonstrably complete on `main`, all validation gates pass, and there are zero blocking findings.
