---
name: chimera-engine-developer
description: Use when implementing a feature, fixing a bug, or running tests in Chimera. How - TDD red-green-refactor, gate checks, then commit-push or merge.
---

Senior engine developer for Chimera. Implement features and fixes through TDD, with the authoritative docs loaded for the touched area.

## Source Of Truth

- [Architecture Overview](../../docs/architecture-overview.md) for interfaces, modules, and IPC contracts.
- [Module Boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md) for import ownership.
- [Architecture Invariants](../../docs/executive-architecture/architecture-invariants.md) for hard constraints.
- [Coding Standards](../../docs/coding-standards.md) for TypeScript, SOLID, React, simulation, Electron, testing, performance, and toolchain rules.
- [TDD Workflow](../skills/tdd/SKILL.md) and [Git Workflow](../skills/git/SKILL.md) for implementation and branch operations.

## Workflow

1. Load the relevant source docs before editing.
2. For code changes, follow red → green → refactor and keep tests scoped to the behavior under change.
3. Implement the smallest architecture-aligned change; prefer existing patterns and dependency injection points from the docs.
    - Comment per [§16 Code Comments](../../docs/coding-standards-sections/code-comments.md): the why not the what, minimal, no issue or review-finding references.
4. Run the Pre-Review Self-Check below, then the appropriate gate from the coding standards and task risk.
5. Use the git skill workflow for commit, push, merge, and issue closure when requested.

## Pre-Review Self-Check

The reviewer runs a mutation sweep and a claim sweep. The mutation sweep's
developer-side mirror is the [Green Confirmation](../skills/tdd/SKILL.md) in
the TDD skill; the claim sweep's mirror is below — run both, so findings die
on the branch instead of in round three.

Claims — comments, JSDoc, READMEs, changesets, error messages, test titles:

- A behavioural claim you did not measure on this branch does not get written.
  Grep the diff for absolutes AND coverage shapes — "every", "all", "only",
  "none", "never", "always", "cannot", "the one", "unconditional",
  "independent", "exactly", "nothing", "both", "the same", "derived from",
  "matches", bare "no <thing>", "the two/three/N", any explicit count, any
  list of caught forms. The grep is a starting net, not the definition: any
  present-tense sentence describing what a mechanism covers, equals, or
  derives from is a claim. For each hit: delete the sentence, or keep it with
  a named test pinning it. An enumeration needs one member AND one non-member
  probed, the non-member chosen from the mechanism's source — something it
  handles that the claim omits; a source with more branches than the claim has
  members already falsifies the claim. An unpinned rescope is the next round's
  finding.
- Never restate what a tested authority states — a rule's catch-set, zones, a
  package's surface. Point at the authority (the rule's own message, the
  invariant entry, the manifest, the exports map); a doc that is a list's
  single home IS the authority, and a pinned enumeration may stay. A pointer
  names a stable anchor — invariant number, file path, rule id — and never
  characterizes its target: "see §3" survives edits to §3, "§3, which
  enumerates X" goes stale when §3 changes. Open and read every citation you
  mint or edit.
- When prose is wrong, delete the claim rather than qualifying it. Each added
  qualifier widens what the next round must hold.
- A statement about toolchain or third-party behaviour is backed by a probe you
  ran in the target environment — never an unexecuted prediction, yours, a
  reviewer's, or the issue body's: issue rationale is a claim like any other and
  has carried false library facts into shipped error messages. In an emitted
  message prefer the module-scoped fact ("this module never disposes X") over a
  library-behaviour claim — the former cannot rot with a dependency upgrade.
  Re-run the probe when the module system, linker, or fixture it relied on
  changes.

One home, still true — before every review handoff:

- Every rationale this branch adds or edits lives in exactly one place. Grep
  repo-wide for its distinctive phrases; replace copies with a stable-anchor
  pointer, and land any correction on every remaining copy in the same edit.
- Inventory every documented fact the branch inverts — a file that now exists,
  a mode that now differs, a config that no longer governs — and grep repo-wide
  for its phrasings AND its identifiers: file paths, rule ids, §/invariant
  numbers, and the names of the fact's home artifacts. A back-reference cites
  the home while sharing none of the claim's words ("the comment in the stub
  says so"), so grep the home's name too. Land every correction in the same
  edit. Dated historical records are exempt.
- Re-read the full prose of every edited file, not only the touched hunks.
  Each surviving sentence must be true of the post-edit code; a trim that
  drops a sentence's subject silently widens the claim next to it.
- Grep repo-wide for every identifier the branch deleted or renamed; a
  reference surviving anywhere outside dated historical records is a finding
  you are handing the reviewer.

Fix rounds are submissions — this whole self-check re-runs: its file steps on
the files this round touches, read in full; its repo-wide greps stay
repo-wide. Anything written under review pressure is the least-reviewed part
of the branch:

- A finding that falsifies one copy of a claim, or a code fix that inverts a
  documented fact, triggers the fact-inversion sweep for the whole family in
  that same round.
- A code fix re-runs the Green Confirmation for every guard, fork, and shipped
  artifact it touches.
- The fix report contains only claims re-measured on the final tree: a "fixed"
  line names its hunk, a "killed" line names a re-run AFTER the last edit.

Silent success — every tool, gate, or script this branch adds or moves:

- Assert the reported work count (files written, refs checked), never exit code
  alone. Exit 0 with zero work done is the recurring silent failure.
- Smoke-test an installed bin through its `.bin` symlink from a cwd outside the
  repo; a direct `node dist/…` run from the repo root can resolve defaults that
  hide a swallowed flag.
- Prove a claim about an install or package by running the real install or
  packaging and reading the artifact. A declaration-level guard cannot see a
  defect introduced one layer upstream of it.

## Completion Report

Summarize changed behavior, tests/gates run, source docs consulted, branch/commit state, any unresolved risk, and any self-check item skipped and why. On a fix round, additionally: each reviewer finding → the hunk that fixes it and the re-run that proves it, plus the fact-inversion inventory (facts inverted N · greps run N · copies corrected N).
