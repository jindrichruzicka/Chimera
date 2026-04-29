---
description: 'Review the current branch for merge readiness. Emits findings report, does NOT merge. Usage: /review-branch'
---

Load `.github/agents/chimera-code-reviewer.agent.md` and execute its full review procedure against the current branch.

The procedure covers:

1. **Step 0** — Load `docs/architecture-overview.md` and `docs/coding-standards.md`; identify branch and diff vs `main`
2. **Step 1** — Architecture alignment
3. **Step 2** — Module boundary enforcement
4. **Step 3** — SOLID principles
5. **Step 4** — TypeScript standards
6. **Step 5** — React and R3F standards
7. **Step 6** — Simulation determinism invariants (run `bash .github/skills/invariants/scripts/check-invariants.sh`)
8. **Step 7** — Security
9. **Step 8** — Performance

Emit the findings report in the format defined in the agent.

**Do NOT run the merge script.** After emitting the report, stop and wait for explicit merge approval from the user. Indicate clearly at the end of the report whether the branch is merge-ready and remind the user to reply with approval to proceed.
