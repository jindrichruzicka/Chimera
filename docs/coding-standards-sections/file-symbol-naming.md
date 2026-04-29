---
title: 'Chimera Coding Standards — §4 File and Symbol Naming'
description: 'File naming conventions (PascalCase, camelCase, kebab-case) and symbol naming rules for classes, hooks, IPC channels, store methods, and action types.'
tags: [naming, conventions, files, symbols, ipc-channels, hooks, coding-standards]
---

# §4 File and Symbol Naming

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 4.1 File naming

| Convention     | When to use                                                                            | Example                                  |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| **PascalCase** | Exports a class or interface with the same name                                        | `ActionPipeline.ts`, `SaveFile.ts`       |
| **camelCase**  | Exports a Zustand store, React hook, or renderer utility                               | `gameStore.ts`, `useAsset.ts`            |
| **kebab-case** | Node.js-style module with no single dominant export (Electron main, tooling, fixtures) | `lobby-manager.ts`, `check-and-merge.sh` |

Test files mirror their source: `ActionPipeline.test.ts` alongside `ActionPipeline.ts`.

## 4.2 Symbol naming

- **Interfaces** and **types**: `PascalCase` matching the architecture document exactly.
- **Enums / const unions**: `PascalCase` for the type; `SCREAMING_SNAKE` for individual members only if they are truly constant identifiers (e.g. error codes). Prefer string literal unions over enums.
- **React components**: `PascalCase`.
- **Hooks**: `useCamelCase`.
- **IPC channels**: `chimera:<domain>:<verb>` — all lowercase kebab. Example: `chimera:game:send-action`.
- **Zustand store methods**: `camelCase` verbs — `applySnapshot`, `setLobbyState`, `clearPredictions`.
- **Action types**: `<namespace>:<verb_noun>` — all lowercase with underscores for space. Example: `tactics:move_unit`, `engine:end_turn`.
