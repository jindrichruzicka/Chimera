---
title: 'Chimera Engine — Core Architecture Overview (Index Hub)'
description: 'Authoritative architecture specification for the Chimera game engine. This file is the canonical index hub; every section has been modularised into focused files under docs/executive-architecture/, docs/core-components/, docs/security-trust/, docs/testing/, and docs/roadmap-sections/ for RAG and agent retrieval.'
tags: [architecture, index, chimera, engine, overview, invariants, ipc, simulation, multiplayer]
---

# Chimera Engine — Core Architecture Overview (Index Hub)

> Version: 1.0.0 · Date: 2026-04-20 · Status: Authoritative baseline
>
> **This file is an index hub.** All sections have been modularised into focused files for RAG and agent retrieval. The full original specification text is preserved below the index.

---

## Index: Executive Architecture

| File                                                                                                           | Contents                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [executive-architecture/system-overview-and-context.md](executive-architecture/system-overview-and-context.md) | §1 Executive Architecture Decision (process boundary table), §2 System Context Diagram, key invariants #1–#4 |
| [executive-architecture/module-boundaries-file-tree.md](executive-architecture/module-boundaries-file-tree.md) | §3 Naming conventions, Module Boundary Table, full annotated file tree for all packages                      |
| [executive-architecture/architecture-invariants.md](executive-architecture/architecture-invariants.md)         | All Invariants with thematic index, verbatim with section back-references                                    |

---

## Index: Core Components (§4)

