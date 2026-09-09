---
'@chimera-engine/renderer': patch
---

Expose the WebGL context options on `GameCanvas` as a distinct, frozen prop shape.

`GameCanvasProps` gains `contextOptions` — `antialias`, `alpha`, `powerPreference`, `stencil`,
`preserveDrawingBuffer` — and the r3f barrel publishes `WebGLContextOptions` and its
`PowerPreference` as types. It is a nested object rather than flat props, and that shape IS the
contract: everything beside it can still move, everything inside it cannot. WebGL context attributes
are fixed when the context is built, so a value written afterwards cannot take effect.

What the separation is worth at the type level is bounded, and the docs say so: TypeScript's
excess-property check bites a fresh object literal, so a widened variable or a spread reaches
through either way. The literal case is measured in both directions — a mutable knob inside
`contextOptions`, and a context option as a flat prop — each with its own `@ts-expect-error` pin. A
raw `gl={…}` pass-through remains rejected: this task exposes curated context options, not the
coupling shape Invariant #127 bans from game files.

A change after mount is REFUSED, not ignored, because silently disregarding it is the failure this
shape exists to prevent. The canvas keeps the values it mounted with and names the differing keys
through the renderer logger as `ContextOptionsAfterMountError` — logged, not thrown, the way a
duplicate `role="main"` canvas is. The comparison is by value, so a game writing its options inline
(a fresh object every render) reports nothing; a key that is DROPPED counts as a change, since `{}`
asks for r3f's default where the mount asked for something else. To build a context with different
attributes, remount the canvas under a new React `key`.

`camera-system.md` records what stays unexposed — r3f's `legacy`, `linear`, `flat`, `orthographic`,
`performance`, `raycaster`, `scene`, `events`, `onCreated` and `size` — so the omission does not read
as an oversight to the next reader.

The key list the drift comparison walks is derived from a `Record<keyof WebGLContextOptions, true>`
rather than written as a tuple. A `satisfies readonly (keyof …)[]` checks membership only, so a
sixth option added to the type and forgotten in the list would compile and be silently uncompared;
the record makes a missing key TS2741 and an extra one TS2353.
