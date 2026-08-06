---
title: 'Chimera Coding Standards — §12 Testing'
description: 'TDD cycle, Vitest/Playwright toolchain, file conventions, coverage targets, test scope matrix, no-mocks policy for simulation, and no-real-resources rule for unit tests.'
tags: [testing, tdd, vitest, playwright, coverage, mocks, simulation, coding-standards]
---

# §12 Testing

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 12.1 Test-Driven Development — mandatory cycle

1. **Write failing tests first.** Create the test file, import the not-yet-existing module, write `describe`/`it` blocks, and confirm they are **red**.
2. **Write the minimum implementation** to turn each test green. No gold-plating.
3. **Refactor under green.** Clean up only once all tests pass. Re-run after every change.

Committing implementation code without a corresponding test is a workflow violation.

## 12.2 Toolchain

| Tool                         | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| **Vitest**                   | Unit and integration tests for all TypeScript packages                      |
| **React Testing Library**    | Component and store tests in `jsdom`                                        |
| `@react-three/test-renderer` | R3F scene tests (no WebGL required)                                         |
| **fast-check**               | Property-based tests for projection, determinism, and commitment invariants |
| **Playwright**               | End-to-end tests only — real Electron instances, `CHIMERA_E2E=1` flag       |

## 12.3 File conventions

- Unit tests: `<Module>.test.ts` / `<Module>.test.tsx` co-located with the source file.
- Integration tests spanning multiple modules: `<package>/__tests__/<name>.test.ts`.
- Test doubles (fakes, stubs): `<package>/__test-support__/`.
- E2E fixtures and specs: `apps/tactics/e2e/` only. Never imported from unit tests.

## 12.4 Coverage targets

`pnpm coverage` runs `vitest run --coverage` and **reports** these numbers. They are
review targets, not a mechanical gate — nothing fails a build on them.

| Metric    | Target |
| --------- | ------ |
| Lines     | 80%    |
| Functions | 80%    |
| Branches  | 75%    |

## 12.5 What to test

| New code             | Required coverage                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ActionDefinition`   | `validate()` rejects every illegal payload variant; `reduce()` returns exact expected state; `reduce()` does not mutate input |
| `simulation/` module | Constructor contract; happy path; every documented error type; boundary values                                                |
| Renderer component   | Loading state; resolved-data render; correct `sendAction` call on interaction                                                 |
| Zustand store        | Default values; each mutation; each selector                                                                                  |
| IPC handler          | Valid input → correct response; invalid input → rejection matches documented error type                                       |
| Bug fix              | Reproducing test written **first**, confirmed red, then fixed                                                                 |

## 12.6 No mocks in simulation tests

Simulation unit tests require zero mocks. Pure reducers are plain function calls:

```typescript
const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
expect(next.tick).toBe(6);
```

A felt need to mock inside `simulation/` means a hidden dependency exists that should be removed.

## 12.7 No real resources in unit tests

Unit tests must never touch the real filesystem, real network, or real Electron IPC. Use:

- `InMemorySaveRepository` instead of `FileSaveRepository`
- `InMemoryMultiplayerProvider` instead of `LocalWebSocketProvider`
- In-process builder helpers from `<package>/__test-support__/`

What the rule protects is determinism: a test must not depend on filesystem state it
does not control — a path another test wrote, a developer's home directory, whatever a
previous run left behind. In bounds, for example:

- **Reading a committed file whose content IS the subject.** A repository file is an
  input as fixed as a string literal, and reading it is the only way to assert anything
  about it — an asset's bytes against what its manifest claims
  (`apps/tactics/asset-manifest.test.ts`), a template file against what the scaffold
  promises to emit (`tools/create-chimera-game/blank-template-smoke.test.ts`). Binary
  artifacts are the sharp case: a `.wav` or `.glb` cannot be reviewed in a diff, so what
  it contains is knowable only by parsing it, and prose about it rots silently.
  `@chimera-engine/electron/test-support` ships those readers so a game does not
  hand-roll a container parser.
- **Creating fixtures the test itself owns, under the OS temp directory.** A `mkdtemp`
  root is private to the run, so nothing leaks between tests — the established pattern in
  `electron/main/saves/FileSaveRepository.test.ts` and
  `electron/dev-tools/validate-assets/index.test.ts`, among others.

Out of bounds either way: real network, real Electron IPC, and writing anywhere under the
repository itself.
