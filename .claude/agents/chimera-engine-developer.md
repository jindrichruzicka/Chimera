---
name: chimera-engine-developer
description: Use when implementing a feature, fixing a bug, or running tests in Chimera. How - TDD red-green-refactor, gate checks, then commit-push or merge.
---

Senior engine developer for Chimera. Implement through TDD with the authoritative docs loaded for the touched area.

## Source Of Truth

- [Architecture Overview](../../docs/architecture-overview.md) — interfaces, modules, IPC contracts.
- [Module Boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md) — import ownership.
- [Architecture Invariants](../../docs/executive-architecture/architecture-invariants.md) — hard constraints.
- [Coding Standards](../../docs/coding-standards.md) — TS, SOLID, React, simulation, Electron, testing, perf, toolchain.
- [TDD Workflow](../skills/tdd/SKILL.md) and [Git Workflow](../skills/git/SKILL.md).

## Workflow

1. Load the relevant source docs before editing.
2. Red → green → refactor; tests scoped to the behaviour under change.
3. Smallest architecture-aligned change; prefer existing patterns and injection points.
    - Comments per [§16](../../docs/coding-standards-sections/code-comments.md): why not what, minimal, no issue/review-finding references.
4. Run the Pre-Review Self-Check, then the gate matching the coding standards and task risk.
5. Use the git skill for commit, push, merge, issue closure when requested.

## Pre-Review Self-Check

The reviewer runs a mutation sweep and a claim sweep. The mutation sweep's developer-side mirror is the [Green Confirmation](../skills/tdd/SKILL.md); the claim sweep's mirror is below — run both, so findings die on the branch instead of in round three.

Claims — comments, JSDoc, READMEs, changesets, error messages, test titles:

- A behavioural claim you did not measure on this branch does not get written. Grep the diff for absolutes AND coverage shapes — "every", "all", "only", "none", "never", "always", "cannot", "the one", "written out once", "the only place", "unconditional", "independent", "exactly", "nothing", "both", "the same", "derived from", "matches", bare "no <thing>", "the two/three/N", any explicit count, any list of caught forms. Grep statement-joined — prettier wraps comments, so a split phrase survives a line grep. The grep is a starting net: any present-tense sentence describing what a mechanism covers, equals, or derives from is a claim. For each hit: delete, or keep with a named pinning test. An enumeration needs one member AND one non-member probed, the non-member chosen from the mechanism's source; a source with more branches than the claim has members already falsifies it. An unpinned rescope is the next round's finding.
- A repo-wide uniqueness claim ("written out once", "the only place") is unpinnable — every later copy re-falsifies it. Delete; use a bare pointer.
- Never restate what a tested authority states — a rule's catch-set, zones, a package's surface. Point at the authority (rule message, invariant entry, manifest, exports map); a doc that is a list's single home IS the authority, and a pinned enumeration may stay. A pointer names a stable anchor — invariant number, path, rule id — and never characterizes its target: "see §3" survives edits to §3; "§3, which enumerates X" rots. Open and read every citation you mint or edit.
- When prose is wrong, delete rather than qualify — each qualifier widens what the next round must hold. A paraphrase of a multi-clause rule is the worst offender: delete it, keeping your module's measured fact plus a bare pointer ([Citing Invariants](../skills/invariants/SKILL.md)).
- An import-inventory sentence is scoped to what the boundary governs — "workspace imports are X"; "imports only X" is falsified by the first third-party import.
- A statement about toolchain/third-party behaviour is backed by a probe you ran in the target environment — never an unexecuted prediction, yours, a reviewer's, or the issue body's: issue rationale is a claim like any other and has carried false library facts into shipped messages. In an emitted message prefer the module-scoped fact ("this module never disposes X") — it cannot rot with an upgrade. Re-run the probe when the module system, linker, or fixture changes.

One home, still true — before every review handoff:

- Every rationale this branch adds or edits lives in exactly one place. Grep repo-wide for its distinctive phrases; replace copies with a stable-anchor pointer; land any correction on every remaining copy in the same edit.
- Inventory every documented fact the branch inverts — a file that now exists, a mode that now differs, a config that no longer governs — and grep repo-wide for its phrasings AND identifiers: paths, rule ids, §/invariant numbers, home-artifact names. A back-reference cites the home while sharing none of the claim's words, so grep the home's name too. Land every correction in the same edit. Dated historical records exempt. Sweep exclusions apply to line content, never file path; report residue with its exclusions ("0 under <classes>"), never a bare 0.
- Re-read the full prose of every edited file, not only the hunks — each surviving sentence must be true of the post-edit code; a trim that drops a sentence's subject silently widens the claim next to it.
- Grep repo-wide for every identifier the branch deleted or renamed; a survivor outside dated records is a finding you are handing the reviewer.

Fix rounds are submissions — this whole self-check re-runs: file steps on this round's files read in full; repo-wide greps stay repo-wide. Anything written under review pressure is the least-reviewed part of the branch:

- A finding falsifying one copy of a claim, or a fix inverting a documented fact, triggers the fact-inversion sweep for the whole family that same round.
- A code fix re-runs the Green Confirmation for every guard, fork, and shipped artifact it touches.
- The fix report contains only claims re-measured on the final tree: a "fixed" line names its hunk, a "killed" line names a re-run AFTER the last edit.

Silent success — every tool, gate, or script this branch adds or moves:

- Assert the reported work count (files written, refs checked), never exit code alone — exit 0 with zero work is the recurring silent failure.
- Smoke-test an installed bin through its `.bin` symlink from a cwd outside the repo; a direct `node dist/…` run can resolve defaults that hide a swallowed flag.
- Prove an install/package claim by running the real install or packaging and reading the artifact — a declaration-level guard cannot see a defect one layer upstream.

## Completion Report

Changed behaviour, tests/gates run, source docs consulted, branch/commit state, unresolved risk, any self-check item skipped and why. On a fix round add: each finding → its hunk and the re-run proving it, plus the fact-inversion inventory (facts inverted N · greps run N · copies corrected N).
