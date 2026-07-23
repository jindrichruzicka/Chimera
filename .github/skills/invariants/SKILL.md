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

| #     | Rule                                                             | Grep                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `simulation/` zero deps on React/DOM/networking                  | `from.*renderer/`/bare `@chimera-engine/renderer` in `simulation/`/`ai/`/`apps/*/{simulation,ai}`                                                                                                                                                                                                                                                                              |
| 1     | `renderer/` never imports the main process                       | `from.*electron/main/` in `renderer/`                                                                                                                                                                                                                                                                                                                                          |
| 1     | `simulation/` is the zero-dependency foundation leaf             | `from '@chimera-engine/(ai\|networking\|renderer\|electron)'` in `simulation/` (Check 13)                                                                                                                                                                                                                                                                                      |
| 2     | Reducers pure — no side-effect APIs                              | `Math\.random\|Date\.now\|performance\.now` in `simulation/`/`ai/`/`apps/*/{simulation,ai}`                                                                                                                                                                                                                                                                                    |
| 2     | `electron/main` core imports no game (only the 3 registries)     | `games/`/non-engine `@chimera-engine/*` in `electron/main/` (Check 10)                                                                                                                                                                                                                                                                                                         |
| 3     | `GameSnapshot` stays in main                                     | `GameSnapshot` in `electron/preload/`, `renderer/`, or `apps/*/{screens,shell,scene,renderer}`                                                                                                                                                                                                                                                                                 |
| 11    | Games must not register the reserved `engine:` type namespace    | `type:['"]engine:` literal in `apps/*/{simulation,ai}` (Check 20)                                                                                                                                                                                                                                                                                                              |
| 27    | `CHIMERA_DEBUG` never set by packaging config                    | `CHIMERA_DEBUG` in `package.json` / electron-builder / forge configs                                                                                                                                                                                                                                                                                                           |
| 27    | `IS_DEBUG_MODE` keeps define-replaceable shape                   | dot-access `process.env.CHIMERA_DEBUG === '1'` and `process.env.NODE_ENV !== 'production'` pinned in `simulation/foundation/constants.ts`. The verbatim copy in the debug gate (`electron/main/index.ts`) needs a parser and is pinned by `tools/packaged-build-flag.test.ts` + the real-bundle assertion in `apps/tactics/electron/__tests__/packaged-bundle-content.test.ts` |
| 43    | `validate()`/`reduce()` deterministic                            | same as #2                                                                                                                                                                                                                                                                                                                                                                     |
| 2/43  | Reducers pure — no env reads or node I/O (per-game + engine)     | `process\.env` or a `node:`/bare `fs\|child_process\|net\|http(s)\|dns\|dgram\|tls\|readline\|cluster\|worker_threads` import in `simulation/`/`ai/`/`apps/*/{simulation,ai}`; `foundation/constants.ts` + `content/ContentLoader.ts` exempt, `node:crypto` excluded (Check 19)                                                                                                |
| 75/44 | No float literals in per-game simulation state                   | `[0-9]+\.[0-9]` decimal literal in `apps/*/simulation`; a full-line comment is dropped, a trailing comment still fires (Check 21)                                                                                                                                                                                                                                              |
| 47    | Engine doesn't import provider-specific dirs                     | `from.*games/` in `simulation/`/`ai/`                                                                                                                                                                                                                                                                                                                                          |
| 47    | `electron/main` orchestration imports the networking barrel only | `networking/provider/(local\|steam)/` import in `electron/main/` (≠ `index.ts`) (Check 15)                                                                                                                                                                                                                                                                                     |
| 48/80 | `GameShell.tsx`/`InGameMenuHost.tsx` stay game-agnostic          | `games/`/non-engine `@chimera-engine/*` in `renderer/components/shell/{GameShell,InGameMenuHost}.tsx` (Check 7)                                                                                                                                                                                                                                                                |
| 87    | Game screens barrel `React.lazy`-wraps every screen              | static same-dir `from './…'` value import (type-only excluded) in the screens barrel `index.ts(x)` (Check 22)                                                                                                                                                                                                                                                                  |
| 94    | Engine shell pages import no game                                | `games/`/non-engine `@chimera-engine/*` in `renderer/app/*/` (every page dir, incl. logo-screen) and `renderer/game/` (Check 16)                                                                                                                                                                                                                                               |
| 96    | Game renderer surfaces use only the public renderer barrels      | non-barrel `@chimera-engine/renderer/*` in `apps/*/{screens,shell}/*.tsx`; barrels: ui/chat/r3f (components/) + i18n/game (top-level) (Check 17)                                                                                                                                                                                                                               |
| 97    | Game fonts local — no external font URLs                         | `fonts\.gstatic\.com`/`fonts\.googleapis\.com`/`url\(['"]?https?://` in `apps/*/{shell,styles,screens,assets}`, incl. `.css` (Check 24)                                                                                                                                                                                                                                        |
| 100   | Game lobby/shell surfaces perform no privileged lobby writes     | `LobbyManager\|lobbyStore\|__chimera.*\.lobby` in `apps/*/{shell,screens}` (Check 23)                                                                                                                                                                                                                                                                                          |
| 106   | `ai/` is the game-agnostic framework only (containment)          | non-`engine`/`__tests__`/`dist` dir or non-`index.ts` `.ts`/`.tsx` file under `ai/` (Check 11)                                                                                                                                                                                                                                                                                 |
| 107   | `ai/` defines no game tokens; only `engine:` crosses             | `TACTICS_` constant or `'<gameId>:'` namespace (≠ `engine:`) in `ai/` (Check 12)                                                                                                                                                                                                                                                                                               |
| 110   | i18n runtime stays renderer-only                                 | `renderer/i18n\|useTranslate\|I18nProvider\|formatMessage\|TranslationBundle\|TranslationKey` in `simulation/`/`ai/`/`networking/`/`apps/*/{simulation,ai}` (Check 18)                                                                                                                                                                                                         |

