---
title: 'Architecture Invariants Roll-Call'
description: 'Merge-readiness audit of the architecture invariants hardening set: an explicit per-invariant enforcement roll-call (all 126) plus the full-gate and firing-proof record. Every invariant is classified enforced-by | code-verified | doc-only with concrete evidence.'
tags: [invariants, review-gate, audit, roll-call, hardening]
---

# Architecture Invariants Roll-Call

> Review gate for the **architecture invariants hardening** set. This is the
> merge-readiness record: it ratifies the whole hardening set, captures the full quality-gate
> run, and — the artifact the original part-by-part audit lacked — classifies **every one of the
> 126** [architecture invariants](architecture-invariants.md) by **how it is actually held up**.
>
> Related: [Architecture Invariants](architecture-invariants.md) · [Module Boundaries](module-boundaries-file-tree.md)

---

## What "status" means

Each invariant is assigned exactly one enforcement status:

- **enforced-by** — a **standing mechanical guard** fails CI on any violation: a
  `check-invariants.sh` Check, an ESLint rule, or `validate-assets`. The strongest tier: a
  regression is caught without anyone remembering to look.
- **code-verified** — no standing mechanical guard, but a **dedicated automated test** asserts
  the property (unit / integration / e2e / contract). A regression is caught the moment that
  test runs in the gate.
- **doc-only** — a **prose architectural contract** with neither a mechanical guard nor a
  dedicated test proving the negative. A boundary check usually blocks the most obvious
  violation, but the full contract rests on review discipline. These are flagged honestly, not
  dressed up.

Where both a guard and tests exist, the row is **enforced-by** and names the guard first.

## Coverage summary

| Status                                | Count   | Share    |
| ------------------------------------- | ------- | -------- |
| **enforced-by** (mechanical CI guard) | 48      | 38%      |
| **code-verified** (dedicated test)    | 70      | 56%      |
| **doc-only** (prose contract)         | 8       | 6%       |
| **Total**                             | **126** | **100%** |

**94% of invariants (118 / 126) are caught automatically** — by a checker Check, an ESLint
rule, `validate-assets`, or a dedicated test in the gate. The 8 doc-only rows (#4, #20, #36,
#40, #53, #74, #84, #105) are architectural principles whose full contract is not directly
testable; each names its nearest partial guard below.

**#116–#126 graduated here in F74 #923.** They were held in a separate _design-stage_ section
of [architecture-invariants.md](architecture-invariants.md) while the cue / fade / crossfade
behaviour landed across #910–#922, deliberately outside this roll-call's total. The
enforced-by share **fell** on graduation (40% → 38%) and that is the honest reading: nine of
the eleven are held by dedicated tests rather than by a standing guard, because what they
assert — which `AudioParam` a ramp writes, what a voice's phase is mid-fade, how preemption
orders four keys — is runtime behaviour no grep or lint rule can see. Only #124 (the
sim→renderer import ban) and #125 (the `validate-assets` cue-sheet gate) reduce to a
mechanical check.

## Gate run (merge-readiness record)

Run on the hardening branch, base `main` @ `06205101`, 2026-07-24. All green:

| Step              | Command                                                    | Result                         |
| ----------------- | ---------------------------------------------------------- | ------------------------------ |
| Invariant checker | `.claude/skills/invariants/scripts/check-invariants.sh`    | **exit 0**                     |
| Checker self-test | `.claude/skills/invariants/tests/check-invariants.test.sh` | **101 / 101 pass**             |
| Build             | `pnpm build`                                               | **exit 0**                     |
| Typecheck         | `pnpm typecheck`                                           | **exit 0**                     |
| Lint              | `pnpm lint`                                                | **exit 0**                     |
| Unit tests        | `pnpm test`                                                | **exit 0**                     |
| Asset validation  | `pnpm validate:assets`                                     | **exit 0**                     |
| E2E               | `pnpm test:e2e`                                            | **exit 0 — 137 passed (2.9m)** |

The code-reviewer subagent does **not** run e2e; it was run explicitly here.

### F74 graduation run (#923)

Re-run in full when #116–#126 graduated, base `main` @ `ce59bf95`, 2026-07-27. All green:

| Step              | Command                                                                    | Result                         |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------ |
| Invariant checker | `.claude/skills/invariants/scripts/check-invariants.sh`                    | **exit 0**                     |
| Checker self-test | `.claude/skills/invariants/tests/check-invariants.test.sh`                 | **105 / 105 pass**             |
| `.github` mirror  | same two scripts under `.github/skills/invariants/` (mirror since removed) | **exit 0 · 105 / 105 pass**    |
| Build             | `pnpm build`                                                               | **exit 0**                     |
| Typecheck         | `pnpm typecheck`                                                           | **exit 0**                     |
| Lint              | `pnpm lint`                                                                | **exit 0**                     |
| Unit tests        | `pnpm test`                                                                | **exit 0 — 8686 passed**       |
| Asset validation  | `pnpm validate:assets`                                                     | **exit 0**                     |
| E2E               | `pnpm test:e2e`                                                            | **exit 0 — 140 passed (2.7m)** |

