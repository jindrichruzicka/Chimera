---
'@chimera-engine/electron': patch
---

Relocate the asset-reference validator — the build-time gate behind Invariants #22/#52/#97/#125 —
out of the never-published repo-root `tools/` and into `electron/dev-tools/validate-assets/`,
joining the dev multiplayer harness and the Google-Fonts downloader in the shared home for
development-time CLIs a standalone scaffolded game must be able to run.

No public surface changes yet: there is no bin, and the monorepo entry point is still
`pnpm validate:assets` under its unchanged script name — only the path it runs moved. The
tool's logic is untouched, so it reports byte-identical output on the same tree.

The move does add one real dependency. The validator imports `createSourceFile`,
`forEachChild` and `isCallExpression` from `typescript` as runtime **values** for its
on-demand-load AST scan. Inside repo-root `tools/` that import was never published and
resolved through root-devDep hoisting; inside this package it is emitted to `dist/` and
shipped by `files: ["dist"]`, so `typescript` is now a declared runtime dependency rather
than a hoisting-masked one — without it, `verify:publish`'s depcheck reads the published
tarball as carrying an undeclared runtime dep.
