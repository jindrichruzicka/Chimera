---
applyTo: '**/*.test.ts,**/*.test.tsx'
---

# Test Files — Rules

These rules apply to every `*.test.ts` and `*.test.tsx` file in the repository. Violations are **BLOCK** findings at review.

## TDD Cycle (mandatory)

Tests are **written before implementation**. The cycle is:

1. Write the test file and import the module path that will be created (it will fail to resolve — that is expected).
2. Run `pnpm test:watch` and confirm every new test is **red** (fails with "cannot find module" or a clear assertion failure).
3. Write the minimum code to make the currently-failing test pass.
4. Refactor under green. Re-run after every step.
5. Never commit implementation code before its test exists.

## Simulation Tests — Zero Mocks

Tests inside `simulation/` require **zero mocks**. The pure reducer pattern means every test is a direct function call with plain inputs and plain output assertions:

```typescript
// ✅ No mocks — pure function call
const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
expect(next.tick).toBe(6);

// ❌ BLOCK — mocking inside simulation/ tests signals a hidden dependency
vi.mock('../StateReducer');
```

If you feel the need to mock something inside `simulation/`, the code under test has a hidden dependency it should not have.

## Test File Location

Test files are co-located with their source:

```
simulation/engine/ActionPipeline.ts       ← source
simulation/engine/ActionPipeline.test.ts  ← test (same directory)
```

Integration tests spanning multiple modules go in `<package>/__tests__/<name>.test.ts`.

## Test Doubles Location

Fakes, stubs, and builder helpers go in `<package>/__test-support__/`, never in source files.

## Real Dependencies Are Forbidden in Unit Tests

Never use real infrastructure in unit tests:

| Forbidden                | Use instead                               |
| ------------------------ | ----------------------------------------- |
| Real filesystem          | `InMemorySaveRepository`                  |
| Real network / WebSocket | In-process `InMemoryMultiplayerProvider`  |
| Real Electron IPC        | Direct function calls or in-process stubs |

## jsdom Environment

If a test requires browser APIs (React component tests, DOM assertions), add this comment at the very top of the test file:

```typescript
// @vitest-environment jsdom
```

Without this annotation, Vitest runs in a Node environment where `window`, `document`, and `localStorage` are undefined.

## React Component Tests

Use **React Testing Library**. Do not use Enzyme or manual DOM manipulation.

```typescript
import { render, screen } from '@testing-library/react';
```

Every component test must cover:

- The loading state while `useAsset` returns `loading: true`
- The rendered state with resolved data
- The correct `sendAction` call on user interaction (if the component dispatches actions)

## What Each Test Situation Must Cover

| Situation                | What to test                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| New `ActionDefinition`   | `validate()` rejects every illegal payload; `reduce()` produces correct next state; `reduce()` does not mutate the input snapshot |
| New `simulation/` module | Constructor/factory contract; happy path; every documented error type; boundary values                                            |
| New renderer component   | Loading state; resolved state; correct `sendAction` on interaction                                                                |
| New Zustand store        | Default values; each mutation method; selectors return correct derived value                                                      |
| New IPC handler          | Valid input → correct IPC response; invalid input → rejection shape matches documented error type                                 |
| Bug fix                  | Write a reproduction test **first**, confirm it is red, then fix the code                                                         |

## Coverage Expectations

- Every public method must have at least one passing test.
- Every documented error type must be covered.
- Every branch in `validate()` and `reduce()` must be exercised.

## Toolchain

- Runner: **Vitest** (`pnpm test` / `pnpm test:watch`)
- Property tests: **fast-check** for projection, determinism, and commitment invariants
- Component tests: **React Testing Library** with `// @vitest-environment jsdom`
