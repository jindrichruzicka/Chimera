---
'create-chimera-game': minor
---

A scaffolded game now enforces Chimera's architecture invariants on day one.

Until now a new game shipped no ESLint config at all, so its own `lint` script was a hard
error and every `chimera/*` rule was lost the moment the game left the monorepo — a
`fromFloat()` in a reducer or a hardcoded hex in a screen went unflagged. The template now
emits an `eslint.config.mjs` composing `standaloneLintConfig()` from
`@chimera-engine/electron/eslint`, a `styles/tokens-override.css` stub under the path the
token rule guards, a screen `*.module.css` the playfield actually uses, and a project-root `lint` script forwarding to the app — joining the four
dev-tool forwards, for a different reason: `eslint`'s bin is already at the root, but the
config that drives it lives in the app.

Five rules are live from the first commit: `fromFloat()` out of `simulation/` and `ai/`
(with test files exempt, so a fixture builder does not red), design values through
`var(--ch-*)` tokens in `screens/` and its CSS modules, only engine-declared tokens in the
override stylesheet, the renderer's public barrels only, and no raw r3f `<Canvas>`
(`GameCanvas` is the only canvas root a game mounts).

The config is emitted for a **standalone** project only. A `--workspace` game inherits the
monorepo's root config, which is the stricter of the two; a file in the app directory would
resolve before it and not merge with it, so shipping one there would have taken the
`no-restricted-syntax` determinism guard, the import boundaries, `no-console` on the
composition root and the type-checked TypeScript set away from a game living inside the
repo — under `pnpm -r lint` and in CI, both of which run `eslint .` from each package
directory.

The stub overrides the accent family — base, hover and strong together, because different
components read different members of it and moving one alone themes some of the UI and not
the rest. It is meant to be edited; it is not
meant to be deleted, since the token rule matches that file by name.

The ESLint VS Code extension is now recommended, and every doc-comment claiming the scaffold
ships no eslint config is corrected.

Type-aware linting is deliberately off: no Chimera rule reads type information, and
`parserOptions.projectService` reds a fresh scaffold on `electron/main.ts`,
`electron/build-main.ts`, `electron/verify-packaged-bundle.ts` and the config itself — all
outside the app's TypeScript program. The config says what to add to turn it on.

`verify:scaffold` now proves both halves against an installed project: the untouched
scaffold lints green, and a planted violation of every curated rule — including both arms of
the design-value rule — is reported by its own rule id in its own file.
