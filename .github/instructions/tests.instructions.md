---
applyTo: '**/*.test.ts,**/*.test.tsx'
---

# Test Files — Rules

Violations are **BLOCK**.

## TDD Cycle (mandatory)

1. Write test file importing not-yet-created module path (will fail to resolve — expected).
2. `pnpm test:watch` → confirm **red** ("cannot find module" or assertion fail).
3. Minimum code to green.
4. Refactor under green; re-run after each step.
5. Never commit implementation before its test exists.

## Simulation — Zero Mocks

Pure-reducer means direct function calls:

```typescript
const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
expect(next.tick).toBe(6);
// vi.mock('../StateReducer');  ❌ BLOCK — signals hidden dependency
```

## Locations

- Unit: co-located `<Module>.test.ts(x)` (e.g. `simulation/engine/ActionPipeline.test.ts`).
- Integration: `<package>/__tests__/<name>.test.ts`.
- Doubles: `<package>/__test-support__/` only — never in source.

## Real Deps Forbidden in Unit Tests

| Forbidden              | Use                             |
| ---------------------- | ------------------------------- |
| Real FS                | `InMemorySaveRepository`        |
| Real network/WebSocket | `InMemoryMultiplayerProvider`   |
| Real Electron IPC      | direct calls / in-process stubs |

## jsdom

Browser APIs needed → first line of test:

```typescript
// @vitest-environment jsdom
```

## React Components

React Testing Library; never Enzyme or manual DOM. Cover:

- loading state (`useAsset` `loading: true`)
- resolved state
- correct `sendAction` on interaction

## Coverage by Situation

| Situation            | Cover                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| `ActionDefinition`   | `validate()` rejects illegal payloads; `reduce()` correct next state; no input mutation |
| `simulation/` module | factory contract; happy path; every documented error; boundary values                   |
| Renderer component   | loading; resolved; sendAction on interaction                                            |
| Zustand store        | defaults; each mutation; selector outputs                                               |
| IPC handler          | valid → response; invalid → documented rejection shape                                  |
| Bug fix              | reproduction test red first, then fix                                                   |

## Coverage Expectations

- Every public method has ≥1 passing test.
- Every documented error type covered.
- Every branch in `validate()`/`reduce()` exercised.

## Toolchain

Vitest (`pnpm test`/`pnpm test:watch`); fast-check for property tests (projection/determinism/commitment); React Testing Library + `// @vitest-environment jsdom` for components.