| File                                                                                                       | Architecture Section | Contents                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [core-components/electron-shell-ipc-bridge.md](core-components/electron-shell-ipc-bridge.md)               | §4.1, §4.1a          | `ChimeraAPI`, namespace interfaces, `ActionRejection`, IPC channel conventions, Extension System                                                      |
| [core-components/simulation-core-action-pipeline.md](core-components/simulation-core-action-pipeline.md)   | §4.2, §4.2.1, §4.7   | `GameSnapshot`, `PlayerSnapshot`, `ActionPipeline` 7-stage, `TurnMemento`, `ActionHistoryEntry`, `UndoManager`                                        |
| [core-components/websocket-message-protocol.md](core-components/websocket-message-protocol.md)             | §4.3                 | `ClientMessage` union, `ServerMessage` union, CRC32 checksums, PING/PONG, REVEAL flow                                                                 |
| [core-components/renderer-state-stores.md](core-components/renderer-state-stores.md)                       | §4.4                 | `SnapshotStore`, `PredictionStore`, full store catalogue (10 stores), `useSendAction()`, `lobbyConfig`, `useLobbyApi()`                               |
| [core-components/undo-redo-policy.md](core-components/undo-redo-policy.md)                                 | §4.5, §7             | `UndoPolicy`, `DEFAULT_UNDO_POLICY`, 7-step undo architecture                                                                                         |
| [core-components/state-projection-interfaces.md](core-components/state-projection-interfaces.md)           | §4.6                 | `StateProjector.project()`, `VisibilityRules`, `CommitmentEnvelope/CommitmentReveal/CommitmentScheme`                                                 |
| [core-components/content-database-data-refs.md](core-components/content-database-data-refs.md)             | §4.8                 | `DataRef<T>`, `ContentDatabase`, `ContentLoader`, error types                                                                                         |
| [core-components/ai-framework-agent-system.md](core-components/ai-framework-agent-system.md)               | §4.9                 | `PlayerAgent`, `AIStateMachine`, `AIBrain`, `CommandScheduler`, per-tick lifecycle                                                                    |
| [core-components/asset-reference-system.md](core-components/asset-reference-system.md)                     | §4.10                | `AssetRef<T>`, `AssetManager`, `useAsset<T>`, CI validation script                                                                                    |
| [core-components/save-load-persistence.md](core-components/save-load-persistence.md)                       | §4.11                | `SaveFile`, `JsonSaveSerializer/CompressedSaveSerializer`, `FileSaveRepository` (atomic `.tmp`), `SaveMigrator`                                       |
| [core-components/runtime-debug-layer.md](core-components/runtime-debug-layer.md)                           | §4.12                | `IS_DEBUG_MODE`, `SnapshotRingBuffer`, `SnapshotInspector`, `SnapshotDiff`, `DebugProtocol`, 6 Inspector UI panels                                    |
| [core-components/settings-system.md](core-components/settings-system.md)                                   | §4.13                | `EngineSettings`, `GameSettingsSchema<T>`, `SettingsMerger` 3-layer merge, `FileSettingsRepository`                                                   |
| [core-components/multiplayer-provider-websocket.md](core-components/multiplayer-provider-websocket.md)     | §4.14                | `MultiplayerProvider/BrowsableProvider`, `LobbyManager`, `StateBroadcaster/MessageRouter`                                                             |
| [core-components/performance-hud-device-info.md](core-components/performance-hud-device-info.md)           | §4.16, §4.17         | `PerfHud` 9-metric overlay, `PerfProbe`, `perfStore`, `DeviceInfo`, `SizeClass` breakpoints                                                           |
| [core-components/scene-transitions-fade.md](core-components/scene-transitions-fade.md)                     | §4.18, §4.19         | `SceneDescriptor`, `SceneRegistry`, two-phase protocol, `TransitionOverlay`, `useFade()`                                                              |
| [core-components/game-timers.md](core-components/game-timers.md)                                           | §4.20                | `GameTimer`, `TimerRegistry`, `TimerManager`, `ctx.dispatch()` semantics                                                                              |
| [core-components/curves-tweening-interaction.md](core-components/curves-tweening-interaction.md)           | §4.21, §4.23         | `EasingFn`, `lerp/easeIn/easeOut`, `useTween`, `useTweenCallback`, `useGameInteraction`, `InteractionBlocker`                                         |
| [core-components/camera-system.md](core-components/camera-system.md)                                       | §4.22                | `CameraMode/CameraPreset`, `GameCanvas` camera props, `CameraController`, `useCamera()`                                                               |
| [core-components/player-profiles-directory.md](core-components/player-profiles-directory.md)               | §4.24                | `EngineProfile`, `AvatarSource`, `ProfileManager`, `PlayerDirectory`, `ProfileSanitizer.admit()`                                                      |
| [core-components/audio-system.md](core-components/audio-system.md)                                         | §4.25                | `AudioManager`, `PlayOptions`, `AudioBusId` (master/music/sfx/voice), `EventAudioBinding`, 32-voice pool                                              |
| [core-components/input-keybindings.md](core-components/input-keybindings.md)                               | §4.26                | `InputActionId`, `InputAction`, `KeyBinding`, `EngineBindings`, `InputManager`, `useInputAction`                                                      |
| [core-components/logging-crash-reporting.md](core-components/logging-crash-reporting.md)                   | §4.27                | `LogLevel/LogEntry/LogSource`, Pino-backed Logger, crash-reporter.ts 3 failure paths, autosave-before-crash-dump                                      |
| [core-components/replay-system.md](core-components/replay-system.md)                                       | §4.28                | `ReplayFile`, `RecordedAction`, `ReplayPlayer`, `ReplayManager`, `ReplayAPI` IPC                                                                      |
| [core-components/chat-system.md](core-components/chat-system.md)                                           | §4.29                | `ChatScope`, `ChatMessage`, `ChatRelay` (token bucket), `chatStore` (500-entry buffer), `ChatPanel.tsx`                                               |
| [core-components/toast-notification-system.md](core-components/toast-notification-system.md)               | §4.30                | `ToastSeverity`, `Toast`, `ToastStore`, `ToastHost.tsx`, engine-wired sources table                                                                   |
| [core-components/fixed-point-math.md](core-components/fixed-point-math.md)                                 | §4.31                | `FixedPoint` = bigint Q32.32, `FP_*` constants, arithmetic suite, transcendentals, ESLint rule                                                        |
| [core-components/dev-tooling.md](core-components/dev-tooling.md)                                           | §4.32                | `pnpm dev:mp <N>`, CLI flags, `HarnessOptions`, startup flow, seed profiles, production guard                                                         |
| [core-components/gameshell-ui-design-system.md](core-components/gameshell-ui-design-system.md)             | §4.33–§4.36          | `GameScreenRegistry`, `GameShell`, within-scene navigation, Renderer Context Map, design tokens, code splitting                                       |
| [core-components/renderer-shell-pages-ui-contract.md](core-components/renderer-shell-pages-ui-contract.md) | §4.37                | Shell page token contract, `GameMainMenuDefinition`, `GameSettingsPageDefinition`, game override cascade rules, invariants #34–#36, #80, #85, #91–#94 |
| [core-components/game-resolution.md](core-components/game-resolution.md)                                   | §4.38                | `GameResult`, `resolveGameResult`, `gameResult` in `PlayerSnapshot`, `GameShell` winner display                                                       |

