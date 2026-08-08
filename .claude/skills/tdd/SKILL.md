---
name: tdd
description: 'Use when implementing any new code or bug fix. How: write failing test first, implement minimum to green, refactor under green — never commit without a prior failing test.'
---

# TDD Skill

Strict red → green → refactor. Tests first is not optional.

## Cycle

1. **Read contract** — relevant interface(s) in `docs/architecture-overview.md`. Tests are executable spec.
2. **Write failing tests first** — `<Module>.test.ts` co-located with future source; import the not-yet-existing module. Run `pnpm test:watch`; confirm **red** with a meaningful failure. A test green before implementation is defective — fix or delete.
3. **Implement minimum to green** — no gold-plating, no code without a test.
4. **Refactor under green** — rerun after every step.
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

Need a mock inside `simulation/`? The code has a hidden dependency — remove it.

## Red Confirmation

- [ ] Test file imports the not-yet-created module
- [ ] `pnpm test:watch` shows new tests **FAIL** with a meaningful message; no accidental green
- [ ] Test names describe behaviour in plain language
- [ ] Type-only module: red is `tsc -p` failing on the new test's imports, not a vitest assertion

## Green Confirmation — before the first review handoff

Sweep the guards **this branch changed**. These pin changed behaviour; they are not an audit of the existing suite.

Always:

- [ ] Every changed guard conjunct has a **dedicated killer**: state the edit that turns the guard true while the property is false, and a named test fails on it. A fixture tripping two conjuncts at once leaves the drop-either-one mutant alive.
- [ ] **Lock-stepped inputs vary one at a time** — a two-axis change kills neither single-axis dependency drop; a pair locked through a memo or derivation needs a test seam that moves them independently.
- [ ] Assert the **artifact the consumer reads** — the projection matrix, the emitted style block, the written file — never only the fields it derives from; a dropped final write/recompute survives field asserts.
- [ ] An inclusive comparator (`<=`, `>=`) gets a fixture exactly **ON the boundary**; pick thresholds representable in binary (a power-of-two fraction) so that fixture exists.
- [ ] The commit's own change is **pinned**: reverting the exact behaviour this branch changes fails a named test. When a test or guard is deleted or replaced, list what the old one caught and confirm each entry still fails against the replacement.
- [ ] Every validation branch **fires** in some test (positive control). A check no fixture can trip is dead code — e.g. indexing an npm array field (`bundledDependencies`) by package name is always `undefined`.
- [ ] Every test **title is a claim its body asserts** — a title promising "returns non-zero rather than throwing" over a body asserting a rejection survives its own violation.
- [ ] Mutant kills verified by editing source restore from a **`cp` backup** whenever the tree holds uncommitted fixes — `git checkout -- <file>` restores the last COMMIT and silently discards the fixes with the mutant.

Only when this branch adds or changes one:

- [ ] **A mode/flag fork** — per-fork assertions: each property claimed of output downstream of the fork is asserted per branch (a parameterized loop counts), and the fork-scoping mutant (`mode === X && …`) dies for each mode. Options sharing one parser get per-option cases.
- [ ] **A shipped artifact** (template, generated file, exported entry) — its **emission** and its **claimed content** are pinned at introduction; presence in the source tree is not emission, and a generated family may pin one emitted count or manifest. Assert generated output against an **inline literal**, never the constant that produced it — `expect(written).toBe(TEMPLATE)` is blind to every content change.
- [ ] **A guard consuming structured text** (source, lint/tool output, config) — it **parses** by the text's own structure (AST, per-file block, per-line record) rather than regexing across block boundaries, is fed exactly the stream its contract names (never stdout+stderr merged), and ships a negative control with two blocks proving a cross-block leak is caught — regexes here have missed `import 'x';`, stripped across newlines, and paired a file with a later block's rule id.
- [ ] **A source-scan guard** — each predicate (file filter, match pattern, allowance classifier) is a named function pinned against **synthetic inputs**: both ends of every segment/suffix anchor, each quote style, each import form. The tree's current contents are not the pin. Assert the **exact matched set**, never a count>0 control, and assemble probed tokens at runtime (`${'x'}` interpolation) so the guard file never becomes its own match.
- [ ] **A test running a built artifact** — rebuild it first; green against a stale `dist` says nothing about the source you just edited.
- [ ] **Float-derived equality** — compare against a **captured pre-state**, never a literal zero: `toBe` is `Object.is`, and float math yields `-0`, which fails `toBe(0)` with the behaviour correct.

Fix rounds: re-run only the items covering the code this round changed.
