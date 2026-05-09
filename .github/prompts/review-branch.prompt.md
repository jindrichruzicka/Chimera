---
description: 'Review the current branch for merge readiness. Emits findings report, does NOT merge. Usage: /review-branch'
---

Load [Chimera Code Reviewer](../agents/chimera-code-reviewer.agent.md) and execute its full review procedure against the current branch.

The reviewer agent is the source of truth for source docs, invariant checks, quality dimensions, and report format.

**Do NOT run the merge script.** After emitting the report, stop and wait for explicit merge approval from the user. Indicate clearly at the end of the report whether the branch is merge-ready and remind the user to reply with approval to proceed.