---

## Index: Security & Trust (§8–§9)

| File                                                                                                           | Architecture Section | Contents                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [security-trust/fog-of-war-cryptographic-commitment.md](security-trust/fog-of-war-cryptographic-commitment.md) | §8                   | CQRS-Adjacent State Projection, Information Classification, SHA-256 commitment scheme, trust boundary, reconnect handling |
| [security-trust/ipc-security-model.md](security-trust/ipc-security-model.md)                                   | §9                   | Security boundary table, IPC Attack Surface Audit (11 namespaces), 6-step audit procedure                                 |

---

## Index: Testing (§10, §13)

| File                                                                   | Architecture Section | Contents                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [testing/property-tests-soak.md](testing/property-tests-soak.md)       | §10.0–§10.1          | Vitest toolchain, file conventions, `vitest.config.ts`, package.json scripts, unit/property tests, CI pipeline, full §10.1 test scenario matrix |
| [testing/e2e-testing-playwright.md](testing/e2e-testing-playwright.md) | §13                  | Playwright E2E, `CHIMERA_E2E=1`, fixtures, page objects, helpers, all specs, `__e2eHooks` contract, CI YAML                                     |

---

## Appendix A — Technology Versions (Baseline)

| Package           | Version                   |
| ----------------- | ------------------------- |
| Electron          | 34.x                      |
| Next.js           | 15.x (`output: 'export'`) |
| React             | 19.x                      |
| Three.js          | r170+                     |
| React Three Fiber | 9.x                       |
| ws                | 8.x                       |
| TypeScript        | 5.x                       |
| Zustand           | 5.x (game/lobby store)    |
| Vitest            | 3.x                       |
| Playwright        | 1.x                       |

---

## Appendix B — Worked Example: Gameplay ↔ Renderer Connection

This appendix walks through how a single gameplay entity — a `Soldier` with stats — connects from authoritative simulation state all the way to an on-screen sprite that changes with those stats. It ties together §4.2 (simulation), §4.6 (projection), §4.8 (content database), §4.10 (assets), §4.4 (renderer state), and the module tree in §3.

### B.1 The Three "Soldier" Shapes

A gameplay entity exists in three layers, connected only by **IDs and ref strings** — never by direct object references.

| Layer                           | What "Soldier" looks like                                                                              | Where it lives                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Content** (static definition) | `SoldierData` JSON — max HP, damage, sprites, model, sfx. Designer-authored, read-only at runtime.     | `games/tactics/data/units/soldier.json` → loaded into `ContentDatabase` (§4.8) |
| **Simulation** (dynamic state)  | `EntityState` — `{ id, unitDefId: 'soldier', hp: 47, position, ownerId }`. The _current_ numbers only. | `GameSnapshot.entities` on the host (§4.2)                                     |
| **Renderer** (visual)           | `<Unit />` R3F component that reads sprites and models via `useAsset()`                                | `renderer/components/r3f/Unit.tsx` (§4.10)                                     |

