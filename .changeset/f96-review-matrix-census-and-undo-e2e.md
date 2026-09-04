---
'@chimera-engine/action': patch
---

Record what the action app's no-undo e2e cannot measure, and complete the traceability-matrix rows the
F96 arc touched.

`no-undo.spec.ts` was written as though its assertions witnessed the declared no-undo capability.
Neither does. The `undo` / `redo` control count reads zero whatever the manifest says: `ActionGameHud`
draws no undo pair under any declaration and the F96 arc changed nothing under `apps/action/screens/`,
so that assertion passed identically on the tree before it. The Ctrl+Z half kills only the full
conjunction of three withholdings, so reverting any one arm leaves the other two refusing.

The projected `undoMeta` was tried as the missing witness and is not one: with the refusing policy and
the withheld start-of-match memento BOTH reverted and rebuilt into the launched bundle, the seat still
reports `canUndo: false`, while a `canUndo: true` forced at the projector does reach the spec — so the
reading is live, the build is current, and something upstream of the declaration keeps this seat
ineligible regardless. No reading available at this seam separates an armed build from a withholding
one, so no assertion was added; the spec's docstring now states that, and points the per-arm kills at
the unit tests that own them.

The matrix carried F96 into the §4.5 and §4.28 rows and the M10 index row, leaving `F71–F92, F96` — a
census that skips three shipped M10 features. F93 (§4.5, §4.27, §4.28), F94 (§4.2.1, §4.28) and F95
(§4.5, §7) now have their rows, the index row reads `F71–F96`, and the preamble sentence that named F73
as the one feature carried without a roadmap heading names the whole set.
`tools/traceability-matrix.test.ts` deliberately does not assert this direction — a row may name a
feature with no heading — so that sentence is what records these as intended rather than missed.
