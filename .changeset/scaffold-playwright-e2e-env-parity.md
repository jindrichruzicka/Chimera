---
'create-chimera-game': patch
---

Fixed a standalone-scaffold e2e bug where Playwright runners that invoke the `playwright`
bin directly — the VS Code Test Explorer, `npx playwright test`, and the generated
`.vscode/launch.json` configs — bypassed the app's `test:e2e` npm script, the only place
`CHIMERA_VERIFY_PACK_NODE_MODULES` was set. Without that env, the e2e `global-setup`
re-added the monorepo-only `@chimera-engine/electron/main` esbuild alias, which does not
exist in a scaffold, so the build failed with "Could not resolve @chimera-engine/electron/main".
The scaffolded `e2e/playwright.config.ts` now self-sets
`process.env.CHIMERA_VERIFY_PACK_NODE_MODULES ??= 'node_modules'` at the top of the config,
which Playwright evaluates before `globalSetup` in the same process — so every runner resolves
the packed engine, not just the ones going through `test:e2e`. The rewrite throws if the
`defineConfig` marker drifts, failing loud instead of silently reintroducing the bug.