The simulation entity stores only `unitDefId: 'soldier'`, not the stats themselves. All _static_ soldier data (portrait, model, sfx, base stats, sprite variants) stays in the content database. This is what lets a designer change a sprite by editing JSON without recompiling anything, and why a 200-soldier snapshot stays small over the wire.

### B.2 The Connection Chain

```
games/tactics/data/units/soldier.json           ← static definition
                │                                  (AssetRef<TextureAsset> strings inside)
                │  loaded once at startup
                ▼
           ContentDatabase                      ← simulation/content/ (§4.8)
                │
                │  db.getByIdOrThrow('units', 'soldier') → SoldierData
                ▼
   ┌───────────────── HOST (Electron main process) ─────────┐
   │  GameSnapshot.entities['soldier-42'] = {                │
   │     unitDefId: 'soldier',  hp: 47,  x: 3, y: 5,  ...    │
   │  }                                                      │
   │                                                         │
   │  StateProjector.project(snapshot, playerId)             │
   │     → VisibilityRules mask fog / owner-only fields      │
   └─────────────────────────┬───────────────────────────────┘
                             │  PlayerSnapshot over IPC / WS
                             ▼
   ┌───────────────── RENDERER ──────────────────────────────┐
   │  gameStore.snapshot  (Zustand — §4.4)                   │
   │                                                         │
   │  <BoardScreen>                                          │
   │    snapshot.entities.map(e => <Unit key={e.id} …/>)     │
   │                                                         │
   │  <Unit entity={e}>                                      │
   │     const def = db.getByIdOrThrow('units', e.unitDefId) │
   │     const sprite = pickSprite(def, e.hp)  ← stat-driven │
   │     const { asset } = useAsset(sprite)    ← §4.10 hook  │
   │     return <mesh>…<spriteMaterial map={asset}/>…        │
   └─────────────────────────────────────────────────────────┘
```

### B.3 Worked Example — "Show a Different Sprite Based on HP"

#### Content JSON (pure data, one file)

```json
// games/tactics/data/units/soldier.json
{
    "id": "soldier",
    "name": "Soldier",
    "stats": { "maxHp": 100, "damage": 25, "armor": 10 },
    "sprites": {
        "healthy": "tactics/sprites/units/soldier-healthy.webp",
        "wounded": "tactics/sprites/units/soldier-wounded.webp",
        "critical": "tactics/sprites/units/soldier-critical.webp"
    },
    "sfx": { "hit": "tactics/audio/sfx/soldier-hit.ogg" }
}
```

The `"tactics/sprites/…"` strings are `AssetRef<TextureAsset>` per §4.10 — typed at compile time, plain strings at rest.

#### Simulation State (dynamic bits only)

```typescript
// Inside GameSnapshot.entities on the host
'soldier-42': {
  id: 'soldier-42',
  unitDefId: 'soldier',   // ← ref into ContentDatabase
  ownerId: 'p1',
  position: { x: 3, y: 5 },
  hp: 47,                 // ← dynamic, changes via reduce()
}
```

No sprite info here. No Three.js import reachable from this file — the simulation layer stays pure.

#### R3F Component (renderer — the only place that sees pixels)

