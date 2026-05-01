---
description: 'Review production readiness of a delivered GitHub feature issue on main. Usage: /review-feature <feature-issue-number-or-url>'
argument-hint: '<feature-issue-number-or-url>'
---

Given feature issue `{{feature-issue-number-or-url}}`, review `main` and decide if the feature is production-ready.

**Review-only**: do not edit, commit, or merge. Produce a readiness report grounded in issue scope, repo evidence, local validation, and Chimera invariants.

## Step 0 — Prepare main

```bash
bash .github/skills/git/pull-latest/scripts/pull-latest.sh
```

(Follow `.github/skills/git/pull-latest/SKILL.md`.) Confirm review is on `main` after pull. Stop and report if dirty/pull fails/checkout fails.

## Step 1 — Authoritative context

Load `.github/skills/invariants/SKILL.md`. Use invariants + standards as hard criteria.

## Step 2 — Issue + scope

```bash
gh issue view {{feature-issue-number-or-url}} --repo jindrichruzicka/Chimera \
  --json number,title,body,labels,state,milestone,comments,url
```

Verify `feature` label (warn if missing). Extract: goal, acceptance criteria, required invariants, child task/PR refs, milestone/domain labels.

Find child tasks:

```bash
gh issue list --repo jindrichruzicka/Chimera --state all \
  --search '"Part of #<feature-number>" in:body,comments' \
  --json number,title,state,labels,body,url
```

If search misses any, scan the feature body/comments manually.

## Step 3 — Evidence map from main

Review `main`, not a topic branch. For each acceptance criterion + child task: identify files/modules/tests/docs/commands that prove implementation; inspect via search + targeted reads.

Module ownership:

- Electron main: lifecycle, secure IPC, local host server, process wiring.
- Renderer: UI, R3F, client state via narrow Zustand selectors.
- Simulation: deterministic rules; never imports UI/Electron/DOM/game-renderer data.
- Networking: adapter around host-authoritative simulation (not source of truth).

Check docs/roadmap updates when feature changes public arch, commands, APIs, or workflows. Flag problems + improvements.

## Step 4 — Classify findings

- **BLOCK** — must not ship: missing criteria, failing gates, invariant violations, security, broken module boundaries, determinism violations, `GameSnapshot` leakage, unvalidated IPC, missing required tests, broken user workflows.
- **WARNING** — ship only with explicit risk acceptance: maintainability, doc gaps, perf risk, weak diagnostics, minor UX, non-invalidating coverage gaps.
- **IMPROVEMENT** — non-blocking follow-up.

Evaluate at minimum: scope completeness; arch alignment + module ownership; determinism + [Architecture Invariants](../../docs/executive-architecture/architecture-invariants.md); IPC/networking/trust; renderer state + React/R3F (if UI); test coverage + regression risk; perf + diagnostics; docs/changelog/migration.

## Step 5 — Report

```markdown
# Feature Readiness Review — #<N> <title>

## Verdict

<READY | NOT READY | READY WITH WARNINGS>

Decision: <one paragraph>

## Scope Reviewed

- Feature issue: <url>
- Milestone: <or none>
- Child tasks reviewed: <N>
- Main commit: <short-sha> <subject>

## Acceptance Criteria Coverage

| Criterion | Evidence on main   | Status            | Notes |
| --------- | ------------------ | ----------------- | ----- |
| <…>       | <files/tests/docs> | PASS/PARTIAL/FAIL | …     |

## Findings

### Blocking (<N>)

**[BLOCK-1] <title>**
Area: <Architecture | Scope | Tests | Security | Determinism | IPC | Networking | Renderer | Performance | Docs>
Evidence: <paths/refs/excerpt>
Impact: <why blocks>
Required fix: <specific>

### Warnings (<N>)

**[WARN-1] <title>**
Area: … Evidence: … Risk: … Suggested fix: …

### Improvements (<N>)

- <follow-up>

## Delivery Decision

<Ship | Do not ship | Ship only after explicitly accepting warnings>
Next action: <specific>
```

**READY** ⇔ all criteria pass AND all gates pass AND zero blocking findings.
