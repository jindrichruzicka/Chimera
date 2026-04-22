---
name: tdd
description: "Red-green-refactor TDD cycle for the Chimera engine. Use when: writing any new code, adding a feature, fixing a bug, implementing a task issue, hearing 'TDD', 'red green refactor', 'write failing test', 'test first', 'vitest', or any request to implement something with tests."
---

# TDD Skill

Every implementation task in Chimera follows a strict **red → green → refactor** cycle. Writing tests first is not optional.

---

## The Five-Step TDD Cycle

### Step 1 — Understand the contract first

Read the relevant interface(s) from `docs/architecture-overview.md`. The interface is the specification — tests express that specification in executable form. Do not write a single line of production code until you know what the module must do.

### Step 2 — Write failing tests before any implementation

For each piece of behaviour being added:

1. Create the test file (`<Module>.test.ts` co-located with the future source file).
2. Import the module path that will exist once implemented (it will fail to resolve — that is expected).
3. Write `describe` / `it` blocks that express the behaviour in plain language.
4. Run the test suite and confirm every new test is **red**:

```bash
pnpm test:watch
```

A test must fail with "cannot find module" or a clear assertion failure. **A test that starts green before implementation is a defective test — fix or delete it.**

### Step 3 — Implement the minimum code to turn each test green

Write just enough production code to make the currently-failing test pass, then move to the next test. Do not write code that no test exercises yet. No gold-plating.

### Step 4 — Refactor under green

Once all tests pass, clean up: extract helpers, rename for clarity, remove duplication. Re-run tests after every refactor step to confirm they stay green.

```bash
pnpm test:watch
```

### Step 5 — Do not skip steps

Committing implementation code before a test exists for it is a workflow violation. The commit message body must mention "Tests written first" or "Red confirmed".

---

## Test File Location and Toolchain

| Concern             | Convention                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit tests          | `<Module>.test.ts` / `<Module>.test.tsx` co-located with the source file                                       |
| Integration tests   | `<package>/__tests__/<name>.test.ts`                                                                           |
| Test doubles        | `<package>/__test-support__/` — fakes and stubs only                                                           |
| Runner              | **Vitest** (`vitest.config.mts` at repo root) — run with `pnpm test:watch`                                     |
| Property tests      | **fast-check** for projection, determinism, and commitment invariants                                          |
| Component tests     | **React Testing Library** in `jsdom` — add `// @vitest-environment jsdom` at the top of the file               |
| Never in unit tests | Real filesystem, real network, real Electron IPC — use `InMemorySaveRepository`, `InMemoryMultiplayerProvider` |

---

## Per-Situation Coverage Table

| Situation                | What to cover                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `ActionDefinition`   | `validate()` rejects every illegal payload variant; `reduce()` produces the exact expected next state; `reduce()` does not mutate the input snapshot.          |
| New `simulation/` module | Constructor/factory contract; happy path; every documented error type thrown under the right conditions; boundary values.                                      |
| New renderer component   | Renders loading state while `useAsset` returns `null`; renders correctly with resolved data; dispatches the right `sendAction` call on user interaction.       |
| New Zustand store        | Initialises with documented default values; each mutation method produces the correct state; selectors return the right derived value.                         |
| New IPC handler          | Integration test: call handler with valid input → assert correct IPC response; call with invalid input → assert rejection shape matches documented error type. |
| Bug fix                  | Write a test that reproduces the bug **first**, confirm it is red, then fix the code.                                                                          |

---

## Simulation Unit Tests Are Pure Functions — No Mocks Needed

Simulation tests require **zero mocks**. The pure reducer pattern means every test is a function call with plain inputs and plain output assertions:

```typescript
// Good — no mocks, no DI frameworks, no spies
const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
expect(next.tick).toBe(6);
```

If you feel the need to mock something inside `simulation/`, that is a signal the code under test has a hidden dependency it should not have. Remove the dependency rather than adding a mock.

---

## Red Confirmation Checklist

Before proceeding to Step 3 (implementation), verify:

- [ ] Test file exists and imports the not-yet-created module path
- [ ] `pnpm test:watch` shows the new test(s) as **FAIL** with a meaningful failure message
- [ ] No new test is accidentally green before implementation
- [ ] Test names describe the expected behaviour in plain language
