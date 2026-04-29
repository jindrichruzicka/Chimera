---
title: 'Chimera Coding Standards — §2 SOLID Principles'
description: 'SOLID software design principles applied to the Chimera engine: SRP, OCP, LSP, ISP, DIP.'
tags: [solid, srp, ocp, lsp, isp, dip, design-principles, coding-standards]
---

# §2 SOLID Principles

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## SRP — Single Responsibility

Every module, class, and function has exactly one reason to change.

- Orchestrators (e.g. `SimulationHost`, `LobbyManager`) **wire collaborators**; they contain no domain logic.
- Domain logic lives in focused collaborators injected at the wiring point.
- A function longer than ~40 lines is a smell — split at conceptual boundaries, not arbitrary line counts.

## OCP — Open / Closed

Engine core is **closed to modification**. All new behaviour is added by extension:

- New game actions → register an `ActionDefinition`. Never edit `ActionPipeline.ts`.
- New save formats → implement `SaveSerializer`. Never edit `SaveManager.ts`.
- New multiplayer backends → implement `MultiplayerProvider`. Never edit `LobbyManager.ts`.

## LSP — Liskov Substitution

Every implementation of an interface must honour the **full documented contract**:

- Return types must match exactly — no widened or narrowed shapes.
- Error types thrown must match those documented for the interface.
- Lifecycle invariants must be upheld (e.g. `onEnter` fires before any `onTick`; `setInitialState` triggers `onEnter`).
- Substituting one implementation for another must be **invisible** to callers.

## ISP — Interface Segregation

Pass the narrowest interface a collaborator needs:

- Never pass a 7-field aggregate when 2 fields suffice.
- Prefer role interfaces: `ReduceContext`, `HistoryContext`, `BroadcastContext` over a single fat `PipelineContext` passed everywhere.
- IPC handlers accept only the fields they actually read, not the entire `ipcMain.event` object.

## DIP — Dependency Inversion

High-level modules depend on abstractions; concrete classes are wired at one site only:

- `electron/main/index.ts` is the **sole wiring point** for all injected dependencies.
- `simulation/` and `ai/` never reference any concrete repository, provider, or platform class.
- Any new high-level module that references a `new ConcreteClass()` inside itself is a violation.
