<p align="center">
  <img src="docs/assets/chimera-logo-compact.png" alt="Chimera" width="120" />
</p>

# Chimera

Host-authoritative, multiplatform multiplayer game engine built on Electron, Next.js, React, and Three.js / React Three Fiber.

Architecture reference: [`docs/architecture-overview.md`](docs/architecture-overview.md).

## Status

Early scaffolding. The architecture document is the authoritative baseline; the first implementation milestone (M1 — Skeleton) is in progress.

## Getting started

Prerequisites:

- Node.js **≥ 20** (tested on 25.x)
- [pnpm](https://pnpm.io) **≥ 10**

Install dependencies and run the test suite:

```sh
pnpm install
pnpm test            # vitest run
pnpm typecheck       # tsc --noEmit (root + renderer)
pnpm build:renderer  # next build renderer → renderer/out/index.html
```

Project layout (landed so far):

```
electron/
├── main/
│   ├── index.ts        # App entry: BrowserWindow creation + lifecycle (§3)
│   ├── ipc-handlers.ts # chimera:system|game|lobby|saves|settings:* IPC handlers
│   └── index.test.ts   # Unit tests (vitest)
└── preload/
    ├── api.ts          # contextBridge.exposeInMainWorld('__chimera', …)
    ├── {system,game,lobby,saves,settings}-api.ts
    └── *.test.ts
renderer/
├── app/
│   ├── layout.tsx      # Next.js App Router root layout
│   ├── page.tsx        # Main-menu shell; M1 boot-smoke of preload bridge
│   └── bootSmoke.ts    # Pure helper: logs window.__chimera.system.platform()
├── next.config.ts      # Static export (renderer/out)
└── tsconfig.json       # Extends root; jsx: preserve + DOM lib
```

## Features

**Core simulation**

- Pure, deterministic reducers with seeded RNG and integer / Q32.32 fixed-point math — bit-identical across macOS / Windows / Linux.
- Tick-based simulation for both turn-based and real-time games.
- Extensible `ActionRegistry` — games register their own actions without modifying engine code.
- Content system (`ContentDatabase`) loading game data from pure JSON; CI-validated `AssetRef` typing.
- Deterministic tick-based game timers (DoT, durations, countdowns) that save / load / replay.

**Multiplayer**

- Host-authoritative architecture; local Node.js WebSocket server in Electron main.
- Pluggable `MultiplayerProvider` (LAN default; Steam / others plug in unchanged).
- Per-player state projection (`StateProjector` + `VisibilityRules`) with fog-of-war by construction.
- Commitment scheme for hidden-info anti-cheat (shuffles, dice, hidden cards).
- CRC32-checksummed actions; sanitised profile / chat side-channels parallel to the action pipeline.
- Client-side prediction with server reconciliation; reconnect + resync flow.

**Identity & lobby**

- Client-attested player profiles (avatar, display name, locale) with host-side sanitiser.
- `PlayerDirectory` aggregates all lobby participants; local seat-switcher for pass-and-play.
- Lobby browse/discovery capability (optional, provider-specific).

**Input & UI**

- Renderer built on Next.js (static export) + React 19 + Three.js / React Three Fiber.
- Named `InputAction`s with rebindable keyboard + gamepad bindings stored under user settings.
- R3F-native pointer/click interactions, hover state, and interaction-blocker for transitions.
- Camera system: perspective/orthographic, presets (isometric, top-down, side-scroll, free), smooth `animateTo` with cancellation contract.
- Scene router with two-phase transitions + full-screen fade overlay.
- Curves + `useTween` hook for pure-renderer animations.
- Toast notifications, chat panel, performance HUD (F3), settings UI.

**Assets & audio**

- `AssetManager` with lifecycle-owned Three.js asset cache; `useAsset` hook.
- Audio system: master/music/sfx/voice buses, ducking, spatial audio, `EventAudioBinding` map from game events to sounds.

**Persistence**

- Save / load with atomic writes, migrations, and commitment-state restoration.
- Settings: layered merge (engine defaults ← game defaults ← user overrides), Zod-validated, atomic writes.
- Replay export/import — re-uses live `ActionPipeline` for bit-identical playback.
- Per-user profiles on disk; pass-and-play multi-slot support.

**AI**

- Pluggable AI brains submitting `EngineAction`s through the same pipeline as humans.
- Default "honest" AI receives `PlayerSnapshot`; omniscient mode is opt-in and logged.
- `CommandScheduler` with bounded per-tick transitions.

**Undo / redo**

- Hybrid memento + event-sourcing undo with configurable policy (intra-turn, cross-turn, consent-based).
- `engine:undo` / `engine:redo` travel the standard action pipeline — no side doors.

**Security & robustness**

- `contextIsolation: true`, `nodeIntegration: false`; typed, enumerated preload API surface.
- Dedicated IPC attack-surface audit (`window.__chimera` namespace table).
- React `RootErrorBoundary` with crash fallback; crash reporter with autosave-before-dump.
- Structured Pino logging (main + renderer), log rotation, local-only by default, user-initiated diagnostics export.

**Developer tooling**

- In-engine debug Inspector Window (dev builds only): snapshot browser, time-travel, injected actions, multi-window devtools.
- Dev multiplayer harness: `pnpm dev:mp N` spawns a host + N-1 auto-joining clients with isolated user-data dirs and distinct seed profiles.
- Vitest + fast-check + React Testing Library unit/integration tests; Playwright E2E.
- Custom ESLint rules (`chimera/no-fromfloat-in-simulation`, `no-context-null-bang`).
- Debug mode (`CHIMERA_DEBUG=1`) guarded against production builds.
  s
