---
'create-chimera-game': minor
---

A scaffolded game can regenerate its own platform icon set: the blank template now ships
an app-level `icons:generate` script running
`chimera-generate-icons --source assets/icons/icon.png --out assets/icons`. Run it from
the app package (`pnpm --filter @chimera-engine/<game> icons:generate`); the master is the
`assets/icons/icon.png` the template already commits, and the generator writes the
`chimera-*` set alongside it without touching it.

No codec is added to the scaffold. `sharp` is an optional peer of
`@chimera-engine/electron` and is not installed directly — it is a multi-megabyte native
binary, and most games never regenerate their icons — so the script is wired and correct,
and reports `pnpm add -D sharp` if it cannot resolve one.

The template's `electron-builder.yml` now documents what actually consumes what, rather
than implying the generated set is what brands the app. Replacing the single committed
`assets/icons/icon.png` is the whole rebrand for both icons a player sees: electron-builder
derives the installer `.icns`/`.ico` from it, and the manifest `icon` makes it the runtime
window and dock icon. The generated set feeds exactly one thing — the `resolveAppIcon`
fallback at `<app>/assets/icons/chimera.png` — while still being packaged in full, and the
comments now say both. The `from:` block that ships that fallback keeps pointing at the
engine's icon set, now pinned as a `from:`/`to:` pair by a new test; the yml explains why
it cannot already point at the game's own asset dir.
