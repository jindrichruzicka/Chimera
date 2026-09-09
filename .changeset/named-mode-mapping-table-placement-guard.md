---
'@chimera-engine/renderer': patch
---

Guard that a named-mode mapping table stays off the shell layout graph.

The tone-mapping and output-colour-space knobs each need an engine-name → `three`-constant table,
and the sampling and blending modes still to come will need more. Nothing the always-mounted shell
layout chunk reaches through a static **value** edge may name `three`, so where those tables live is
a real constraint — and until now it was enforced only by a census that could itself go blunt
without anyone noticing. A census whose predicate silently stopped matching goes on passing, and a
shrunken graph passes for the wrong reason.

`named-mode-mapping-table-placement.test.ts` keeps it sharp. It runs the real walk from each
consumer app's real layout with **one real module's source overlaid** by that same source plus a
`three` import — exactly what moving a mapping table into a module the layout reaches would do — and
asserts the census reports it by that module's name. Three arms, because the property has three
defeatable halves: a value import is reported, the same module unmutated reports nothing (so the
report is caused by the mutation rather than by something already there), and a `type`-only import
is not reported. A fourth pins that the overlaid module is on the graph at all, since an overlay of
a module the walk never visits would prove nothing.

The guard mutates a **file system**, never the tree, so it needs no manual step and leaves nothing
to restore — a standing check rather than a measurement recorded once in a comment. The census
itself is untouched: it is not amended or relaxed to accommodate the new tables.

`camera-system.md` records the constraint, the two compliant shapes (off the graph entirely, as
`rendererConfig.ts` is; or behind a dynamic edge, as `AssetManager.ts` reaches `TextureLoader`), and
the `type`-only exception, alongside the guard above.
