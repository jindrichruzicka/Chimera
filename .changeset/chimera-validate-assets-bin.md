---
'@chimera-engine/electron': minor
---

Add the `chimera-validate-assets` bin — the asset-reference validator behind Invariants
#22/#52/#97/#125 is now runnable from a standalone scaffolded game, not just via the
monorepo `pnpm validate:assets` script. The tool ships as pre-built node ESM at
`dist/dev-tools/validate-assets/index.js` (chimera-dev-mp precedent), with a
`#!/usr/bin/env node` shebang — legal module syntax that `tsc` emits unchanged and node
ignores under every loader, so the monorepo `pnpm validate:assets` form keeps working.

Its CLI entry guard is now the shared dev-harness `isDirectInvocation` rather than a
local copy. The local copy compared `import.meta.url` against a raw `process.argv[1]`,
and a pnpm bin shim execs node with the path THROUGH the `node_modules` symlink while
node realpaths the main module — so the comparison never matched and the bin exited 0
having written nothing. For a validator that failure is invisible: a run that checked
zero refs is indistinguishable from a clean tree. The shared implementation
canonicalises both sides.
