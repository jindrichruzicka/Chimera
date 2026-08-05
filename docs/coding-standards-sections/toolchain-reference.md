---
title: 'Chimera Coding Standards — §15 Toolchain Reference'
description: 'Package manager (pnpm), common scripts, path aliases, and Vitest configuration for the Chimera engine.'
tags: [toolchain, pnpm, vitest, scripts, path-aliases, tsconfig, coding-standards]
---

# §15 Toolchain Reference

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 15.1 Package manager

`pnpm` is the only permitted package manager. `npm install` and `yarn` must not be used. Lock file is `pnpm-lock.yaml`.

## 15.2 Common scripts

```bash
pnpm test              # all unit and integration tests, every package
pnpm test:watch        # vitest — interactive watch mode
pnpm coverage          # vitest run --coverage (reported, not threshold-gated)
pnpm test:e2e          # playwright test --config=apps/tactics/e2e/playwright.config.ts --project=electron-e2e
pnpm lint              # eslint with all chimera/* rules
pnpm validate:assets   # check AssetRef strings in game data and SceneDescriptor.requiredAssets
pnpm icons:generate    # regenerate the app icon set (.icns/.ico/PNG) from docs/assets/chimera-logo-compact.png into electron/assets/icons/
pnpm format            # prettier --write on the tracked tree
pnpm format:check      # prettier --check — CI-gated, must pass
pnpm dev               # electron dev with hot-reload harness
pnpm dev:mp 3          # 1 host + 2 auto-joining clients (multiplayer dev)
```

## 15.3 Path aliases

`@chimera-engine/*` specifiers resolve through each package's `exports` map; several toolchains hook that resolution onto in-tree source instead. [`docs/architecture-overview.md` §C.7 As-Built Package Build Model](../architecture-overview.md) is the single source of truth for which toolchain uses which hook. Never add bare relative `../../` imports across package boundaries — use the package specifier.

## 15.4 Vitest config

```typescript
// vitest.config.mts (root)
environment: 'node'; // simulation, ai, networking and tools tests run without DOM
```

There is no per-glob environment mapping: every file that needs browser APIs — renderer components included — opts in with a `// @vitest-environment jsdom` pragma. House rule: put it on the first line.
