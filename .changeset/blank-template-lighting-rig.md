---
'create-chimera-game': patch
---

Light the blank template's playfield with the engine's `LightingRig`.

A freshly scaffolded game's playfield now mounts a `GameCanvas` on the `top-down` preset with
`<LightingRig />` inside it, behind the existing welcome panel. The comment beside the rig explains
why it is there, that it must stay a child of `GameCanvas`, and that lights of your own can be
added beside it.

The template's playfield test stands the r3f barrel in with a mock, because react-three-fiber's
canvas throws under jsdom, and asserts the rig is mounted inside the canvas.