```typescript
// renderer/components/r3f/Unit.tsx
import { useAsset } from '../../assets/useAsset';
import { useContentDb } from '../../content/useContentDb';

function pickSpriteRef(def: SoldierData, hp: number): AssetRef<TextureAsset> {
  const ratio = hp / def.stats.maxHp;
  if (ratio > 0.66) return def.sprites.healthy;
  if (ratio > 0.33) return def.sprites.wounded;
  return def.sprites.critical;
}

export function Unit({ entity }: { entity: ObservedEntityState }) {
  const db        = useContentDb();
  const def       = db.getByIdOrThrow<SoldierData>('units', entity.unitDefId);
  const spriteRef = pickSpriteRef(def, entity.hp);
  const { asset, loading } = useAsset(spriteRef);   // §4.10
  if (loading) return <FallbackSprite position={entity.position}/>;
  return (
    <sprite position={[entity.position.x, 0, entity.position.y]}>
      <spriteMaterial map={asset}/>
    </sprite>
  );
}
```

#### BoardScreen (game-declared, in `games/tactics/screens/`)

```typescript
function BoardScreen() {
  const snapshot = useGameStore(s => s.snapshot);   // §4.4 PlayerSnapshot
  if (!snapshot) return null;
  return (
    <GameCanvas>
      {Object.values(snapshot.entities).map(e =>
        <Unit key={e.id} entity={e}/>
      )}
    </GameCanvas>
  );
}
```

### B.4 What Makes a Change "Happen" Visually

A damage action flows like this:

1. Player dispatches `tactics:attack` via `window.__chimera.game.dispatch(...)` (§4.1).
2. Host `ActionPipeline.process()` runs the 7-step pipeline (§4.7): validate → reduce → history → project → broadcast.
3. `reduce()` returns a new `GameSnapshot` where `entities['soldier-42'].hp = 22`.
4. `StateProjector` produces a `PlayerSnapshot` per player (fog of war applied — a soldier in fog never reaches the renderer at all).
5. IPC pushes the `PlayerSnapshot` into `gameStore.applySnapshot(...)` (§4.4).
6. React re-renders `<Unit>`; `pickSpriteRef` now returns `def.sprites.critical`; `useAsset` returns the critical texture from the `AssetManager` cache (§4.10). If it was preloaded as `'critical'` priority, no flicker.

### B.5 Why the Indirection Is Worth It

- **Simulation has zero Three.js / DOM dependency** — same code runs headless in tests, in the AI layer (§4.9), and in save/load replay (§4.11).
- **Designers change sprites by editing JSON.** No TypeScript rebuild. `tools/validate-assets.ts` (§4.10) catches typos at CI time.
- **Fog of war is automatic.** The renderer literally cannot render a soldier it never received in its `PlayerSnapshot` — `VisibilityRules` decided upstream (§4.6).
- **Bit-identical determinism.** Stats live in integer fields per §4.2.1 Rule 3; the sprite bucket is derived deterministically from `(hp, maxHp)`, so every client shows the same sprite for the same state.
- **Stat-driven visuals are a pure renderer concern.** Adding a `"legendary"` sprite variant for `hp > 150%` is a `pickSpriteRef` change and one JSON edit — no engine, no network, no save-migration changes.

### B.6 Common Pitfalls (and Where They Really Belong)

