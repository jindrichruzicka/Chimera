---
title: 'Chimera Coding Standards — §1 TypeScript'
description: 'TypeScript compiler settings, forbidden patterns, data types, functions, imports, and formatting rules for the Chimera engine.'
tags: [typescript, strict, formatting, imports, branded-types, readonly, coding-standards]
---

# §1 TypeScript

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 1.1 Compiler settings

- `strict: true` is mandatory in every `tsconfig.json`. No exceptions.
- `noUncheckedIndexedAccess: true` — all array/record indexing returns `T | undefined`.
- `exactOptionalPropertyTypes: true` — `undefined` is not assignable to an optional field unless `?` is declared.
- Path aliases use the `@chimera-engine/*` namespace (e.g. `@chimera-engine/simulation/engine`). Never use relative `../../..` paths across package boundaries.

## 1.2 Forbidden patterns

| Pattern                                                         | Why forbidden                   | Allowed alternative                                                                |
| --------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `any` (explicit or inferred)                                    | Destroys type safety end-to-end | Use `unknown` and narrow at runtime                                                |
| `@ts-ignore`                                                    | Silently hides errors           | Fix the type; if impossible add `@ts-expect-error` with a mandatory comment        |
| `@ts-expect-error` without comment                              | Hides the rationale             | `// @ts-expect-error: <reason why this specific cast is safe>`                     |
| `as unknown as X` without comment                               | Unsafe double-cast              | Fix the type; if bridging generated code, comment with `@chimera-review: <reason>` |
| `Object.assign(existingObject, ...)` in simulation              | Mutates state                   | Return a new object: `{ ...existing, field: newValue }`                            |
| `Math.random()` anywhere in `simulation/` or `games/*/actions/` | Breaks determinism              | Use `ctx.rng` from `ReduceContext`                                                 |
| `Date.now()` / `performance.now()` in `simulation/`             | Breaks determinism              | Use `snapshot.tick` for all simulation time                                        |

## 1.3 Data types

- Prefer `readonly` on every field of data types. Mutation is only permitted inside `reduce()`, and only on freshly-constructed objects before they are returned.
- Use **discriminated unions** over class hierarchies for data: `type Result = { ok: true; value: T } | { ok: false; error: E }`.
- Use **branded / phantom types** to prevent string-shaped identifiers from mixing: `type PlayerId = string & { readonly __brand: 'PlayerId' }`.
- Do not use numeric enums. Use `as const` string unions or string literal types.
- Generic type parameters must be named semantically: `TState`, `TParams`, `TPayload`, `TSnapshot`. Single-letter names (`T`, `U`) are only acceptable in trivial one-line utility types.

## 1.4 Functions and exports

- All public function return types are **explicitly annotated**. No inferred `any` may escape a function boundary.
- Use `satisfies` for configuration objects to catch shape errors without widening.
- Use `as const` for static lookup tables.
- Prefer `function` syntax over arrow functions at module scope for named exports — easier to read in stack traces.
- Factory functions are preferred over constructors for complex objects requiring dependency injection.

## 1.5 Imports

- Use named imports. Avoid `import * as X` unless consuming a module with no named exports.
- Sort imports: external packages → `@chimera-engine/*` path aliases → relative paths. Within each group, alphabetical order.
- Never import a type with a value import when only the type is needed. Use `import type { Foo }`.

## 1.6 Formatting and indentation

- **Indentation is four spaces.** No tabs, no two-space indentation. This applies uniformly to all TypeScript, JavaScript, JSON, JSX/TSX, and Markdown files in the repository. YAML keeps its ecosystem-standard two-space indentation (enforced by a Prettier override).
- Continuation lines and JSX attribute wraps also indent by four spaces per level.
- The formatter and editor baseline are the source of truth: [`.editorconfig`](../../.editorconfig) and [`.prettierrc.json`](../../.prettierrc.json) at the repository root. Do not override them per-file.
- Run `pnpm format` before committing; CI runs `pnpm format:check` and fails on diffs.
- Mixed indentation in a single file is a **BLOCK** finding at review.
