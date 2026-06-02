---
description: 'Review production readiness of a delivered GitHub milestone on main. Usage - /review-milestone <milestone-designator-or-title>'
argument-hint: '<milestone-designator-or-title>'
---

Given milestone `$1`, review `main` and decide if the whole milestone is production-ready.

**Review-only**: do not edit, commit, or merge. Produce a milestone readiness report grounded in roadmap scope, GitHub state, repo evidence, local validation, and Chimera invariants.

1. Prepare `main` with [pull-latest](../skills/git/pull-latest/SKILL.md); stop if dirty, checkout, or pull fails.
2. Load [ROADMAP](../../docs/ROADMAP.md), [architecture overview](../../docs/architecture-overview.md), [coding standards](../../docs/coding-standards.md), [architecture invariants](../../docs/executive-architecture/architecture-invariants.md), [invariants skill](../skills/invariants/SKILL.md), and the [code reviewer agent](../agents/chimera-code-reviewer.md).
3. Resolve milestone scope via `gh issue list --repo jindrichruzicka/Chimera --milestone '$1' --state all --limit 200 --json number,title,state,labels,body,milestone,url`; if the designator is ambiguous, cross-check ROADMAP and GitHub milestones.
4. Group features, tasks, bugs, docs/infra, and child tasks linked by `Part of #<feature>`. Record roadmap gaps, open required issues, unlabeled issues, and orphan tasks.
5. On `main`, map each feature's criteria to evidence and inspect cross-feature integrations: shared state, IPC contracts, networking messages, persistence formats, settings, renderer stores, docs, changelog, diagnostics, and user-facing guidance.
6. Run the invariant checker and gates required by risk; default to the full gate before a READY verdict.
7. Classify findings: BLOCK for open/missing required scope, failing gates, invariant/security/module-boundary/determinism/IPC issues, missing required tests, or broken cross-feature workflows; WARNING for shippable risk; IMPROVEMENT for follow-up.
8. Report with: Verdict, Scope Reviewed, Feature Readiness Matrix, Milestone-Level Findings grouped by severity, and Delivery Decision.

READY requires every required feature ready, required issues closed or demonstrably complete on `main`, required gates pass, and zero blocking findings.
