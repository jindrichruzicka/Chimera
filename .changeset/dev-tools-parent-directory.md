---
'@chimera-engine/electron': patch
---

Relocate the dev multiplayer harness into a new `electron/dev-tools/` parent directory, the
shared home for development-time CLIs that a standalone scaffolded game must be able to run
— which is why they live inside this published package rather than the never-published repo
root `tools/`.

No public surface changes: the bin is still `chimera-dev-mp` and the library subpath is still
`@chimera-engine/electron/dev-harness`, both of which a scaffolded app's `dev:mp` script
depends on. Only the `dist/` targets moved (`dist/dev-tools/dev-harness/…`), so consumers
need nothing beyond the install that re-links the bin. The package's exports-contract test
now resolves every declared bin/export target against the built `dist/`, so a target left
pointing at a moved file fails the fast gate rather than surviving to `verify:pack`.
