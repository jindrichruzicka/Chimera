---
description: 'Review production readiness of a delivered GitHub milestone on main. Usage: /review-milestone <milestone-designator-or-title>'
argument-hint: '<milestone-designator-or-title>'
---

Given milestone `{{milestone-designator-or-title}}`, review `main` and decide if the whole milestone is production-ready.

**Review-only**: do not edit, commit, or merge. Produce a milestone readiness report grounded in roadmap scope, GitHub state, repo evidence, local validation, and Chimera invariants.

## Step 0 — Prepare main

```bash
bash .github/skills/git/pull-latest/scripts/pull-latest.sh
```

Stop if dirty/pull fails/checkout fails.

## Step 1 — Authoritative context

Read: `docs/architecture-overview.md`, `docs/coding-standards.md`, `docs/ROADMAP.md`, `.github/skills/invariants/SKILL.md`. ROADMAP defines intended scope; invariants + standards are hard criteria.

## Step 2 — Resolve milestone scope

```bash
gh issue list --repo jindrichruzicka/Chimera \
  --milestone '{{milestone-designator-or-title}}' --state all --limit 200 \
  --json number,title,state,labels,body,milestone,url
```

If designator doesn't match GitHub title exactly: cross-ref `docs/ROADMAP.md` and `gh api repos/jindrichruzicka/Chimera/milestones`.

Group: features / tasks / bugs / docs+infra. For each feature, discover child tasks via `Part of #<feature-number>` (same convention as `/bootstrap-milestone`).

Record: roadmap features missing GitHub issues; open issues; unlabeled issues; orphan tasks without parent.

## Step 3 — Milestone evidence map from main

For each feature: extract acceptance criteria; map criteria to evidence on `main` (sources/tests/docs/scripts/commands).

Check cross-feature integrations: shared state, IPC contracts, networking msgs, persistence formats, settings, renderer store boundaries.

Module ownership:

- Electron main: lifecycle, secure IPC, local host server, process wiring.
- Renderer: UI, R3F, client state via narrow Zustand selectors.
- Simulation: deterministic rules; never imports UI/Electron/DOM/game-renderer data.
- Networking: adapter around host-authoritative simulation.

Check milestone-level docs, CHANGELOG, migration notes, diagnostics, user-facing operational guidance. Flag problems + improvements.

## Step 4 — Validation gates

```bash
bash .github/skills/invariants/scripts/check-invariants.sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Any failure = blocking. Include relevant excerpt only.

## Step 5 — Classify findings

- **BLOCK** — must not ship: open required issues, missing roadmap scope, missing criteria, failing gates, invariant violations, security, broken module boundaries, determinism violations, `GameSnapshot` leakage, unvalidated IPC, missing required tests, broken cross-feature workflows.
- **WARNING** — ship only with explicit risk acceptance.
- **IMPROVEMENT** — non-blocking.

Evaluate at minimum: roadmap completion; feature/task completion; per-feature criteria coverage; cross-feature integration + regression risk; arch alignment + module ownership; determinism + Appendix B; IPC/networking/trust; renderer state + React/R3F (if UI); coverage at unit/integration/e2e; perf + diagnostics; docs/changelog/migration.

## Step 6 — Report

```markdown
# Milestone Readiness Review — <title>

## Verdict

<READY | NOT READY | READY WITH WARNINGS>

Decision: <one paragraph>

## Scope Reviewed

- Milestone: <title or designator>
- Main commit: <short-sha> <subject>
- Feature issues: <N> Task issues: <N> Open required: <N>

## Gate Results

| Gate       | Result    | Notes |
| ---------- | --------- | ----- |
| Invariants | PASS/FAIL | …     |
| Format     | PASS/FAIL | …     |
| Lint       | PASS/FAIL | …     |
| Typecheck  | PASS/FAIL | …     |
| Tests      | PASS/FAIL | …     |

## Feature Readiness Matrix

| Feature | Issue | Tasks (done/total) | Evidence on main   | Status            | Notes |
| ------- | ----- | ------------------ | ------------------ | ----------------- | ----- |
| <…>     | #<N>  | <m/n>              | <files/tests/docs> | PASS/PARTIAL/FAIL | …     |

## Milestone-Level Findings

### Blocking (<N>)

**[BLOCK-1] <title>**
Area: <Scope | Architecture | Tests | Security | Determinism | IPC | Networking | Renderer | Performance | Docs | Integration>
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

**READY** ⇔ every required feature ready AND all required issues closed/demonstrably complete on `main` AND all gates pass AND zero blocking findings.
