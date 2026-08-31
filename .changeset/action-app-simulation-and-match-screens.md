---
'@chimera-engine/action': patch
---

Add `apps/action` — the engine's second reference consumer, and its FIRST realtime one.

The app skeleton mirrors `apps/tactics` (manifest, asset manifest, settings schema, `simulation/`,
`screens/`, `components/`, `renderer/{register,loaders,next.config,app/**}`,
`electron/{main,build-main}`, `styles/`, `dev/` fixtures) and carries a deliberately minimal
surface: no cursor, no logo screen, no icon override, no languages, no spectators, no lobby setup,
no AI, no content collections. Every one of those is a capability the host branches on, so
declaring one empty would announce something the app has not built; the shell task adds the
menu-facing half.

**Realtime is the point.** `realtime: true` with `tickRateMs: 100` is what makes the host arm a
`RealtimeTicker`, and the simulation's per-beat movement pass rides the resulting `engine:tick`
through the game definition's `onBeat` hook — no clock, no RNG, no dispatch inside it, so a recorded
beat sequence replays to the same state (Invariants #43/#70). `__tests__/realtime-beat.test.ts`
joins the three links (manifest → `resolveTickerHz` → `ActionPipeline.process('engine:tick')` →
`onBeat`) so a movement pass registered under the wrong game id fails there rather than as a match
that renders and never moves.

**Positions are INTEGERS, not `FixedPoint`, and that was measured rather than assumed.** A primitive
advances whole arena cells per beat, so the simulation carries no fractional gameplay quantity and
Invariant #75 is not engaged. It could not be satisfied here anyway: the engine's save path is
`JsonSaveSerializer`, whose `JSON.stringify` throws on a `bigint` and whose `deserialize` has no
reviver that could return one — a `FixedPoint` position would make the app unsavable, which the
HUD's save affordance and F88's autosave/Continue flow both depend on.
`actions.test.ts` pins the round trip in both directions.

Two actions, both with real validation branches: `action:set-velocity { dx, dy ∈ -1|0|1 }` writes a
standing order onto the primitive the acting seat owns (rejected outright when the seat owns none),
and `action:select-primitive { entityId }` claims one exclusively — rejecting an unknown id, the
ground plane, and a primitive another seat drives — releasing and STOPPING whatever the seat drove
before, so an abandoned primitive cannot coast on with nobody at the controls. Ownership lives on
the entity rather than in a per-player field, so the renderer's selection colouring and the
reducer's authority read one value.

`ActionPlayfield` mounts one `GameCanvas role="main"` on the `top-down` preset and turns arrow keys
into velocity through a HELD-SET model: the input layer dispatches on key down and key up, both axes
sum and clamp independently (Left+Right cancels while a held Down keeps moving), and an action is
sent only when the derived velocity CHANGES — a screen that dispatched per snapshot would fire ten
identical actions a second at this heartbeat.

Workspace wiring: `tsc -b` solution reference, `typecheck` entry, vitest source resolution and
coverage, changeset-policy graph, and the game-app import bans in `eslint.config.mjs` — which now
name `@chimera-engine/action` alongside `@chimera-engine/tactics`, so neither game's gameplay tree
can reach the other's. `pnpm verify:packaged-bundle` verifies BOTH apps and reports both before
deciding its exit code; its guard discovers every `apps/<game>` with an Electron composition root and
fails when the driver's list misses one, because an unverified app is one whose app-owned
`build:app` or `electron-builder.yml` can reship the debug layer with the gate green.
