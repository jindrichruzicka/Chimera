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
- [ ] Type-only module: red is `tsc -p` failing on the new test's imports, not a vitest assertion

## Green Confirmation — before every review handoff, including each fix round

Sweep every changed guard yourself first:

- [ ] Every guard conjunct has a **dedicated killer**: state the edit that turns
      the guard true while the property is false, and a named test fails on it.
      A fixture that trips two conjuncts at once leaves the drop-either-one
      mutant alive.
- [ ] The commit's own change is **pinned**: reverting the exact behavior this
      branch changes fails a named test. A new shipped artifact — template
      file, generated file, exported entry — counts: its **emission** and its
      **claimed content** are pinned at introduction; presence in the source
      tree is not emission, and a generated family may pin one emitted count or
      manifest instead of every file. When a test or guard is deleted or
      replaced, list what the old one caught and confirm each entry still fails
      against the replacement.
- [ ] Every validation branch **fires** in some test (positive control). A check
      no fixture can trip is dead code — e.g. indexing an npm array field
      (`bundledDependencies`) by package name is always `undefined`.
- [ ] Generated output is asserted against an **inline literal**, never the
      constant that produced it — `expect(written).toBe(TEMPLATE)` is blind to
      every content change.
- [ ] Options sharing one parser get **per-option cases**, and a new or changed
      mode/flag fork gets **per-fork assertions**: each property claimed of
      output downstream of the fork is asserted per branch (a parameterized
      test looping the modes counts), and the fork-scoping mutant
      (`mode === X && …`) dies for each mode.
- [ ] A guard that consumes structured text — source, lint or tool output,
      config — **parses** by the text's own structure (AST, per-file block,
      per-line record) rather than regexing across block boundaries, is fed
      exactly the stream its contract names (never stdout+stderr merged), and
      ships a negative control with two blocks proving a cross-block leak is
      caught — regexes here have missed `import 'x';`, stripped across
      newlines, and paired a file with a later block's rule id.
- [ ] Tests that run a **built artifact rebuild it first** — green against a
      stale `dist` says nothing about the source you just edited.
- [ ] Every test **title is a claim its body asserts** — a title promising
      "returns non-zero rather than throwing" over a body that asserts a
      rejection survives its own violation.