Boundary checks: `from.*electron/`/bare `@chimera-engine/electron` inside `simulation/`/`ai/`/`apps/*/{simulation,ai}`, and `from.*games/` inside `simulation/`/`ai/` (Check 4 scans engine dirs only).

## Manual-Only

| #     | Why                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4     | Renderer reads-not-writes — needs component code review                                                                                                                                                                                                |
| 8     | Outbound gate — needs the broadcast/IPC send paths read for direct reads                                                                                                                                                                               |
| 12    | Pipeline step ordering — needs `ActionPipeline` reading                                                                                                                                                                                                |
| 13    | `ContentDatabase` immutability — constructor/mutation analysis                                                                                                                                                                                         |
| 17    | Honest-AI projection on every delivery path — a raw spread type-checks anyway                                                                                                                                                                          |
| 23/33 | Atomic file writes (`.tmp` + rename) — FS impl reading                                                                                                                                                                                                 |
| 44    | Float fields in `GameSnapshot` — decimal-notation literal floats (e.g. `0.5`) in per-game simulation are caught by Check 21; leading-dot (`.5`), exponential (`1e-3`), aliased (`type Money = number`), and computed floats still need type inspection |

## Usage

**Developer self-check** (before commit): run after touching `simulation/`/`ai/`/`apps/`/`electron/`. Fix violations before commit. Pre-commit gate fires the pnpm checks; this script is a complementary early warning.

**Reviewer** (Steps 6+7): run after checking out branch under review. Include full output in findings. Non-zero → BLOCK. Zero exit means manual checklist still applies.

## Output

```
[invariant-2] simulation/engine/ActionPipeline.ts:42  Math.random()
[invariant-3] electron/preload/api.ts:17  GameSnapshot
---
2 violation(s) found. Fix them and re-run.
```

Clean: `All invariant checks passed.`
