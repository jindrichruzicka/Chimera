---
title: 'Chimera Engine — Product Roadmap (Index Hub)'
description: 'Index hub linking all milestone roadmap sections and the architecture traceability matrix. Based on architecture-overview.md v1.0.0. Every milestone, feature, and version maps directly to architecture sections.'
tags: [roadmap, index, milestones, features, traceability]
---

# Chimera Engine — Product Roadmap (Index Hub)

> This file is an **index hub**. All content has been modularised into `docs/roadmap-sections/`.
> Based on `docs/architecture-overview.md` (v1.0.0, 2026-04-24).
> Every milestone, feature, and version maps directly to architecture sections.

---

## Version Overview

| Version      | Milestone                                    | Focus                                                                                                                                   | Detail                                                                                                                   |
| ------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **0.1.0**    | M1 — Skeleton                                | Electron shell, IPC bridge, simulation stub, persistence foundations                                                                    | [roadmap-sections/m1-skeleton-v0.1.0.md](roadmap-sections/m1-skeleton-v0.1.0.md)                                         |
| **0.2.0**    | M2 — Networked Lobby                         | Multiplayer provider abstraction, WebSocket lobby, player sync                                                                          | [roadmap-sections/m2-networked-lobby-v0.2.0.md](roadmap-sections/m2-networked-lobby-v0.2.0.md)                           |
| **0.3.0**    | M3 — Action Registry + Game Loop + Undo/Redo | Full action pipeline, undo/redo, save/load, settings                                                                                    | [roadmap-sections/m3-action-registry-game-loop-v0.3.0.md](roadmap-sections/m3-action-registry-game-loop-v0.3.0.md)       |
| **0.4.0**    | M4 — AI Framework                            | AI agent system, state machine, command scheduler                                                                                       | [roadmap-sections/m4-ai-framework-v0.4.0.md](roadmap-sections/m4-ai-framework-v0.4.0.md)                                 |
| **0.5.0**    | M5 — State Projection + Obfuscation          | Per-player snapshots, fog of war, cryptographic commitment                                                                              | [roadmap-sections/m5-state-projection-obfuscation-v0.5.0.md](roadmap-sections/m5-state-projection-obfuscation-v0.5.0.md) |
| **0.6.0**    | M6 — End-to-End Testing Layer                | Playwright E2E suite, all mandatory specs green in CI                                                                                   | [roadmap-sections/m6-e2e-testing-v0.6.0.md](roadmap-sections/m6-e2e-testing-v0.6.0.md)                                   |
| **0.7.0**    | M7 — 3D Render Integration                   | R3F canvas, asset pipeline, scene transitions                                                                                           | [roadmap-sections/m7-3d-render-integration-v0.7.0.md](roadmap-sections/m7-3d-render-integration-v0.7.0.md)               |
| **0.8.0**    | M8 — Hardening                               | Soak tests, Debug Inspector, performance baseline, anti-tamper, game-customizable shell pages and lobby, tactics-stub hardening         | [roadmap-sections/m8-hardening-v0.8.0.md](roadmap-sections/m8-hardening-v0.8.0.md)                                       |
| **0.9.0**    | M9 — Package Extraction & Game Scaffolding   | Monorepo → `@chimera/*` packages, tactics as standalone consumer app, build/link/update pipeline, `create-chimera-game` CLI, publishing | [roadmap-sections/m9-package-extraction-v0.9.0.md](roadmap-sections/m9-package-extraction-v0.9.0.md)                     |
| **post-1.0** | Future Extensions                            | Auto-update, accessibility, spectator, i18n, telemetry                                                                                  | [roadmap-sections/future-extensions-post-1.0.md](roadmap-sections/future-extensions-post-1.0.md)                         |

---

## Milestone Detail Pages

### [M1 — Skeleton (v0.1.0)](roadmap-sections/m1-skeleton-v0.1.0.md)

F01–F08. Working Electron application that boots, bridges the renderer, runs a simulation stub, and can persist state. Covers: Electron shell, Preload/IPC Bridge, Simulation Engine Stub, Deterministic RNG, Content Database, Save/Load Persistence, Settings System, Dev Tooling.

