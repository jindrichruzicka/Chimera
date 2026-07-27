---
'@chimera-engine/electron': minor
---

Add the `chimera-fetch-fonts` bin — the Google-Fonts self-hosting downloader (the
development-time tooling Invariant #97 sanctions) is now runnable from a standalone
scaffolded game, not just via the monorepo `pnpm fetch:fonts` script. The tool ships as
pre-built node ESM at `dist/dev-tools/fetch-google-fonts/index.js` (chimera-dev-mp
precedent) and gains optional `--out-dir` / `--src-prefix` flags whose defaults reproduce
the monorepo output byte-for-byte; a relative `--out-dir` resolves against the invocation
cwd, which is what lets an app-level script land the `.woff2` files in the game's own
`assets/fonts` directory. The emitted `GameFontFace.src` prefix is guarded to stay a
relative committed-asset reference — absolute, backslash-rooted, or scheme-prefixed
values are rejected before any download.
