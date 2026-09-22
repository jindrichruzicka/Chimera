---
'@chimera-engine/renderer': minor
---

Add `useShaderTime`, a shader time uniform that follows engine time.

A shader that animates needs a time uniform, and the hand-rolled version — accumulate the frame
delta, or read the R3F clock — works until the player enables slow motion, at which point it runs at
full speed while everything around it crawls. `useShaderTime()` returns a `ShaderTimeUniform`
(`{ value: number }`, structurally `three`'s `IUniform<number>`) whose value advances by the frame
delta multiplied by the authoritative time scale, so a shader dilates with the match with no
per-call-site wiring. It is cap-independent: a 30 fps game and a 144 fps one reach the same value.

The object identity is stable for the life of the mount, and the material must hold that very
object: the hook advances `value` in the frame loop and never re-renders. Seat it in a
`ShaderMaterial`'s constructor and hand the instance over as
`<primitive object={material} attach="material" />`; declaring `uniforms` as a JSX prop does not
work, because r3f stores a shallow copy of a uniform the material does not already carry. Both ship
from the `components/r3f` barrel.