### [M2 — Networked Lobby (v0.2.0)](roadmap-sections/m2-networked-lobby-v0.2.0.md)

F09–F14. Two independent Electron instances discover each other, connect, and synchronise lobby state. Covers: MultiplayerProvider abstraction, LocalWebSocketProvider, LobbyManager IPC, Lobby UI/State Sync, WebSocket Message Protocol, Player Profiles & Directory.

### [M3 — Action Registry, Game Loop & Undo/Redo (v0.3.0)](roadmap-sections/m3-action-registry-game-loop-v0.3.0.md)

F15–F21. Full action pipeline live, undo/redo end-to-end, game state persists and migrates. Covers: Full ActionPipeline, UndoManager/TurnMemento, Client Prediction, SaveManager IPC/UI, Settings UI, Fixed-Point Math, Game Timers.

### [M4 — AI Framework (v0.4.0)](roadmap-sections/m4-ai-framework-v0.4.0.md)

F22–F25. AI plays a full headless match; honest-AI fog-of-war projection verified by tests. Covers: PlayerAgent/AgentManager, AIBrain/State Machine, CommandScheduler/Commands, Honest vs Omniscient AI Policy.

### [M5 — State Projection & Obfuscation (v0.5.0)](roadmap-sections/m5-state-projection-obfuscation-v0.5.0.md)

F26–F29. Every client receives only its authoritative `PlayerSnapshot`; fog of war and commitment scheme verified. Covers: StateProjector/VisibilityRules, Cryptographic Commitment Scheme (SHA-256), Host Renderer Obfuscation, Projection Property Tests.

### [M6 — End-to-End Testing Layer (v0.6.0)](roadmap-sections/m6-e2e-testing-v0.6.0.md)

F30–F34. Full Playwright suite green in CI. Covers: Playwright Infrastructure, Page Object Model, IPC/WebSocket Helpers, Core E2E Specs, Save/Settings E2E Specs.

### [M7 — 3D Render Integration (v0.7.0)](roadmap-sections/m7-3d-render-integration-v0.7.0.md)

F35–F42, F50. R3F canvas renders game entities; asset pipeline production-ready; scene transitions end-to-end. Covers: R3F GameCanvas/Camera, Asset Manager, Curves/Tweening/Interaction, UI Design System, Scene Transitions/GameShell, Audio System, Input/Keybindings, Performance HUD, Device Info.

### [M8 — Hardening (v0.8.0)](roadmap-sections/m8-hardening-v0.8.0.md)

F43–F49, F51–F54. Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, shell pages and the lobby are game-customizable, and the tactics stub is hardened (turn-gating, stamina, AI players, commitment-scheme battle mode). Covers: Crash Reporter/Error Boundaries, Replay System, Chat System, Toast Notifications, Debug Inspector, Soak Tests, Performance Baseline, Game-Customizable Main Menu/Settings/Lobby, Tactics-Stub Hardening.

### [M9 — Package Extraction & Game Scaffolding (v0.9.0)](roadmap-sections/m9-package-extraction-v0.9.0.md)

F57–F66. Move Chimera from a single-package monorepo to an isolated, publishable package hierarchy, with tactics as the standalone reference consumer. Covers: pnpm Workspace Foundation, Extract @chimera/simulation, @chimera/ai, @chimera/networking, @chimera/renderer, @chimera/electron, Tactics Standalone Consumer App + E2E Migration, Build/Link/Update Pipeline, create-chimera-game CLI + Blank Template, Engine Package Publishing.

### [Post-1.0 Future Extensions](roadmap-sections/future-extensions-post-1.0.md)

E1–E5. Not committed to any release date. Covers: Auto-Update, Accessibility, Spectator Mode, i18n, Connection Quality Telemetry.

---

## Architecture Traceability

Full cross-reference of every architecture section to implementing features: [roadmap-sections/architecture-traceability-matrix.md](roadmap-sections/architecture-traceability-matrix.md)

Every feature maps to at least one architecture section. No feature exists without a `§` reference. If a feature lacks a `§` reference, it must not be planned.
