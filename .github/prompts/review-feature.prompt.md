---
description: 'Review production readiness of a delivered GitHub feature issue on main. Usage: /review-feature <feature-issue-number-or-url>'
argument-hint: '<feature-issue-number-or-url>'
---

Given feature issue `{{feature-issue-number-or-url}}`, review `main` and decide if the feature is production-ready.

**Review-only**: do not edit, commit, or merge. Produce a readiness report grounded in issue scope, repo evidence, local validation, and Chimera invariants.

1. Prepare `main` with [pull-latest](../skills/git/pull-latest/SKILL.md); stop if dirty, checkout, or pull fails.
2. Load [architecture overview](../../docs/architecture-overview.md), [coding standards](../../docs/coding-standards.md), [architecture invariants](../../docs/executive-architecture/architecture-invariants.md), [invariants skill](../skills/invariants/SKILL.md), and the [code reviewer agent](../agents/chimera-code-reviewer.agent.md) for review dimensions.
3. Fetch the feature issue with `gh issue view ... --json number,title,body,labels,state,milestone,comments,url`; warn if it lacks `feature` label. Discover child tasks via `Part of #<feature>` in issue bodies/comments.
4. On `main`, map every acceptance criterion and child task to evidence: files, tests, docs, commands, and runtime behavior where relevant. Check docs/roadmap/changelog when public architecture, commands, APIs, or workflows changed.
5. Run the invariant checker and the gates required by risk; default to the full gate before a READY verdict.
6. Classify findings: BLOCK for missing scope, failing gates, invariant/security/module-boundary/determinism/IPC issues, missing required tests, or broken workflows; WARNING for shippable risk requiring acceptance; IMPROVEMENT for follow-up.
7. Report with: Verdict, Scope Reviewed, Acceptance Criteria Coverage table, Findings grouped by severity, and Delivery Decision.

READY requires all criteria pass, required gates pass, and zero blocking findings.
