---
'@chimera-engine/electron': minor
---

Gate animation clip sheets at build time. `validate-assets` gains an `invalidAnimationSheets`
bucket that mirrors `invalidCueSheets` at every site — the report type, the collector, the sort,
the all-clear conjunction, the printer and the exit code — so a malformed sheet on a
`'gltf-model'` or `'sprite-sheet'` manifest entry fails CI rather than degrading silently at
runtime. `AssetValidationReport` gains the `invalidAnimationSheets` field and the module exports
the `InvalidAnimationSheet` type.

Every rule is SHEET SELF-CONSISTENCY — a property of the authored literal alone, needing no
atlas, no glTF and no `tickRateMs` — so the gate adds no blind spot the walker did not already
have. Its behaviour is exercised by `describe('animation clip sheet validation')` in
`electron/dev-tools/validate-assets/index.test.ts`.

The renderer's readers — `renderer/assets/animationSheet.ts` and
`renderer/animation/ClipPosition.ts` — apply their own predicates to runtime VALUES and degrade
fail-soft, dropping the unusable clip or mark; this reads SYNTAX NODES and fails the build.
The two read different things, so there is no implementation to share and neither rule list is
derived from the other. One consequence worth stating: a position outside `[0, 1]` is REFUSED
here where the runtime resolver clamps it, because a clamped mark fires somewhere the author
never wrote. A rule needing more than the sheet lives elsewhere — whether a `beatWindow` AGREES
with the span its `from`/`to` imply stays with `compileAnimationWindows` at content load, where
an unreadable `tickRateMs` cannot silently skip the check; whether a frame index addresses a
cell is the atlas's question, and the sheet does not name the atlas.

The manifest-entry walker now also peels `modelAnimationEntry({...})` and
`spriteAnimationEntry({...})`, alongside `audioClipEntry`, which it already peeled. Both new
builders bake their own `kind`, so before this an entry authored through EITHER of them read as
kindless — invisible not only to the new sheet gate but to the ref-existence check (#22) and the
declared-ref membership set (#52) as well. `manifestEntryBuilderKinds` is now the single peeled
set; a helper absent from it is still skipped, the blind spot the walker has always had.

An entry whose `kind` is readable and not one this gate claims is left alone, so a `'texture'`
carrying sheet-shaped metadata is untouched. An entry that hides BOTH its `kind` and its
`metadata` behind a spread or a computed key is unclassifiable and is reported by every gate that
could have been carrying a sheet on it — each saying what IT could not rule out.
