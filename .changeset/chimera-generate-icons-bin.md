---
'@chimera-engine/electron': minor
---

Add the `chimera-generate-icons` bin — the platform icon-set generator is now runnable
from a standalone scaffolded game, not just via the monorepo `pnpm icons:generate`
script. The tool ships as pre-built node ESM at `dist/dev-tools/generate-icons/index.js`
(chimera-dev-mp precedent), with a `#!/usr/bin/env node` shebang — legal module syntax
that `tsc` emits unchanged and node ignores under every loader, so the monorepo form
keeps working.

Its CLI entry guard is the shared dev-harness `isDirectInvocation` rather than a local
copy. The local copy compared `import.meta.url` against a raw `process.argv[1]`, and a
pnpm bin shim execs node with the path THROUGH the `node_modules` symlink while node
realpaths the main module — so the comparison never matched and the bin exited 0 having
written nothing. Measured against the built artifact: through a symlink the naive guard
exits 0 with zero files written, the shared one writes all eleven.

The CLI also stopped deriving its default paths from its own module location. It now
resolves `--source`/`--out` defaults against the current working directory, matching
every sibling dev-tool: from the repo root — the cwd `pnpm icons:generate` runs with —
the engine-relative defaults resolve exactly as before, while a module-relative
derivation would have pointed the published bin at `docs/assets/` and `electron/assets/`
paths under the installed package, which no consumer has. Run bare where no master
exists, the bin now names both flags and exits non-zero instead of surfacing an ENOENT
on a path the caller never chose.
