---
title: 'System Overview and Context'
description: 'Executive architecture decision, process boundary table, and the full system context diagram showing Host Machine / Client topology for the Chimera engine.'
tags: [architecture, executive, process-boundaries, context-diagram, host-authoritative]
---

# System Overview and Context

> Related: [Module Boundaries](module-boundaries-file-tree.md) · [Architecture Invariants](architecture-invariants.md) · [IPC Bridge](../core-components/electron-shell-ipc-bridge.md)

---

## 1. Executive Architecture Decision

Chimera is a **host-authoritative, multiplatform multiplayer game engine** delivered as a desktop application. The architecture is divided into three hard process boundaries:

| Process               | Technology                      | Responsibility                                           |
| --------------------- | ------------------------------- | -------------------------------------------------------- |
| **Electron Main**     | Node.js                         | App lifecycle, IPC broker, local WebSocket server host   |
| **Electron Renderer** | Next.js + React (static export) | UI, HUD, menus, lobby, game state consumption            |
| **Game Simulation**   | Pure TypeScript module          | Deterministic tick loop, rule evaluation, state mutation |

The renderer **never owns authoritative game state**. The simulation runs on the host inside the main process (or a spawned worker), and all clients — including the host's own renderer — receive **projected views** of state via IPC/WebSocket. This makes the architecture equally valid for local singleplayer, LAN play, and NAT-traversed online lobbies without any server infrastructure changes.

The simulation core is designed around three foundational patterns that every game built on Chimera inherits:

1. **Pure Reducer** — all state transitions are `(GameSnapshot, Action) → GameSnapshot`, enabling undo/redo and deterministic replay by design.
2. **Hybrid Memento + Event Sourcing** — undo/redo within a player's turn is O(n-in-turn); full replay from any point is available via the action event log.
3. **State Projection (CQRS-adjacent)** — the host never sends the raw `GameSnapshot` to any client; each client receives a `PlayerSnapshot` filtered by visibility rules, including cryptographic commitments for hidden values.

---

## 2. System Context Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Host Machine                                                            │
│                                                                          │
│  ┌─────────────────────────┐     IPC (contextBridge)                     │
│  │  Electron Main Process  │◄───────────────────────────────┐            │
│  │                         │                                │            │
│  │  ┌───────────────────┐  │     WebSocket (ws/socket.io)   │            │
│  │  │  Game Simulation  │  │◄──────────────┐                │            │
│  │  │  (deterministic)  │  │               │                │            │
│  │  └───────────────────┘  │               │                │            │
│  │  ┌───────────────────┐  │               │    ┌───────────┴────────┐   │
│  │  │  State Projector  │  │               │    │  Renderer Process  │   │
│  │  │  (obfuscation)    │  │               │    │  Next.js + React   │   │
│  │  └────────┬──────────┘  │               │    │  Three.js / R3F    │   │
│  │  ┌────────┴──────────┐  │               │    │  (PlayerSnapshot   │   │
│  │  │  WebSocket Server │  │               │    │   only — never     │   │
│  │  │  (ws / socket.io) │◄─┼──────────────-┤    │   full GameSnap)   │   │
│  │  └───────────────────┘  │               │    └────────────────────┘   │
│  └─────────────────────────┘               │                             │
│  NOTE: GameSnapshot never leaves Main Process boundary                   │
└────────────────────────────────────────────┼─────────────────────────────┘
                                             │
                        ┌────────────────────┼───────────────────┐
                        │                    │                   │
              ┌─────────┴───────┐  ┌─────────┴───────┐  ┌────────┴────────┐
              │  Client A       │  │  Client B       │  │  Client N       │
              │  Electron App   │  │  Electron App   │  │  Electron App   │
              │  (Renderer +    │  │  (Renderer +    │  │  (Renderer +    │
              │   IPC bridge)   │  │   IPC bridge)   │  │   IPC bridge)   │
              └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Key Invariants

- **Invariant #1** — `simulation/` has zero runtime dependencies on React, DOM, or networking.
- **Invariant #2** — `applyAction`/`definition.reduce` are pure functions — same input, same output, always.
- **Invariant #3** — `GameSnapshot` never leaves the host's main process. `PlayerSnapshot` is the only state type that crosses any process or network boundary.
- **Invariant #4** — The renderer reads state; it never writes state directly.

---

## Cross-References

- [Module Boundaries and File Tree](module-boundaries-file-tree.md) — detailed annotated source tree (§3)
- [IPC Bridge](../core-components/electron-shell-ipc-bridge.md) — preload API surface, `window.__chimera` (§4.1)
- [Simulation Core and Action Pipeline](../core-components/simulation-core-action-pipeline.md) — pure reducer details (§4.2)
- [State Projection Interfaces](../core-components/state-projection-interfaces.md) — CQRS-adjacent projection (§4.6)
- [IPC Security Model](../security-trust/ipc-security-model.md) — security and trust boundaries (§9)