| Temptation                                                     | Why it's wrong here                                                                                                               | Correct place                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Store `currentSprite: THREE.Texture` on the entity             | Couples simulation to Three.js; breaks determinism, replay, save. Violates invariant "simulation has zero renderer dependencies." | Derive in `<Unit>` from stats + content def via `pickSpriteRef`.                                                     |
| Put `maxHp: 100` on every entity                               | Duplicates static data in every snapshot; bloats saves and network frames.                                                        | Put on `SoldierData` in content; entity stores only `unitDefId` + `hp`.                                              |
| Have the renderer directly mutate `entity.hp`                  | Breaks host-authoritative rule (§1, §6); causes desync.                                                                           | Dispatch an action; wait for the authoritative snapshot.                                                             |
| Use `Math.random()` to roll a critical hit inside `reduce()`   | Violates invariant #43 — non-deterministic; soak test (§10) catches it within minutes.                                            | Use `ctx.rng.intBetween(1, 100)` — seeded from `(state.seed, state.tick)`.                                           |
| Use `Date.now()` as a cooldown timer in state                  | Violates invariants #42 and #43; breaks replay and save-file portability across timezones/clocks.                                 | Store `cooldownUntilTick: number` and compare to `state.tick`.                                                       |
| Store `hp: 47.5` (fractional HP)                               | Violates invariant #44 — floats are not bit-exact across CPUs; causes cross-platform desync.                                      | Scale up: use integer HP `475` with "tenths of HP" semantics, or fixed-point.                                        |
| Load `soldier-critical.webp` on first damage tick              | First-hit stutter; 200ms frame spike.                                                                                             | Declare it `'critical'` priority in `asset-manifest.ts` → preloaded before match (§4.10).                            |
| Reach directly from `<Unit>` into the host's `GameSnapshot`    | There is no such access path; attempting it via Electron remote is a security violation (§9).                                     | Read `PlayerSnapshot` from `gameStore` (§4.4). If a field is missing, it was masked by `VisibilityRules` on purpose. |
| Put HUD logic (turn timer, undo button) into `<Unit>`          | Conflates entity rendering with shell chrome.                                                                                     | HUD lives in engine `shell/` or game `screens/`; the `<Unit>` component only draws a unit.                           |
| Add a new action type by editing `StateReducer` in engine core | Breaks the Action Registry pattern (§4.7); engine must stay game-agnostic.                                                        | Add an `ActionDefinition` in `games/tactics/actions/` and register it.                                               |
| Read a game setting inside `reduce()` to change outcome        | Violates invariant #36 — settings are UI-only; they are not replayed or synchronised.                                             | Put it in match config (lobby setup) so all clients agree.                                                           |
| Call `useAsset()` with a ref that isn't in `asset-manifest.ts` | Works in dev but `validate-assets.ts` will flag it, and it won't be packaged into `resources/` in production.                     | Register every `AssetRef` in the manifest with `'critical'` or `'deferred'` priority.                                |
| Send the full `GameSnapshot` to the renderer "for convenience" | Leaks hidden information (opponent hand, fog-covered entities); trivially cheatable via devtools.                                 | Always route through `StateProjector` → `PlayerSnapshot`, even for the host's own renderer.                          |

### B.7 The One-Sentence Version

**Content defines what a Soldier _is_; simulation tracks what a Soldier _is currently doing_; renderer decides what a Soldier _looks like right now_ — and `AssetRef` strings + `unitDefId` strings are the only glue between them.**

---

## Appendix C. Roadmap: From Monorepo to Package Hierarchy

### C.1 Scope of This Document

Everything specified in this architecture overview — §1 through §18 and Appendices A–C — constitutes the **Chimera Core Engine v1.0.0 target**. The monorepo layout described in §3 is the development vehicle for reaching that target. It is deliberately chosen for velocity: all packages share a single `tsc` build, a single test run, and a single git history, making cross-cutting interface changes cheap while the design is still evolving.

### C.2 The Trigger: v1.0.0 Stability

The monorepo remains the right structure **until the core engine interfaces are proven stable** by at least one shipped game. Stability means:

- `ActionRegistry` / `ActionPipeline` / `BaseGameSnapshot` have not had breaking changes across two full game development cycles.
- The `MultiplayerProvider` / `HostTransport` / `ClientTransport` contracts are exercised by at least two transport implementations (`LocalWebSocketProvider` + one other).
- The save/migration chain has survived at least one `schemaVersion` increment in production.
- No `engine:*` reserved action type has been renamed or removed post-release.

Once that bar is met, the project transitions to a **published package hierarchy**.

### C.3 Target Package Layout

