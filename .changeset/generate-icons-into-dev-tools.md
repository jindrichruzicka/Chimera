---
'@chimera-engine/electron': patch
---

Relocate the deterministic platform icon-set generator — the tool that derives the whole
`.icns`/`.ico`/loose-PNG set, and the `chimera.png` runtime window-icon default, from a
single square master logo — out of the never-published repo-root `tools/` and into
`electron/dev-tools/generate-icons/`, joining the dev multiplayer harness, the
Google-Fonts downloader and the asset-reference validator in the shared home for
development-time CLIs a standalone scaffolded game must be able to run.

No public surface changes yet: there is no bin, and the monorepo entry point is still
`pnpm icons:generate` under its unchanged script name — only the path it runs moved. The
tool's logic is untouched apart from re-deriving its repo root for the deeper directory,
so a default run writes a byte-identical set into `electron/assets/icons`.

The move does change what the package declares. `sharp` (a multi-megabyte
platform-specific native binary) is the generator's codec; inside repo-root `tools/` that
import was never published and resolved through root-devDep hoisting, while inside this
package the module is emitted to `dist/` and shipped by `files: ["dist"]`, so
`verify:publish`'s depcheck reads it as an undeclared runtime dep. It is now declared as
an **optional peer dependency** rather than a `dependencies` entry: pnpm
and npm do not install a missing optional peer, so a game install declares no codec and
carries no native binary it never runs. Nothing consumes it yet — the generator is not
exposed as a bin in this release, and the monorepo's own `pnpm icons:generate` resolves
it from root devDependencies exactly as before.
