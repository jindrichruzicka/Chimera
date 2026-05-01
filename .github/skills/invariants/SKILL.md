---
name: invariants
description: 'Use when checking for architecture invariant violations before committing or merging. How: run `bash .github/skills/invariants/scripts/check-invariants.sh` and fix any reported violations.'
argument-hint: '(optional) subdirectory to scope the check, e.g. simulation/ or ai/'
---

# Invariants Skill

Runs mechanical subset of [Architecture Invariants](../../../docs/executive-architecture/architecture-invariants.md) against the working tree.

## Run

```bash
bash .github/skills/invariants/scripts/check-invariants.sh
```

Exit 0 = clean. Non-zero = `[invariant-N] path:line  matched text`.

## Two-Tier Model

| Tier       | What                                    | How                       |
| ---------- | --------------------------------------- | ------------------------- |
| Mechanical | Grep-detectable import/API violations   | this script               |
| Manual     | Logic, type, SOLID, lifecycle, security | reviewer 8-step checklist |

Both must pass before landing on `main`.

## Mechanical Checks

| #   | Rule                                            | Grep                                                               |
| --- | ----------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `simulation/` zero deps on React/DOM/networking | `from.*renderer/` in `simulation/`/`ai/`                           |
| 2   | Reducers pure — no side-effect APIs             | `Math\.random\|Date\.now\|performance\.now` in `simulation/`/`ai/` |
| 3   | `GameSnapshot` stays in main                    | `GameSnapshot` in `electron/preload/` or `renderer/`               |
| 43  | `validate()`/`reduce()` deterministic           | same as #2                                                         |
| 47  | Engine doesn't import provider-specific dirs    | `from.*games/` in `simulation/`/`ai/`                              |

Boundary checks: `from.*electron/` and `from.*games/` inside `simulation/`/`ai/`.

## Manual-Only

| #     | Why                                                               |
| ----- | ----------------------------------------------------------------- |
| 4     | Renderer reads-not-writes — needs component code review           |
| 12    | Pipeline step ordering — needs `ActionPipeline` reading           |
| 13    | `ContentDatabase` immutability — constructor/mutation analysis    |
| 23/33 | Atomic file writes (`.tmp` + rename) — FS impl reading            |
| 44    | Float fields in `GameSnapshot` — type inspection (may be aliased) |

## Usage

**Developer self-check** (before commit): run after touching `simulation/`/`ai/`/`games/`/`electron/`. Fix violations before commit. Pre-commit gate fires the pnpm checks; this script is a complementary early warning.

**Reviewer** (Steps 6+7): run after checking out branch under review. Include full output in findings. Non-zero → BLOCK. Zero exit means manual checklist still applies.

## Output

```
[invariant-2] simulation/engine/ActionPipeline.ts:42  Math.random()
[invariant-3] electron/preload/api.ts:17  GameSnapshot
---
2 violation(s) found. Fix them and re-run.
```

Clean: `All invariant checks passed.`
