---
'@chimera-engine/electron': minor
---

Widen the published glTF test-support reader to the animation surface, and prove the clip-player
end to end from a real game with real content.

`@chimera-engine/electron/test-support` gains `GltfAnimation`, `GltfAnimationChannel` and
`GltfAnimationSampler`, and `GltfDocument.animations` is now `readonly GltfAnimation[]` instead of
`readonly GltfNamed[]`. TYPES ONLY — `readGlbDocument` ends with `return parsed as GltfDocument`
over the raw glTF JSON, so the parser is unchanged. Every field stays OPTIONAL because the reader
casts unvalidated JSON: a required field would be a type-level lie for exactly the malformed
container `MalformedAssetFileError` exists to make loud, and a caller mapping over a malformed
animation's `samplers` gets `undefined` to handle rather than a TypeError naming no file.

What the widening buys is the one number a clip sheet claims and no build gate checks. A sheet
names a clip, a length and positions inside it; `validate-assets` checks the sheet is
self-consistent and that the file exists, and `compileAnimationWindows` checks the authored beat
window against the authored phases. All three read the SHEET. None opens the model — so a
re-export that renamed the clip or shortened it leaves every gate green and the marker firing at
the wrong instant. The clip's real length lives at `accessors[sampler.input].max[0]`, the one
place outside `POSITION` where glTF requires an accessor to declare its bounds, and reading it is
now possible.

The reference game adopts the surface on its existing `/model-showcase/` test route, against a
GENERATED fixture: `tools/gen-showcase-animated-glb.ts` emits `showcase-rig-animated.glb` from
readable source numbers, `pnpm gen:showcase-glb` writes it and `pnpm verify:showcase-glb` fails if
the committed bytes are not the generator's output. A `.glb` cannot be diffed, grepped or
reviewed, so a comment claiming what one contains is unfalsifiable; a program that emits it is
not. Every quaternion component in that generator is an authored decimal literal rather than a
`Math.sin` call, and every keyframe time is exactly representable in float32 — ECMAScript leaves
`Math.sin` implementation-defined, and at a 0.3 s spacing the accessor's `max` reads back as
`1.2000000476837158`, a number no manifest can author.

No engine runtime behaviour changes: the additions are types, a dev tool and a reference-game
adoption.
