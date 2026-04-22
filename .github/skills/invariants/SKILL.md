---
name: invariants
description: "Chimera invariant checker. Run mechanical Appendix B checks automatically. Trigger phrases: 'invariant check', 'check invariants', 'run invariant script', 'verify invariants', 'invariant violations'. Use when: starting a code review, before merging a branch, or whenever a developer wants to self-check their changes against the architecture invariants."
argument-hint: '(optional) subdirectory to scope the check, e.g. simulation/ or ai/'
---

# Invariants Skill

Runs mechanical subset of the [Appendix B invariants](../../../docs/architecture-overview.md#appendix-b----key-invariants-never-violate-78-total) against the working tree, then lists any invariant checks that require human judgement.

---

## Invocation

```bash
bash .github/skills/invariants/scripts/check-invariants.sh
```

Exit 0 = no mechanical violations detected.
Non-zero = violations found; each is printed as `[invariant-N] path:line  matched text`.

---

## Two-Tier Model

| Tier           | What                                             | How                               |
| -------------- | ------------------------------------------------ | --------------------------------- |
| **Mechanical** | Grep-detectable import/API violations            | `check-invariants.sh` (automated) |
| **Manual**     | Logic, type, SOLID, lifecycle, security analysis | Reviewer's eight-step checklist   |

The script supplements the manual checklist — it does **not** replace it. Both must pass before a branch lands on `main`.

---

## Mechanical Checks (by invariant number)

| #      | Rule                                                              | What the script greps                                                                                                    |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **1**  | `simulation/` has zero runtime deps on React, DOM, or networking  | `from.*renderer/` inside `simulation/` or `ai/`                                                                          |
| **2**  | `applyAction`/`reduce` are pure — no side-effectful APIs          | `Math\.random\|Date\.now\|performance\.now` inside `simulation/` or `ai/`                                                |
| **3**  | `GameSnapshot` never leaves the main process                      | `GameSnapshot` imported in `electron/preload/` or `renderer/`                                                            |
| **43** | `validate()`/`reduce()` must not call non-deterministic APIs      | `Math\.random\|Date\.now\|performance\.now` inside `simulation/` or `ai/` (same grep as #2; both invariants are covered) |
| **47** | Orchestration modules must not import from provider-specific dirs | `from.*games/` inside `simulation/` or `ai/`                                                                             |

Additional boundary checks:

| Check                                          | What the script greps                           |
| ---------------------------------------------- | ----------------------------------------------- |
| `simulation/` must not import from `electron/` | `from.*electron/` inside `simulation/` or `ai/` |
| `simulation/` must not import from `games/`    | `from.*games/` inside `simulation/` or `ai/`    |

---

## Checks That Remain Manual

The following invariants cannot be detected by grep and **must** be covered by the reviewer's manual eight-step checklist:

| #         | Why it is manual                                                                 |
| --------- | -------------------------------------------------------------------------------- |
| **4**     | "renderer reads, never writes state directly" — requires reading component code  |
| **12**    | Pipeline step ordering — requires reading `ActionPipeline` logic                 |
| **13**    | `ContentDatabase` immutability — requires constructor/mutation analysis          |
| **23/33** | Atomic file writes (`.tmp` + rename) — requires reading FS implementation        |
| **44**    | Float fields in `GameSnapshot` — requires type inspection; floats may be aliased |

---

## Usage by Context

### Developer self-check (before committing)

Run the script from the repo root after every substantive change to `simulation/`, `ai/`, `games/`, or `electron/`:

```bash
bash .github/skills/invariants/scripts/check-invariants.sh
```

If any check fails, fix the violation before committing. The pre-commit gate also fires the pnpm quality checks; the invariant script is a complementary early warning.

### Reviewer (Steps 6 and 7 of the review checklist)

In Step 6 (Simulation determinism) and Step 7 (Security) of `chimera-code-reviewer.agent.md`, run the script against the working tree after checking out the branch under review:

```bash
bash .github/skills/invariants/scripts/check-invariants.sh
```

Include the full output in the findings report. Any non-zero exit is a **BLOCK** finding. Zero exit means all mechanical checks passed; the manual checklist items still apply.

---

## Output Format

```
[invariant-2] simulation/engine/ActionPipeline.ts:42  Math.random()
[invariant-3] electron/preload/api.ts:17  GameSnapshot
---
2 violation(s) found. Fix them and re-run.
```

Clean run:

```
All invariant checks passed.
```
