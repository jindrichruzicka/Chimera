---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': patch
---

Generalise the structural snapshot differ, and add the after-only form of a diff.

`diffSnapshots` moves from `simulation/debug/SnapshotDiff.ts` to the contract leaf at
`simulation/foundation/snapshot-diff.ts`, with its constraint relaxed from `TState extends
BaseGameSnapshot` to `TState extends { tick: number }`. A projected `PlayerSnapshot` carries no
`seed` and no `timers` by design (Invariant #3), so the old constraint admitted one only through a
cast — and the cast erased exactly the distinction the invariant rests on. Nothing about the diff's
behaviour changed, and `@chimera-engine/simulation/debug` re-exports `diffSnapshots`, `DiffEntry`
and `SnapshotDiff` from the new location, so that public subpath still carries them — see
`simulation/debug/index.test.ts`.

`simulation/foundation/snapshot-delta.ts` is new. `toSnapshotDelta` projects a diff onto its
after-only form: a `DiffEntry` carries `before` as well as `after`, which is right for an inspector
showing both sides and wrong for anything that has to fit in a frame, where repeating the old value
can make the delta larger than the snapshot it replaces. `applySnapshotDelta` is the other half — it
reproduces the new snapshot from the old one, copying only the containers along a changed path and
sharing the rest by reference. Where it refuses, it answers `null` rather than writing partially.
What it refuses, and why each refusal matters, is the `rejects a delta it cannot apply` block of
`simulation/foundation/snapshot-delta.test.ts`.

`@chimera-engine/electron` takes a comment-only change: the packaged-bundle marker file names the
differ's path in its rationale for excluding `diffSnapshots` from the marker set.