```
@chimera/simulation     ←  simulation/ + shared/          (pure TS, zero runtime deps)
@chimera/ai             ←  ai/                             (depends on @chimera/simulation)
@chimera/networking     ←  networking/                     (depends on @chimera/simulation)
@chimera/renderer       ←  renderer/                       (depends on @chimera/simulation, React, Three.js)
@chimera/electron       ←  electron/                       (depends on all above)

# First-party extension library — example of the adopter pattern:
@chimera/cards          ←  new package                     (depends on @chimera/simulation, @chimera/ai)

# Games become independent repositories / packages:
my-poker-game           ←  games/poker/                    (depends on @chimera/simulation, @chimera/cards, @chimera/renderer)
my-ccg                  ←  games/my-ccg/                   (depends on @chimera/simulation, @chimera/cards, @chimera/renderer)
```

The dependency arrows already point this way in the monorepo — no refactoring of logic is required. The transition is a **packaging and publishing change**, not an architectural one.

### C.4 What the Transition Requires

| Task                                                                                        | Effort  | Notes                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Add `mergeFrom(definitions)` to `ActionRegistry`                                            | Small   | Enables extension libraries to pre-register shared action definitions without forcing adopters to re-register each one manually |
| Extract `SimulationHost` from `electron/main/simulation-host.ts` into `@chimera/simulation` | Medium  | Makes the host composable outside Electron; `@chimera/electron` becomes a thin wrapper                                          |
| Replace `tsconfig` path aliases with real workspace `package.json` deps                     | Small   | One-line change per package in a pnpm/yarn workspace                                                                            |
| Add import-boundary lint rules                                                              | Small   | `eslint-plugin-import` `no-restricted-imports` — enforces what the architecture already requires                                |
| Curate each package's `index.ts` barrel                                                     | Small   | Expose contract types only; hide implementation details                                                                         |
| Per-package incremental build                                                               | Medium  | `tsc --build` project references, or `turborepo`/`nx` for caching                                                               |
| Semantic versioning and changelogs                                                          | Ongoing | Each package gets independent semver; `@chimera/simulation` breaking changes are major bumps                                    |

### C.5 Intermediate Step: pnpm Workspaces

Before publishing, the monorepo should introduce **pnpm workspaces** (or yarn workspaces) as an intermediate step. This gives:

