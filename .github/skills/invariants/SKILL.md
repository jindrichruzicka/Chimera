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

| #     | Rule                                                             | Grep                                                                                                                          |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1     | `simulation/` zero deps on React/DOM/networking                  | `from.*renderer/` in `simulation/`/`ai/`                                                                                      |
| 1     | `renderer/` never imports the main process                       | `from.*electron/main/` in `renderer/`                                                                                         |
| 1     | `shared/` is the zero-dependency foundation leaf                 | `from '@chimera-engine/(simulation\|ai\|networking\|renderer\|electron)'` in `shared/` (Check 13)                             |
| 2     | Reducers pure — no side-effect APIs                              | `Math\.random\|Date\.now\|performance\.now` in `simulation/`/`ai/`                                                            |
| 2     | `electron/main` core imports no game (only the 3 registries)     | `games/`/non-engine `@chimera-engine/*` in `electron/main/` (Check 10)                                                        |
| 3     | `GameSnapshot` stays in main                                     | `GameSnapshot` in `electron/preload/` or `renderer/`                                                                          |
| 27    | `CHIMERA_DEBUG` never set by packaging config                    | `CHIMERA_DEBUG` in `package.json` / electron-builder / forge configs                                                          |
| 27    | `IS_DEBUG_MODE` keeps define-replaceable shape                   | dot-access `process.env.CHIMERA_DEBUG === '1'` and `process.env.NODE_ENV !== 'production'` pinned in `shared/constants.ts`    |
| 43    | `validate()`/`reduce()` deterministic                            | same as #2                                                                                                                    |
| 47    | Engine doesn't import provider-specific dirs                     | `from.*games/` in `simulation/`/`ai/`                                                                                         |
| 47    | `electron/main` orchestration imports the networking barrel only | `networking/provider/(local\|steam)/` import in `electron/main/` (≠ `index.ts`) (Check 15)                                    |
| 48/80 | `GameShell.tsx`/`InGameMenuHost.tsx` stay game-agnostic          | `games/`/non-engine `@chimera-engine/*` in `renderer/components/shell/{GameShell,InGameMenuHost}.tsx` (Check 7)               |
| 94    | Engine shell pages import no game                                | `games/`/non-engine `@chimera-engine/*` in `renderer/app/{main-menu,lobby,game,settings,saves,component-gallery}/` (Check 16) |
| 96    | Game renderer surfaces use only the `ui`/`chat` barrels          | non-barrel `@chimera-engine/renderer/*` in `games/*/{screens,shell}/*.tsx` (Check 17)                                         |
| 106   | `ai/` is the game-agnostic framework only (containment)          | non-`engine`/`__tests__`/`dist` dir or non-`index.ts` `.ts`/`.tsx` file under `ai/` (Check 11)                                |
| 107   | `ai/` defines no game tokens; only `engine:` crosses             | `TACTICS_` constant or `'<gameId>:'` namespace (≠ `engine:`) in `ai/` (Check 12)                                              |

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
