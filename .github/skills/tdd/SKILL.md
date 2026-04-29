---
name: tdd
description: 'Use when implementing any new code or bug fix. How: write failing test first, implement minimum to green, refactor under green — never commit without a prior failing test.'
---

# TDD Skill

Strict red → green → refactor. Tests first is not optional.

## Cycle

1. **Read contract** — relevant interface(s) in `docs/architecture-overview.md`. The interface is the spec; tests are executable spec.
2. **Write failing tests first** — `<Module>.test.ts` co-located with future source. Import the not-yet-existing module; write `describe`/`it`. Run `pnpm test:watch`; confirm **red** ("cannot find module" or assertion fail). A test that's green before implementation is defective — fix or delete.
3. **Implement minimum to green** — just enough for the failing test. No gold-plating. No code without a test.
4. **Refactor under green** — `pnpm test:watch`; rerun after every refactor step.
5. **Never skip steps**. Commit body must mention "Tests written first" or "Red confirmed".

## Locations

| Concern           | Convention                                                                       |
| ----------------- | -------------------------------------------------------------------------------- |
| Unit              | `<Module>.test.ts(x)` co-located                                                 |
| Integration       | `<package>/__tests__/<name>.test.ts`                                             |
| Doubles           | `<package>/__test-support__/` (fakes/stubs only)                                 |
| Runner            | Vitest (`vitest.config.mts`); `pnpm test:watch`                                  |
| Property          | fast-check (projection/determinism/commitment)                                   |
| Component         | RTL + jsdom (`// @vitest-environment jsdom`)                                     |
| Forbidden in unit | Real FS/network/IPC; use `InMemorySaveRepository`, `InMemoryMultiplayerProvider` |

## Coverage by Situation

| Situation            | Cover                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `ActionDefinition`   | `validate()` rejects all illegal payloads; `reduce()` produces exact next state; no input mutation |
| `simulation/` module | factory contract; happy path; every error type; boundary values                                    |
| Renderer component   | loading state; resolved state; correct `sendAction` on interaction                                 |
| Zustand store        | defaults; each mutation; selectors                                                                 |
| IPC handler          | valid → response; invalid → documented rejection shape                                             |
| Bug fix              | reproduction test red first, then fix                                                              |

## Simulation: Zero Mocks

Pure-reducer pattern → tests are direct function calls:

```typescript
const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
expect(next.tick).toBe(6);
```

Need a mock inside `simulation/`? The code has a hidden dependency. Remove the dependency.

## Red Confirmation

- [ ] Test file imports the not-yet-created module
- [ ] `pnpm test:watch` shows new tests **FAIL** with meaningful message
- [ ] No accidental green
- [ ] Test names describe behaviour in plain language