- Separate `package.json` per logical package with explicit `dependencies`
- Enforced dependency graph (a package cannot import from a sibling it doesn't declare)
- Incremental builds with caching
- Independent changelogs

...all without the overhead of publishing to npm or managing semver compatibility promises while interfaces are still hardening.

### C.6 Adopter Model

Once `@chimera/simulation` is published and stable, the intended adoption path for external developers is:

```
@chimera/simulation          ← always required; the core contract
@chimera/ai                  ← required if the game has AI players
@chimera/networking          ← required if the game has multiplayer
@chimera/renderer            ← required if using the React/R3F renderer shell
@chimera/electron            ← required if shipping as an Electron desktop app
@chimera/<domain>            ← optional extension libraries (e.g. @chimera/cards, @chimera/hex-grid)
```

An adopter building a card game toolkit publishes `@chimera/cards` with `peerDependencies` on `@chimera/simulation`. Their game packages depend on both. The engine team has no coupling to or knowledge of the game packages — the dependency arrows point inward toward the core, never outward.

---

## Appendix D. Future Extensions Roadmap (Post-1.0.0)

These capabilities are deliberately out of scope for the 1.0.0 release but are architecturally anticipated. They are listed in **priority order** — E.1 is the first candidate for a 1.1.0 release, E.5 the most speculative.

Each entry notes the existing anchor point in the 1.0.0 architecture and the broad strokes of what a follow-up release would add. Nothing here is a commitment; this list exists to prevent accidental design decisions in 1.0.0 that would foreclose these options.

### D.1 Auto-Update and Distribution Hardening

**Anchor:** Invariant 27 (production-mode guard) and `electron/main/index.ts`.

**Gap:** 1.0.0 packages the Electron app but does not include auto-update, code signing metadata, macOS notarization, or update channels. Players must manually download new versions.

**Planned approach:**

- Integrate `electron-updater` with GitHub Releases or an equivalent static host.
- Establish **stable** and **beta** channels via `electron-builder` config. Host + all clients in a lobby must run the same channel + major version; the lobby join handshake extends `WELCOME` with an `engineVersion` check.
- Add macOS notarization and Windows EV code-signing to the CI release pipeline.
- User-facing UI: an update indicator in the main menu + "Restart to install" prompt.

### D.2 Accessibility Baseline

**Anchor:** `EngineSettings.display` (§4.13); fade/tween renderer modules (§4.19, §4.21).

**Gap:** 1.0.0 has no accessibility settings.

**Planned approach:**

- Add `settings.display.reducedMotion: boolean` — when `true`, `useFadeTransition` and `useTween` resolve instantly, and `<ToastHost>` disables slide animations.
- Add `settings.display.highContrast: boolean` — game stylesheets expose a contrast-friendly theme variant.
- Add `settings.display.fontScale: number` — `1.0 = default`, `[0.75, 2.0]` range; applied via a CSS custom property at the root.
- Add keyboard-navigation affordances: focus rings, skip-to-content, ARIA labels on all shell components.
- Screen-reader compatibility is a larger project deferred beyond E.2.

### D.3 Spectator Mode

**Anchor:** `StateProjector` (§4.6), `VisibilityRules`.

**Gap:** The projection infrastructure can already produce a public-only `PlayerSnapshot`, but there is no formal "spectator" player type, no spectator join flow, and no allowlist enforcement for spectator-originated actions.

**Planned approach:**

- Extend `LobbyPlayerEntry` with a `role: 'player' | 'spectator'`.
- `StateProjector` gains a `projectForSpectator()` method that returns a `PlayerSnapshot` with no owner-only fields.
- `ActionValidator` rejects all non-`engine:chat` actions from spectators.
- `LobbyManager.joinLobby()` accepts a `role` parameter; host policy decides whether spectators are allowed per match.
- Spectators are visible in `PlayerDirectory` but excluded from turn rotation.

### D.4 Localisation / i18n

**Anchor:** `PlayerProfile.locale` (§4.24, currently carried but unused).

**Gap:** All engine-provided UI strings are hard-coded English.

**Planned approach:**

- Introduce a minimal translation surface: `translations/<locale>.json` bundles shipped in the engine package and per-game packages.
- Adopt `react-i18next` (or equivalent) in the renderer only — the simulation remains language-agnostic because it emits identifiers, not user-facing strings.
- Profile locale becomes the default; the player may override via `settings.display.locale`.
- RTL support (Arabic, Hebrew) is tracked separately from E.4 and may slip further.

### D.5 Connection Quality Telemetry

**Anchor:** `PING`/`PONG` wire frames (§4.3); `ConnectionStatus` IPC event (§4.1).

**Gap:** The ping round-trip is measured but not surfaced as a rolling quality metric (RTT, jitter, packet loss estimate). Players cannot see "weak connection" warnings.

**Planned approach:**

- Extend `PerfProbe` (or add a sibling `NetworkProbe`) that maintains an EWMA of RTT and its variance; estimates packet loss from sequence-number gaps in `SNAPSHOT` messages.
- A `connectionHealthStore` in the renderer exposes `rttMs`, `jitterMs`, `lossEstimate` to the UI.
- A small lobby indicator (green / yellow / red dot next to each player's avatar in `ChatPanel` / `PlayerListPanel`) surfaces the health state.
- Telemetry is **local only** (invariant 69) — these metrics are shown to the player, not exported or reported to any server.

---

### Sequencing Note

D.1 (auto-update) is the most operationally urgent because it gates every subsequent patch release. D.2 (accessibility) is the lowest-effort meaningful improvement and pairs well with D.1 in a 1.1.0. D.3 (spectator), D.4 (i18n), and D.5 (connection telemetry) are larger, more independent efforts that can be sequenced based on player feedback after 1.0.0 ships.