The 3 new e2e are `audio-smoke.spec.ts` (137 → 140), and the checker self-test gained 4 cases
(101 → 105). E2E was again run explicitly, for the same reason.

Review also caught a live regression this task had introduced, worth recording because the
gate above ran green across it: rewriting the Tactics manifest to name its refs through the
game’s own `AssetRef` const left `validate-assets` unable to read a single one, so **every**
Tactics entry silently dropped out of the Invariant #22 existence check and the Invariant #52
membership set — a manifest ref to a deleted file passed the build. Nothing in the gate could
surface it, because the checks it disabled only ever report by failing. The manifest walker
now resolves a same-file const member (Invariant #52), pinned by a test asserting a present
and an absent ref together: a reader that resolved neither would report the same empty
`missing` list as one that resolved both.

---

## The roll-call — all 126 invariants

| #   | Invariant (short)                                         | Status        | Enforced-by / evidence                                                                                                                                                    |
| --- | --------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `simulation/` zero React/DOM/net deps                     | enforced-by   | Check 13 + Checks 2/3; ESLint import-boundary flat zones (`@chimera-engine/simulation` contracts only)                                                                    |
| 2   | `applyAction`/`reduce` are pure                           | enforced-by   | Check 19 (gameplay purity) + Check 1/43; ESLint `no-main-games-import`                                                                                                    |
| 3   | `GameSnapshot` never leaves main process                  | enforced-by   | Check 6 (absent from preload/renderer/game surfaces); reaffirmed by #114                                                                                                  |
| 4   | Renderer reads, never writes state                        | doc-only      | nearest: Check 5 (renderer↛electron/main) + Check 26 (IPC contained)                                                                                                      |
| 5   | IPC declared in `ipc-handlers`, via preload               | enforced-by   | Check 26 + ESLint preload import-boundary zone                                                                                                                            |
| 6   | Network messages validated before simulation              | code-verified | `networking/…/MessageRouter.test.ts` › tampered ACTION checksum not forwarded                                                                                             |
| 7   | undo/redo are `EngineAction`s, no side-door               | code-verified | `simulation/engine/ActionPipeline.test.ts` › engine:undo interception via UndoManager                                                                                     |
| 8   | `StateProjector.project()` mandatory outbound gate        | enforced-by   | Check 6 + Check 25 site-pin `StateBroadcaster` `.project(`; behavior in `StateProjector.test.ts`                                                                          |
| 9   | `CommitmentScheme.verify()` gates REVEAL client-side      | code-verified | `CommitmentScheme.test.ts` (tampered value fails verify); Check 25 site-pins the call                                                                                     |
| 10  | `ActionRegistry.resolve` gates action delegation          | code-verified | `ActionRegistry.test.ts` › unknown type throws; register→resolve→execute round-trip                                                                                       |
| 11  | `engine:` action namespace reserved                       | enforced-by   | Check 20; also `ActionRegistry.test.ts` NamespaceCollisionError                                                                                                           |
| 12  | `ActionPipeline` step ordering invariant                  | code-verified | `ActionPipeline.test.ts` › Stage 1 tick / Stage 2 schema / Stage 5 reduce ordering                                                                                        |
| 13  | `ContentDatabase` deep immutability after load            | code-verified | `ContentDatabase.test.ts` › deep immutability (#13) — freezes nested values _(red-first)_                                                                                 |
| 14  | Content + refs validated before tick; fatal               | code-verified | `ContentLoader.test.ts` refs-by-default; `index.test.ts` › main() fatal content load _(red-first)_                                                                        |
| 15  | Content is JSON-only, no executable code                  | code-verified | `ContentLoader.test.ts` › ignores non-`.json` files (loader is JSON-only)                                                                                                 |
| 16  | AI actions go through `ActionPipeline`                    | code-verified | `ai/engine/CommandContext.test.ts` › dispatch via injected callback (sole AI action path)                                                                                 |
| 17  | AI receives projected `PlayerSnapshot` (honest)           | code-verified | `HostedSessionAgents.test.ts` › initial-state projection (#17) _(red-first)_                                                                                              |
| 18  | `AIParams` passed frozen by value                         | code-verified | `AIStateMachine.test.ts` › params passed to onTick are frozen                                                                                                             |
| 19  | One AI transition per tick, last wins                     | code-verified | `AIStateMachine.test.ts` › two transitions in a tick, last name wins                                                                                                      |
| 20  | Simulation never resolves `AssetRef`                      | doc-only      | nearest: Check 2/3 (sim↛renderer, where AssetManager lives); `AssetRef` stays opaque in sim                                                                               |
| 21  | `AssetManager.dispose()` on every session end             | code-verified | `AssetManager.test.ts` › dispose clears cache; Check 25 site-pins `GameShell` `assetManager.dispose(`                                                                     |
| 22  | `AssetRef`s pass `validate-assets` before merge           | enforced-by   | `validate-assets` (declared-ref resolution + manifest membership + on-demand scan); `electron/dev-tools/validate-assets/index.test.ts`                                    |
| 23  | `FileSaveRepository.save()` atomic tmp+rename             | code-verified | `FileSaveRepository.test.ts` (tmp cleanup on rename fail) + `.fsync.test.ts`; Check 25 site-pins `fs.rename(tmp,dest)`                                                    |
| 24  | `applyRestoredFile` sole disk→live-state entry            | enforced-by   | Check 27 (only disk→live-state entrypoint)                                                                                                                                |
| 25  | `engine:save`/`load` host-only validated actions          | code-verified | `EngineActions.test.ts` › validate ok:false when `playerId !== hostPlayerId` (#25)                                                                                        |
| 26  | `pendingCommitments` restored into scheme                 | code-verified | `SaveFile.test.ts` › round-trip preserves stagedReveals for commitment mode (#26)                                                                                         |
| 27  | `CHIMERA_DEBUG` absent from production runtime            | enforced-by   | Check 8 + Check 9 (define-replaceable shape); red-first `startup.test.ts` / `index.test.ts`                                                                               |
| 28  | Debug data surface only via `debug-api`                   | code-verified | `debug-api.test.ts` › exposes `__chimeraDebug`, never `__chimera` (28)                                                                                                    |
| 29  | Debug handler validates Inspector sender id               | code-verified | `debug-bridge.test.ts` › rejects a foreign sender, accepts the Inspector window                                                                                           |
| 30  | `SnapshotRingBuffer` fixed capacity, no growth            | code-verified | `SnapshotRingBuffer.test.ts` › overwrite at capacity (#30)                                                                                                                |
| 31  | Debug objects instantiated only in debug mode             | code-verified | `ActionPipeline.test.ts` › debugObserver undefined = production path (#31)                                                                                                |
| 32  | Settings never inside authoritative state                 | enforced-by   | Check 29 (no settings/camera/profile in authoritative state)                                                                                                              |
| 33  | `FileSettingsRepository` atomic save (.tmp+rename)        | code-verified | `FileSettingsRepository.test.ts` › leaves no `.tmp` after successful save                                                                                                 |
| 34  | `registerSchema` before `getSettings`; unregistered warns | code-verified | `SettingsManager.test.ts` › engine defaults for unregistered gameId + warn (#34) _(red-first)_                                                                            |
| 35  | Engine namespaces reach `registerSchema` intact           | code-verified | `SettingsManager.test.ts` › SettingsNamespaceCollisionError suite; `index.test.ts` schema guard _(red-first)_                                                             |
| 36  | Simulation never reads settings                           | doc-only      | nearest: `simulation/` import-boundary zone + Check 13 (leaf) + Check 19 (no env reads)                                                                                   |
| 37  | `SaveManager` built with injected `SaveRepository`        | code-verified | `SaveManager.test.ts` › constructs with `InMemorySaveRepository`; no concrete import                                                                                      |
| 38  | `LobbyManager` built with injected provider               | enforced-by   | ESLint `no-main-provider-internals` (bans concrete-provider import); DI construction tests                                                                                |
| 39  | Broadcaster/router avoid provider-internal dirs           | enforced-by   | ESLint `no-main-provider-internals` + Check 15 (barrel-only) — _invariant text aligned to enforcement_                                                                    |
| 40  | No provider swap during active session                    | doc-only      | nearest: `LobbyManager.test.ts` closeLobby lifecycle tests                                                                                                                |
| 41  | `InMemory` passes `File` contract suite                   | code-verified | shared `runSaveRepositoryContractTests` run for both (`SaveRepository.contract.test.ts` + `FileSaveRepository.test.ts`)                                                   |
| 42  | Tick action-driven, never wall-clock                      | enforced-by   | Check 1/43 (no Date.now/performance.now in sim); tick+1 asserted in pipeline tests                                                                                        |
| 43  | `validate`/`reduce` pure, no I/O/random                   | enforced-by   | Check 1/43 + Check 19; ESLint `no-restricted-globals` determinism zone                                                                                                    |
| 44  | Simulation state integers only, no float                  | enforced-by   | Check 21 (no float literals in per-game sim state); ESLint `no-fromfloat-in-simulation`                                                                                   |
| 45  | `ActionHistory` bounded; overflow warn wired              | code-verified | `logger-wiring.integration.test.ts` › #45 action-history:overflow warn _(red-first)_                                                                                      |
| 46  | `ctx.db` undefined tolerated when no content              | code-verified | `ActionPipeline.test.ts` › `ctx.db` undefined in validate()/reduce() when no db                                                                                           |
| 47  | Orchestration uses provider interfaces only               | enforced-by   | Check 4 + Check 14 + Check 15; ESLint `no-main-provider-internals`                                                                                                        |
| 48  | `GameShell` is game-agnostic                              | enforced-by   | Check 7; ESLint `no-shell-games-import`                                                                                                                                   |
| 49  | Scene transitions host-authoritative                      | code-verified | `SceneManager.test.ts` › rejects scene_prepare from non-host; `SceneActionWiring.test.ts`                                                                                 |
| 50  | Scene `initialize`/`teardown` pure reducers               | enforced-by   | Check 1/43 + Check 19 cover `simulation/scene`; code-verified `SceneManager.test.ts` (`ctx.rng`)                                                                          |
| 51  | Clients never drive scene change                          | code-verified | `SceneManager.test.ts` › host-side `requestTransition` policy; non-host rejected                                                                                          |
| 52  | Scene assets declared, not on-demand                      | enforced-by   | `validate-assets` declared-ref + manifest membership + on-demand static detector; `electron/dev-tools/validate-assets/index.test.ts`                                      |
| 53  | `TransitionOverlay` renderer-only; fade never gates sim   | doc-only      | nearest: Check 2 (sim has no fade knowledge); no test asserts SceneReadyAction ordering                                                                                   |
| 54  | Timer `remainingTicks` never wall-clock                   | enforced-by   | Check 1/43 (no Date.now in sim); code-verified `GameTimer.test.ts`                                                                                                        |
| 55  | `TimerManager.advance()` one consumer                     | enforced-by   | Check 28 (only `engine:tick` consumes advance)                                                                                                                            |
| 56  | `curves`/`useTween` renderer-only, not in sim             | enforced-by   | Check 2 (sim↛renderer); modules live in `renderer/utils`,`renderer/hooks`                                                                                                 |
| 57  | Camera state renderer-only, not in snapshot               | enforced-by   | Check 29 (no camera in authoritative state)                                                                                                                               |
| 58  | `isHovered` is local component state                      | code-verified | `useGameInteraction.test.tsx` › updates isHovered on pointer enter, no store/IPC write                                                                                    |
| 59  | Profile data never in snapshot                            | enforced-by   | Check 29 (no profile in authoritative state)                                                                                                                              |
| 60  | `ProfileRepository` persists only local profiles          | code-verified | `InMemoryProfileRepository.test.ts` + `PlayerDirectory.test.ts` (local vs in-memory remote)                                                                               |
| 61  | `admit()` is mandatory profile trust gate                 | enforced-by   | ESLint call-site restriction + Check 25 pin; behavior in `ProfileSanitizer.test.ts` (7 rejection types)                                                                   |
| 62  | `PROFILE_UPDATE` travels out-of-band                      | code-verified | `MessageRouter.test.ts` › routes PROFILE_UPDATE to side-channel, bypasses pipeline                                                                                        |
| 63  | Simulation never imports `renderer/audio`                 | enforced-by   | Check 2 (sim↛renderer, incl. renderer/audio)                                                                                                                              |
| 64  | `Providers` owns `AudioManager.dispose` lifecycle         | code-verified | `providers.test.tsx` disposes on unmount; `GameShell.test.tsx` does not dispose on shell unmount                                                                          |
| 65  | `InputManager` renderer-only, sends actions               | enforced-by   | Check 2/3 (sim↛renderer); code-verified `InputManager.test.ts`                                                                                                            |
| 66  | Key bindings are settings, not profile                    | code-verified | `KeyBindingRepository.test.ts` › controls.bindings from active game settings + engine fallback                                                                            |
| 67  | Main-process logging via injected logger                  | enforced-by   | Check 31 + `no-console` zone (pinned by `eslint-no-console.test.ts`); red-first logger tests                                                                              |
| 68  | Crash reporter autosaves then atomic dump                 | code-verified | `crash-reporter.test.ts` › autosave before dump + atomic (.tmp+rename); `.fsync.test.ts`                                                                                  |
| 69  | No automatic telemetry/log egress                         | enforced-by   | Check 31 egress hygiene (no fetch/http(s) client import in `electron/main`)                                                                                               |
| 70  | `ReplayPlayer` reuses live `ActionPipeline`               | code-verified | `ReplayPlayer.test.ts` › applies via injected pipeline; DeterminismError on tick mismatch                                                                                 |
| 71  | `ReplayFile` requires seed+actions                        | code-verified | `ReplayFile.test.ts` › ReplayParseError when seed / actions missing                                                                                                       |
| 72  | CHAT out-of-band, not `EngineAction`                      | code-verified | `chat.test.ts` (distinct type, no tick/pipeline) + `ChatRelay.test.ts` off-pipeline delivery                                                                              |
| 73  | `ChatRelay.relay()` is mandatory gate                     | enforced-by   | Check 25 pins the `ChatRelay.relay()` site; behavior in `ChatRelay.test.ts` (all reject branches)                                                                         |
| 74  | `toastStore` renderer-only, not snapshot-derived          | doc-only      | nearest: `toastStore.test.ts` (push/dismiss immutability); no test forbids snapshot derivation                                                                            |
| 75  | `FixedPoint` only fractional in snapshot                  | enforced-by   | Check 21 (no float literals in `apps/*/simulation`)                                                                                                                       |
| 76  | `fromFloat` only at content-load                          | enforced-by   | ESLint `no-fromfloat-in-simulation` (rule + test; engine + `apps/*/{simulation,ai}` zones)                                                                                |
| 77  | Dev harness refuses production runtime                    | code-verified | `harness.test.ts` › throws HarnessGuardError at NODE_ENV=production / flag unset (#77)                                                                                    |
| 78  | Harness instances use isolated `userData`                 | code-verified | `harness.test.ts` › isolates `.dev-userdata/p<i>`; announce file inside host dir (#78)                                                                                    |
| 79  | `registerExtension` before `buildExtensionsApi`/expose    | code-verified | `api.test.ts` › exposeInMainWorld once; registered extension survives to payload                                                                                          |
| 80  | `GameShell`/`InGameMenuHost` no games import              | enforced-by   | Check 7; ESLint `no-shell-games-import`                                                                                                                                   |
| 81  | `board` is only required registry slot                    | code-verified | `game-screen-contract.test.ts` › registry with only board is valid (#81)                                                                                                  |
| 82  | Panel navigation renderer-local, no IPC                   | code-verified | `SceneRouter.test.tsx` renders screen via uiStore w/o IPC; `uiStore.test.ts` local key change                                                                             |
| 83  | Engine contexts null + throwing hook                      | code-verified | `SetGameAssetManagerContext.test.tsx` + `InputActionRegistryContext.test.tsx` › throws outside provider _(red-first)_                                                     |
| 84  | Screens use context hooks, not singletons                 | doc-only      | nearest: context-hook tests (Asset/Audio/ContentDatabase); no guard bans singleton module import                                                                          |
| 85  | Overrides only redefine declared tokens                   | enforced-by   | Check 30(c) + ESLint `no-unknown-token-overrides`; red-first `tokens.test.ts`                                                                                             |
| 86  | Engine UI no hardcoded design values                      | enforced-by   | Check 30(b) + ESLint `no-hardcoded-design-values`                                                                                                                         |
| 87  | Game screens barrel `React.lazy`-only                     | enforced-by   | Check 22 (barrel exports only React.lazy screens)                                                                                                                         |
| 88  | `GameShell` wraps screens in Suspense                     | code-verified | `GameShell.test.tsx` › resolves a `React.lazy` board (only succeeds under a Suspense ancestor)                                                                            |
| 89  | Dispatch depth bounded; `RecursiveDispatchError`          | code-verified | `RecursiveDispatchError.test.ts` › MAX_NESTED_DISPATCH === 16; `ActionPipeline` throw path                                                                                |
| 90  | `ReduceContext.logger` engine-internal only               | code-verified | `logger-wiring.integration.test.ts` (#90 tick warn); absent from public `GameReduceContext`                                                                               |
| 91  | Shell pages no hardcoded inline styles                    | enforced-by   | ESLint `no-hardcoded-design-values` (rule header cites #86 & #91)                                                                                                         |
| 92  | Shell pages use `<Button>`, not raw button                | code-verified | `renderMainMenuDefinition.test.tsx` › Invariant #92 — no raw `<button>` bypassing `<Button>`                                                                              |
| 93  | Override CSS not imported by shell pages                  | enforced-by   | ESLint `no-shell-games-import` (dedicated `tokens-override.css` branch + rule test)                                                                                       |
| 94  | Shell pages import no `games/*`                           | enforced-by   | Check 16 + ESLint `no-shell-games-import`                                                                                                                                 |
| 95  | `get-current-snapshot` read-only replay IPC               | code-verified | `ipc-handlers.test.ts` › returns injected snapshot or null, no mutation accessor                                                                                          |
| 96  | Game renderer imports only public barrels                 | enforced-by   | Check 17 + ESLint `no-game-renderer-internals`                                                                                                                            |
| 97  | Game fonts local, no external URLs                        | enforced-by   | Check 24 + `validate-assets` font `src` external-URL check; `electron/dev-tools/validate-assets/index.test.ts`                                                            |
| 98  | Perspective replay rejected malformed at parse            | code-verified | `PerspectiveReplayFile.test.ts` › tick/viewerId disagree, out-of-order/duplicate ticks, kind discriminator                                                                |
| 99  | Match settings host-authored, attributes owner-authored   | code-verified | `LobbyManager.test.ts` › rejects setMatchSetting from joined session; rejects other-seat attribute                                                                        |
| 100 | Game `LobbyScreen` performs no privileged writes          | enforced-by   | Check 23 (game lobby/shell surfaces perform no privileged lobby writes)                                                                                                   |
| 101 | `setup`/`matchId` projected verbatim to all viewers       | code-verified | `StateProjector.test.ts` › setup verbatim, matchId identical, session manifest never crosses projection                                                                   |
| 102 | `endTurnGuard`/`endTurnAuthority` engine-only gate        | code-verified | `EngineActions.test.ts` › per-game endTurnGuard rejection; endTurnAuthority replaces active-player check                                                                  |
| 103 | Commit-then-sync turn mode opt-in                         | code-verified | `apps/tactics/…/turnGate.test.ts` › blocked until every seat committed; e2e `tactics-commitment.spec.ts`                                                                  |
| 104 | `resolveRevealOrder` deterministic, applied verbatim      | code-verified | `apps/tactics/…/revealOrder.test.ts` › identical (seed,tick) yields identical order; `CommitmentScheme.test.ts`                                                           |
| 105 | Per-turn resources are game-reducer host state            | doc-only      | nearest: Check 1/43 determinism + Check 29 hygiene + `StateProjector` projection tests                                                                                    |
| 106 | `ai/` is game-agnostic framework only                     | enforced-by   | Check 11 (ai/ containment)                                                                                                                                                |
| 107 | No game-specific tokens in `ai/`, `shared/`               | enforced-by   | Check 12 (no game tokens/namespaces in game-agnostic packages)                                                                                                            |
| 108 | `SaveFile.session` is session-composition metadata only   | code-verified | `SessionRuntime.test.ts` captureSaveFile + manifest stamping; `SessionRestoreCoordinator.test.ts` sanitize; `ipc-handlers.test.ts` toRestoreStatusEvent                   |
| 109 | Engine motion via `ch-*` keyframes and tokens             | enforced-by   | Check 30 (engine CSS token discipline: module-local @keyframes / hardcoded values / undeclared tokens)                                                                    |
| 110 | i18n runtime stays renderer-only                          | enforced-by   | Check 18 (i18n runtime renderer-only)                                                                                                                                     |
| 111 | i18n opt-in strictly additive                             | code-verified | `LanguageSelector.test.tsx` renders null (<2 langs); `SettingsLanguageSelector.test.tsx` self-hides                                                                       |
| 112 | Token fallback: override→English→raw key                  | code-verified | `translation-bundle.test.ts` › `resolveTranslation` (override wins, engine default, raw key, token-mode)                                                                  |
| 113 | Game icons via `LoadedRendererGameShell.icons` seam       | code-verified | `Icon.test.tsx` game-first re-skin / engine fallback / unknown renders nothing; `useActiveGameIcons.test.tsx`; `IconProvider.test.tsx`                                    |
| 114 | Spectator is read-only non-participant                    | code-verified | `joinClassifier.test.ts` admission+rejection; `SpectatorRegistry.test.ts`; `game/page.test.tsx` suppresses dispatch; e2e `spectator-mode.spec.ts`                         |
| 115 | Spectate-target switch is out-of-band cosmetic            | code-verified | `LobbyManager.test.ts` › setSpectatorTarget forwards to host + no-op guards; `spectator-api.test.ts`                                                                      |
| 116 | Fades write only a voice's own stage-1 gain               | code-verified | `AudioManager.test.ts` › writes only the voice gain, never a bus or master gain (#116) — bus/master automation snapshotted, not counted                                   |
| 117 | Cue validation is two-tier, by provenance                 | code-verified | `AudioManager.test.ts` › rejects a to-before-from window at play() without reserving a voice (#117); zero-length window; `to` bounds elapsed play                         |
| 118 | Cue resolution is fail-soft, never throws                 | code-verified | `AudioManager.test.ts` › abandons the play with one warning when a load-bearing from cue is unresolvable (#118); prototype-member cue treated as absent                   |
| 119 | Fade-out-then-stop releases via native `onended`          | code-verified | `AudioManager.test.ts` › ramps to silence and hands the release to the native onended path (#119); invalidates the handle exactly once                                    |
| 120 | Ramps cancel-and-re-anchor at a bounded held value        | code-verified | `AudioManager.test.ts` › departs a fade-in from the floor it wrote, not from what the param can report (#121, #120); exponential floor + linear degrade                   |
| 121 | Pre-start intents apply atomically at `t0`, in order      | code-verified | `AudioManager.test.ts` › parks PlayOptions.fadeIn on the record as a pending intent (#121); schedules no ramp while the voice is loading                                  |
| 122 | Fade timing derives from context time, never wall-clock   | code-verified | `AudioManager.test.ts` › records the playhead anchors a later fade derives its timing from (#122); effective (not requested) loop window                                  |
| 123 | Preemption ranks four lexicographic terms                 | code-verified | `AudioManager.test.ts` › reclaims a fading-out voice ahead of a live one it outranks and post-dates (#123); `MUSIC_PRIORITY === 100`; no class exempt                     |
| 124 | Cue sheets are sim-authored, renderer-read only           | enforced-by   | Check 2 + Check 13 (sim↛renderer, incl. `renderer/audio`; fixtures pin `simulation/foundation/audio-cue-sheet.ts`); `audioManifest.test.ts` `unknown` slot                |
| 125 | `validate-assets` range-checks every cue sheet            | enforced-by   | `validate-assets` audio-cue-sheet gate (`electron/dev-tools/validate-assets/index.test.ts`); non-vacuous since #923 — `apps/tactics/asset-manifest.ts` carries two sheets |
| 126 | `AudioHandle` gains no fields; never spread-built         | code-verified | `AudioManager.test.ts` › exposes exactly id, ref, bus, priority, and valid (#126); builds the handle from a class, never from a spread literal                            |

---

## Spot-audit — highest-risk rows

The audit asserted 115/115 coverage but produced no per-invariant verdict. These rows had the
weakest automatic verdict or were reported by no audit group individually; each was checked to a
concrete test.

- **#113 — game-contributed icon seam.** No audit group reported this one individually. Verified
  **code-verified**: `renderer/components/ui/icons/Icon.test.tsx` asserts game-first resolution
  (`gameIcons?.[name] ?? ICON_REGISTRY[name]`), engine fallback, and the "unknown name renders
  nothing + dev-warns" branch; `useActiveGameIcons.test.tsx` covers the
  `LoadedRendererGameShell.icons` registry seam; `IconProvider.test.tsx` covers publish +
  inert-null. The `IconContext` null-default carve-out (noted on #83) is consistent with the
  invariant text.
- **#108 — `SaveFile.session` metadata.** Verified **code-verified** across the write path
  (`SessionRuntime.test.ts` captureSaveFile + manifest stamping), the sanitised restore-status
  projection (`ipc-handlers.test.ts` toRestoreStatusEvent — matchId + pending seats only), and
  the restore wiring (`SessionRestoreCoordinator.test.ts` sanitizeRestoreManifest).
- **#110–#112 (i18n).** #110 **enforced-by** Check 18 (runtime renderer-only); #111 and #112
  **code-verified** (additive-render-null; `resolveTranslation` fallback chain including debug
  token-mode).
- **#114 / #115 (spectator).** Both **code-verified** end-to-end: host join classifier +
  registry unit tests, renderer read-only enforcement, and the `spectator-mode.spec.ts` e2e.

- **#116–#126 (audio cue / fade / crossfade).** The block graduated in F74 #923. Two resolve to a
  standing guard (#124 the sim→renderer import ban, #125 the `validate-assets` cue-sheet gate);
  the other nine are **code-verified** against `AudioManager.test.ts`, which drives a stubbed
  `AudioContext` and reads the automation each verb writes. Two honest limits are worth stating
  rather than smoothing over. #124's mechanical half is the import ban only — that sim never
  _reads_ a sheet is what the ban enforces; that the renderer is the sole reader is held by the
  `unknown`-slot type test and by review. And #125's gate, vacuous in-repo until this task
  (no manifest carried `metadata`), now reaches production input: `apps/tactics/asset-manifest.ts`
  carries two sheets, and a cue moved out of range there fails `pnpm validate:assets`.

No coverage gap was found: every one of the 126 resolves to a mechanical guard or a real test,
except the 8 architectural principles honestly marked doc-only.

## Checker firing proof

Phase-C proof that the guards actually trip. The checker self-test harness
(`check-invariants.test.sh`, **105 cases**) plants synthetic violations in repo-shaped fixture
roots and asserts each Check both **fires** on a violation and **stays clean** on valid code
(negative controls). It exercises the full Check 1–31 range, including the hardening
additions/repairs:

- **Per-game gameplay checks (Checks 19–24):** `Math.random()`/`Date.now()` in
  `apps/<game>/{simulation,ai}`, `renderer/`/`electron/` imports in `apps/<game>/simulation`,
  `GameSnapshot` in `apps/<game>/screens/`, `useTranslate` in `apps/<game>/simulation` — all
  detected.
- **Repaired stale checks (Check 9/13 rebind):** `electron/` import in `simulation/` now caught;
  the anti-rot probes (`missing constants file`, `renamed repo marker`) fire and stay inert in a
  bare fixture root.
- **Named-trust-gate + CSS/logging checks (Checks 25/30/31):** renamed/missing gate site,
  module-local `@keyframes`, hardcoded hex/rgba in engine CSS, undeclared `--ch-*` override, raw
  `console.log`, and `fetch()`/`node:https` egress in main — all detected, with the sanctioned
  exceptions passing clean.
- **Audio barrel + cue-sheet direction (Checks 17/2/13, F74 #923, 4 new cases):** the public
  `@chimera-engine/renderer/audio` barrel passes from a game surface while a deep
  `audio/AudioManager.js` behind it is still flagged `[invariant-96]`; a `renderer/audio` import
  planted in `simulation/foundation/audio-cue-sheet.ts` is flagged `[invariant-1]`, by relative
  path and by package specifier alike. Each was killed by a targeted mutant rather than assumed:
  narrowing Check 17's tail anchor turns the deep-import case green, narrowing Check 2's pattern
  turns the relative-path case green — and the package-specifier case needs **both** Check 2 and
  Check 13 falsified at once, since either alone still catches it. That redundancy is recorded in
  the fixture rather than left as a single-guard claim it would not survive.

## Cross-cutting sanity

- **#27 production-identity fix vs the replay privacy gate — decoupled.** The debug-startup
  guard's `isProductionRuntime` predicate (packaged **or** `NODE_ENV=production`) is separate from
  the renderer's `areDeterministicReplaysVisible()`, which keys off `NEXT_PUBLIC_CHIMERA_PACKAGED`
  (its comment explicitly rejects `NODE_ENV`/`CHIMERA_DEBUG`). The e2e replay specs pass in the
  non-packaged build — recording behaviour unchanged.
- **#27 vs the e2e realtime seam — decoupled.** `electron/main/runtime/e2e-realtime-seam.ts` reads
  `CHIMERA_E2E_REALTIME_TICK_MS` with no reference to `isProductionRuntime`, `app.isPackaged`, or
  `IS_DEBUG_MODE`; `realtime-heartbeat.spec.ts` passes.
- **Doc-drift #39 / #89 / #100 / #106 — corrected and consistent.** #39 text matches the
  `no-main-provider-internals` + Check 15 enforcement; #89 matches the `MAX_NESTED_DISPATCH` /
  `ReduceContext` contract; #100 matches Check 23; #106 matches Check 11. Each row above carries
  its live evidence.

## Per-guard red-first test record

Each guard-repair shipped a test that fails without its fix:

| Guard (invariant)                   | Red-first test evidence                                                                                                                                                                                                                                                | Delivering commit(s)               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| #27 packaged debug refusal          | `electron/main/index.test.ts` (main() CHIMERA_DEBUG production guard); `electron/main/startup.test.ts` (assertProductionDebugGuard packaged builds); `apps/tactics/__tests__/packaged-bundle-content.test.ts`; `tools/verify-packaged-bundle.test.ts`                  | `1655193c`, `0b6d3afe`, `0515bb81` |
| #35 settings namespace collision    | `electron/main/settings/SettingsManager.test.ts` (throws SettingsNamespaceCollisionError…); `electron/main/index.test.ts` (main() game settings schema guard)                                                                                                          | `676a0869`, `adfd928f`             |
| #17 honest-AI projected seed        | `electron/main/runtime/HostedSessionAgents.test.ts` (initial-state projection); `…/session-restore.integration.test.ts` (S1o)                                                                                                                                          | `f118f229`                         |
| #13 / #14 content freeze + refs     | `simulation/content/ContentDatabase.test.ts` (deep immutability); `simulation/content/ContentLoader.test.ts` (refs-by-default); `electron/main/index.test.ts` (main() fatal content load)                                                                              | `f59644ed`                         |
| #45 / #90 / #34 / #67 logger wiring | `electron/main/__tests__/logger-wiring.integration.test.ts` (#45 overflow, #90 tick warn); `…/profile/ProfileManager.test.ts` (#34/#67); `…/__tests__/eslint-no-console.test.ts`; `renderer/app/LoggingBootstrap.test.tsx` + `AppShell.test.tsx` (#67 renderer bridge) | `88680bb1`, `23c6cbd7`, `426c1f9a` |
| #83 throwing context hooks          | `renderer/assets/SetGameAssetManagerContext.test.tsx` + `renderer/input/InputActionRegistryContext.test.tsx` (throws outside the provider)                                                                                                                             | `a798acca`                         |
| #85 Button sizing-token contract    | `renderer/styles/tokens.test.ts` (base button sizing tokens); `electron/dev-tools/eslint/rules/no-unknown-token-overrides.test.ts`                                                                                                                                     | `8916328f`, `c8ee6c07`             |

## Method & honesty notes

- Prefer **enforced-by** whenever a mechanical guard covers the invariant; name the guard first
  and mention any test second.
- Check 25 (named trust-gate pins) proves a gate _site_ exists at its pinned location; the gate's
  _behaviour_ is separately code-verified (e.g. `ProfileSanitizer.admit()`,
  `CommitmentScheme.verify()`, `FileSaveRepository` atomic save). Both are cited where they apply.
- The 8 **doc-only** rows are architectural principles whose full negative is not directly
  testable. The boundary checks and import zones block the obvious violations, but no test asserts
  the negative directly — flagged here rather than inflated into "enforced".

## Cross-references

- [Architecture Invariants](architecture-invariants.md) — the 126 numbered rules.
- [Module Boundaries](module-boundaries-file-tree.md) — the file tree these boundary checks defend.
- Checker: `.claude/skills/invariants/scripts/check-invariants.sh` (Checks 1–31) and its self-test
  `.claude/skills/invariants/tests/check-invariants.test.sh` (105 cases).
