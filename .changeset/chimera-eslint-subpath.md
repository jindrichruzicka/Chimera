---
'@chimera-engine/electron': minor
---

Publish the seven Chimera architecture-lint rules at a new
`@chimera-engine/electron/eslint` subpath. Until now they lived in the repo-root
`tools/` package, which is never published, so a game that left the monorepo lost every
architectural guardrail: a `fromFloat()` in a reducer (Invariant #76), a hardcoded hex in
a screen (Invariants #86/#91), an undeclared `--ch-*` token override (Invariant #85) or a
deep reach past the renderer's public barrels (Invariant #96) all went unflagged.

The rules now live at `electron/dev-tools/eslint/`, compile to
`dist/dev-tools/eslint/**` under electron's own build, and are exported as a plugin
object named `chimeraPlugin`. It ships **no bin**: a flat config imports the plugin,
nothing spawns it.

```js
import { chimeraPlugin } from '@chimera-engine/electron/eslint';
// then, in a flat config block:
{ plugins: { chimera: chimeraPlugin }, rules: { 'chimera/no-fromfloat-in-simulation': 'error' } }
```

The monorepo's own root config now loads that same compiled artifact, so the engine and
its consumers enforce identical code from one file rather than two. That retires a CJS
bridge which registered `tsx` and `require`d the rules' TypeScript at lint time — nothing
transpiles during a lint run any more. The trade is a build-order dependency: the config
resolves `electron/dist`, so a lint run against an unbuilt package fails loudly, naming
the missing `dist` file and the config that imported it. The root `lint` script and both
CI lint steps already build first.

One rule needed repairing to survive the move. `no-unknown-token-overrides` read its base
token set by walking three directories up from its own module URL — an expression that
happened to land on the repo root at the old location, would have landed inside
`electron/` at the new one, and lands nowhere a consumer has from inside an installed
`dist/`. It now resolves the published
`@chimera-engine/renderer/styles/tokens.css` subpath, so the monorepo and a standalone
install read the same token set by the same route, and the base-token path is injectable
so the rule's own tests need no renderer build.

`eslint` is declared as an **optional** peer dependency, matching the posture of
`electron` and `sharp`: the edge is type-only and lint-only, and nothing in
the runtime surface (`./main`, `./preload/*`, `./packaged-bundle`) touches it.

The games-facing preset that composes these rules onto a game's own flat zones is not
part of this release; only the plugin object is exported so far.
