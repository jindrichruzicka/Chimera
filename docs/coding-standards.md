---
title: 'Chimera Engine — Coding Standards (Index Hub)'
description: 'Authoritative coding standards for the Chimera game engine. This file is the canonical index hub; every section has been modularised into focused files under docs/coding-standards-sections/ for RAG and agent retrieval.'
tags:
    [
        coding-standards,
        index,
        typescript,
        solid,
        module-boundaries,
        react,
        simulation,
        electron,
        security,
        testing,
        performance,
        git,
    ]
---

# Chimera Engine — Coding Standards (Index Hub)

> Authoritative reference for all contributors and automated agents.  
> These rules are enforced at review time. Violations block merge.  
> Where a rule references the architecture document, `docs/architecture-overview.md` is always the primary source.
>
> **This file is an index hub.** All sections have been modularised into focused files for RAG and agent retrieval. The full original specification text is preserved below the index.

---

## Index: Coding Standards Sections

| File                                                                                                     | Section | Contents                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| [coding-standards-sections/typescript.md](coding-standards-sections/typescript.md)                       | §1      | Compiler settings, forbidden patterns, data types, functions/exports, imports, formatting (4-space indent) |
| [coding-standards-sections/solid-principles.md](coding-standards-sections/solid-principles.md)           | §2      | SRP, OCP, LSP, ISP, DIP applied to the Chimera engine                                                      |
| [coding-standards-sections/module-boundaries.md](coding-standards-sections/module-boundaries.md)         | §3      | Hard package boundary table, ESLint enforcement rules                                                      |
| [coding-standards-sections/file-symbol-naming.md](coding-standards-sections/file-symbol-naming.md)       | §4      | File naming (PascalCase/camelCase/kebab-case), symbol naming, IPC channel conventions, action types        |
| [coding-standards-sections/react-zustand.md](coding-standards-sections/react-zustand.md)                 | §5      | Component purity, narrow Zustand selectors, `useSendAction()`, derived state, `useEffect` rules            |
| [coding-standards-sections/react-three-fiber.md](coding-standards-sections/react-three-fiber.md)         | §6      | Data passed to R3F components, `AssetRef<T>` usage, render loop discipline                                 |
| [coding-standards-sections/simulation-layer.md](coding-standards-sections/simulation-layer.md)           | §7      | Determinism (3 rules), reducer purity, `GameSnapshot` invariants, fixed-point arithmetic                   |
| [coding-standards-sections/electron-ipc.md](coding-standards-sections/electron-ipc.md)                   | §8      | `BrowserWindow` security settings, preload surface, IPC input validation (Zod), atomic file writes         |
| [coding-standards-sections/networking.md](coding-standards-sections/networking.md)                       | §9      | Provider abstraction, message validation, CRC32, per-player snapshot distribution                          |
| [coding-standards-sections/error-handling.md](coding-standards-sections/error-handling.md)               | §10     | Typed domain errors, result types vs exceptions, IPC error propagation                                     |
| [coding-standards-sections/security.md](coding-standards-sections/security.md)                           | §11     | OWASP Top 10 map: injection, prototype pollution, path traversal, snapshot leakage, node access, secrets   |
| [coding-standards-sections/testing.md](coding-standards-sections/testing.md)                             | §12     | TDD cycle, Vitest/Playwright toolchain, file conventions, coverage gates (80/80/75), test scope matrix     |
| [coding-standards-sections/performance.md](coding-standards-sections/performance.md)                     | §13     | Simulation hot path (≤16 ms), IPC discipline, renderer memoisation, memory targets (≤32 MB)                |
| [coding-standards-sections/git-commit-discipline.md](coding-standards-sections/git-commit-discipline.md) | §14     | Branch naming, first commit + `fixup!` structure, fast-forward-only merge policy                           |
| [coding-standards-sections/toolchain-reference.md](coding-standards-sections/toolchain-reference.md)     | §15     | pnpm scripts, `@chimera-engine/*` path aliases, Vitest `environmentMatchGlobs` config                      |
