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
pnpm test              # vitest run — all unit and integration tests
pnpm test:watch        # vitest — interactive watch mode
pnpm test:coverage     # vitest run --coverage
pnpm test:e2e          # playwright test --config=e2e/playwright.config.ts --project=electron-e2e
pnpm lint              # eslint with all chimera/* rules
pnpm validate:assets   # check AssetRef strings in game data and SceneDescriptor.requiredAssets
pnpm format            # prettier --write on the tracked tree
pnpm format:check      # prettier --check — CI-gated, must pass
pnpm dev               # electron dev with hot-reload harness
pnpm dev:mp 3          # 1 host + 2 auto-joining clients (multiplayer dev)
```

## 15.3 Path aliases

All `@chimera/*` path aliases are declared in the root `tsconfig.json` and resolved by `vite-tsconfig-paths` in Vitest and the renderer's Vite config. Never add bare relative `../../` imports across package boundaries — use the alias.

## 15.4 Vitest config

```typescript
// vitest.config.ts (root)
environmentMatchGlobs: [
    ['renderer/**/*.test.tsx', 'jsdom'],
    ['renderer/**/*.test.ts', 'jsdom'],
];
// Default: 'node' — simulation and ai tests run without DOM
```

Override per file with `// @vitest-environment jsdom` when a single file in a non-renderer package needs browser APIs.
