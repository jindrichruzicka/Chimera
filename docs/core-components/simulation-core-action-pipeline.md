---
title: 'Simulation Core and Action Pipeline'
description: 'GameSnapshot, PlayerSnapshot, EngineAction, ActionRegistry, the 7-stage ActionPipeline, UndoManager, determinism rules, DeterministicRng, and integer-only state invariants.'
tags: [simulation, action-pipeline, determinism, undo-redo, rng, engine-core]
---

# Simulation Core and Action Pipeline

> §4.2, §4.2.1, and §4.7 of the Chimera architecture.
> Related: [Electron Shell](electron-shell-ipc-bridge.md) · [Undo/Redo Policy](undo-redo-policy.md) · [State Projection](state-projection-interfaces.md) · [Content Database](content-database-data-refs.md) · [AI Framework](ai-framework-agent-system.md)

**Note:** Content from `architecture-overview.md` §4.2.1 (Determinism Foundations) has been consolidated here. Related invariants (especially idempotency and pruneTo semantics) are in [architecture-invariants.md](./architecture-invariants.md#invariant-45).

---

## State Types

```typescript
// ─────────────────────────────────────────────
// AUTHORITATIVE STATE — lives ONLY on the host
// ─────────────────────────────────────────────

// Full truth — never transmitted to any client, including the host's own renderer.
interface GameSnapshot {
    tick: number; // Monotonic; +1 per applied action. NOT a real-time clock.
    seed: number; // Base RNG seed; per-action RNG derived from (seed, tick)
    players: Record<PlayerId, BasePlayerState>;
    entities: Record<EntityId, BaseEntityState>;
    phase: GamePhase;
    events: GameEvent[]; // All events this tick (unfiltered)
    turnClock?: { activePlayerId: PlayerId; deadlineMs: number };
}

// Alias for the engine/game contract; identical to GameSnapshot.
// Use BaseGameSnapshot when emphasising "minimum shape a game must satisfy".
type BaseGameSnapshot = GameSnapshot;

// ─────────────────────────────────────────────
// PROJECTED STATE — the only type that crosses any boundary
// ─────────────────────────────────────────────

type VisibilityScope =
    | 'public' // All players see the true value
    | 'owner-only' // Only the owning player sees this; others receive null/count
    | 'hidden' // No player sees this (server-only: seeds, internal counters)
    | 'committed'; // Concealed until a reveal event; hash committed to all players upfront

// What a specific player receives over IPC / WebSocket
interface PlayerSnapshot {
    tick: number;
    viewerId: PlayerId;
    players: Record<PlayerId, ObservedPlayerState>; // Opponent hands/decks masked
    entities: Record<EntityId, ObservedEntityState>; // Fog-of-war entities absent entirely
    phase: GamePhase;
    events: GameEvent[]; // Filtered to this viewer
    commitments: Record<CommitmentId, CommitmentEnvelope>; // Hashes for concealed values
    undoMeta: { canUndo: boolean; canRedo: boolean };
    isMyTurn: boolean; // Derived: true if turnClock is undefined or activePlayerId === viewerId
}
```

---

## Actions

```typescript
// Generic wire envelope — the only shape the engine transport layer cares about
interface EngineAction<
    TType extends string = string,
    TPayload extends object = Record<string, unknown>,
> {
    readonly type: TType; // namespaced: 'engine:end_turn', '<game>:move_entity'
    readonly playerId: PlayerId;
    readonly tick: number;
    readonly payload: Readonly<TPayload>;
}

// Convenience helper for game developers
type TypedAction<T extends string, P extends object> = EngineAction<T, P>;

// Reserved engine action types — always prefixed 'engine:'; never overridable by games
type EngineReservedType =
    | 'engine:undo'
    | 'engine:redo'
    | 'engine:end_turn'
    | 'engine:sync_request'
    | 'engine:save'
    | 'engine:load';
```

---

## ActionDefinition — the Game Plugin Contract

```typescript
// Strategy per action type; games supply these objects to ActionRegistry
interface ActionDefinition<
    TPayload extends object,
    TState extends BaseGameSnapshot = BaseGameSnapshot,
> {
    readonly type: string;
    // Stage 2: Structural validation — throw ActionSchemaError on failure
    parsePayload(raw: Readonly<Record<string, unknown>>): TPayload;
    // Stage 4: Semantic legality check — ok:false + reason on failure
    validate(
        payload: TPayload,
        state: Readonly<TState>,
        playerId: PlayerId,
        ctx: ReduceContext,
    ): ValidationResult;
    // Stage 5: Pure state transition — same inputs → same output always
    reduce(
        state: Readonly<TState>,
        payload: TPayload,
        playerId: PlayerId,
        ctx: ReduceContext,
    ): TState;
    // Set true only for own-player-only, non-randomised, non-contested actions
    readonly predictable?: boolean;
}

// Handed to validate() and reduce(). Deliberately narrow — do not widen ad-hoc.
interface ReduceContext {
    readonly rng: DeterministicRng; // Seeded from (state.seed, state.tick)
    readonly db?: ContentDatabase; // Absent for games that declare no content
    readonly undoManager?: {
        // Populated by ActionPipeline (F16)
        canUndo(playerId: PlayerId): boolean;
        canRedo(playerId: PlayerId): boolean;
    };
    readonly dispatch?: (
        // Only engine:tick may call this (§4.20, F21)
        state: Readonly<BaseGameSnapshot>,
        action: ActionEnvelope,
    ) => BaseGameSnapshot;
    readonly dispatchDepth: number; // Nesting depth; 0 at top-level call
}
```

---

## ActionRegistry

```typescript
interface GameDefinition<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    /** Called once by the host when a session is being created for this game. */
    readonly buildInitialEntities?: (hostPlayerId: PlayerId | undefined) => TState['entities'];
}

interface ActionRegistry<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    register<TPayload extends object>(definition: ActionDefinition<TPayload, TState>): void;
    resolve(type: string): ActionDefinition<object, TState>; // throws UnknownActionTypeError
    registerGame(gameId: string, definition: GameDefinition<TState>): void;
    resolveGame(gameId: string): GameDefinition<TState> | undefined;
    has(type: string): boolean;
    registeredTypes(): readonly string[];
}
```

Games register a `GameDefinition` alongside their action definitions during startup. The host uses `resolveGame(gameId)` to ask for game-level initialisation hooks, such as `buildInitialEntities`, without importing game-specific factories directly. A game with no registered definition is valid; hosts treat its initial entity map as empty.

### Namespace Conventions

| Namespace  | Owner       | Examples                                        |
| ---------- | ----------- | ----------------------------------------------- |
| `engine:*` | Engine core | `engine:undo`, `engine:redo`, `engine:end_turn` |
| `<game>:*` | Game        | `<game>:move_entity`, `<game>:use_ability`      |

The engine **rejects** any attempt to register an action with the `engine:` prefix at startup.

---

## ActionPipeline — The Invariant 7-Stage Sequence

Games cannot reorder or skip steps. They supply `ActionDefinition` strategies for stages 2, 4, and 5 only.

```
Stage 1  resolve()    — registry.resolve(action.type)                       → ActionDefinition | UnknownActionTypeError
Stage 2  parse()      — definition.parsePayload(action.payload)             → TPayload | ActionSchemaError
Terminal gate         — if snapshot.gameResult !== null, reject all actions
                         except engine:sync_request with match_already_resolved
Stage 3  intercept()  — handle engine:undo/redo via UndoManager             → may short-circuit pipeline
Stage 4  validate()   — definition.validate(payload, state, playerId, ctx)  → ValidationResult
                         └─ if ok:false → broadcast REJECT to sender; halt
Stage 5  reduce()     — definition.reduce(state, payload, playerId, ctx)    → nextState
Stage 6  record()     — history.append({ tick, turnNumber, action })
Stage 7  broadcast()  — project(nextState, viewerId) for each viewer → StateBroadcaster → HostTransport
```

```typescript
interface ActionPipeline<TState extends BaseGameSnapshot> {
    process(state: Readonly<TState>, action: EngineAction, context: PipelineContext): TState;
}
```

### Role-Based Pipeline Contexts (ISP)

Each stage receives only the narrow context it needs. `PipelineContext` is the orchestrator-internal composition; game code always receives only `ReduceContext`.

```typescript
// Stage 5 only — re-entrant dispatch for engine:tick timer firings
interface ReductionContext extends ReduceContext {
    readonly dispatch: (
        actionType: string,
        payload: Record<string, unknown>,
        playerId: PlayerId,
        state: Readonly<BaseGameSnapshot>,
    ) => BaseGameSnapshot;
}

// Stage 6 only
interface HistoryContext {
    readonly history: ActionHistory;
}

// Stage 7 only
interface BroadcastContext {
    readonly projector: StateProjector;
    readonly broadcast: (snapshot: PlayerSnapshot, to: PlayerId) => void;
}

// Stage 3 only
interface UndoContext {
    readonly undoManager: UndoManager;
}

// Debug (dev builds only, §4.12)
interface DebugContext {
    readonly debugObserver?: (tick: number, snapshot: GameSnapshot) => void;
}

// Internal orchestrator composition — game code never sees this
interface PipelineContext extends UndoContext, HistoryContext, BroadcastContext, DebugContext {
    readonly db?: ContentDatabase;
    readonly rng: DeterministicRng;
}
```

---

## Undo / Redo — Hybrid Memento + Event Sourcing

```typescript
interface TurnMemento {
    /** Tick value of the snapshot when the memento was captured (= state.tick at turn start). */
    tickAtTurnStart: number;
    playerId: PlayerId;
    snapshotAtTurnStart: GameSnapshot;
}

interface ActionHistoryEntry {
    tickApplied: number;
    turnNumber: number;
    action: EngineAction;
}

interface UndoManager {
    saveTurnMemento(state: GameSnapshot, playerId: PlayerId): void;
    /** `playerId` identifies whose memento to use as the replay base. */
    undo(playerId: PlayerId, steps?: number): GameSnapshot;
    redo(playerId: PlayerId, steps?: number): GameSnapshot;
    canUndo(playerId: PlayerId): boolean;
    canRedo(playerId: PlayerId): boolean;
    setPolicy(policy: UndoPolicy): void;
    clearUndoHistory(playerId: PlayerId): void;
}

interface ActionHistory {
    /**
     * Append a new entry to the history. If the history exceeds MAX_ACTION_HISTORY_ENTRIES,
     * the oldest entry is evicted and an `action-history:overflow` warn is emitted with the
     * entry count and the most-recent memento's turn number.
     */
    append(entry: ActionHistoryEntry): void;
    sinceLastMemento(): readonly ActionHistoryEntry[];
    /**
     * Remove every ActionHistoryEntry whose turnNumber < cutoff (strict <, never <=).
     * Idempotent: calling pruneTo with an identical or lower cutoff is a no-op.
     * @param cutoff — typically currentTurn - TURN_MEMENTO_RETENTION (invariant 45)
     */
    pruneTo(cutoff: number): void;
}
```

---

## 4.2.1 Determinism Foundations

Three non-negotiable rules make the simulation bit-identical on every machine that applies the same action sequence to the same initial snapshot.

### Rule 1 — Action-Driven Clock

`GameSnapshot.tick` increments by exactly **1 per action applied** by `ActionPipeline.process()`. It is a logical counter, never a timestamp. `SimulationClock.now()` returns `snapshot.tick`; it never reads `Date.now()` or `performance.now()`.

Real-time games wrap a host-side `RealtimeTicker` (lives in `electron/main/` — outside deterministic core) that dispatches `engine:tick` actions at a fixed wall-clock cadence. Each `engine:tick` advances the counter by 1.

### Rule 2 — Deterministic RNG Only

```typescript
interface DeterministicRng {
    int(min: number, max: number): number; // [min, max] inclusive
    float(): number; // 53-bit float in [0, 1)
    shuffle<T>(items: readonly T[]): T[]; // Fisher-Yates; input not mutated
    pick<T>(items: readonly T[]): T;
}
```

`ActionPipeline` constructs a fresh `DeterministicRng` seeded from `(state.seed, state.tick)` before each `reduce()` call. Game code **must not** call `Math.random()`, `Date.now()`, `performance.now()`, or any non-deterministic source from inside `validate()` or `reduce()`.

Implementation: splitmix64 seed expansion → xoshiro256\*\* (fast, statistically sound, 64-bit).

### Rule 3 — Integer / Fixed-Point State

Cross-platform floating-point is not bit-exact. All `GameSnapshot` fields that participate in equality, checksums, or arithmetic must be integers.

| Domain                  | Representation                     | Example                    |
| ----------------------- | ---------------------------------- | -------------------------- |
| Money                   | Integer — smallest currency unit   | `$3.50` → `350` (cents)    |
| Grid position           | Integer coordinates                | `{ x: 3, y: 2 }`           |
| Continuous position     | Integer fixed-point (Q16.16, etc.) | `x = 12345` means 12.345 m |
| Percentages             | Integer basis points (0–10000)     | 37.5% → `3750`             |
| Timestamps inside state | `tick` number only                 | never `Date.now()`         |

Floats are permitted inside the renderer (camera, animation, UI) but must never flow back into `GameSnapshot` or `EngineAction.payload`.

### ActionHistory Bounding

| Constant                     | Value    | Role                                                                            |
| ---------------------------- | -------- | ------------------------------------------------------------------------------- |
| `TURN_MEMENTO_RETENTION`     | `4`      | Turns of undo reach; mementoes older than this are evicted                      |
| `MAX_ACTION_HISTORY_ENTRIES` | `10_000` | Safety-net memory cap; overflow emits `action-history:overflow` warn and evicts |

---

## 4.7 Action Registry Pattern

### Design Rationale — Open/Closed Principle

| Without registry                         | With registry                                           |
| ---------------------------------------- | ------------------------------------------------------- |
| Engine defines every action type         | Engine defines pipeline contract only                   |
| `StateReducer` switches on `action.type` | `StateReducer` calls `registry.resolve(type)`           |
| Adding an action = modifying engine core | Adding an action = registering a new `ActionDefinition` |
| One game per engine                      | N games, one engine                                     |

### Full Implementation Example

```typescript
// games/<game>/actions/MoveEntityAction.ts
import { ActionDefinition, ValidationResult } from '@chimera/simulation/engine';
import { MyGameSnapshot } from '../state/GameSnapshot';

interface MoveEntityPayload {
    readonly entityId: string;
    readonly to: { readonly x: number; readonly y: number };
}

const MoveEntityAction: ActionDefinition<MoveEntityPayload, MyGameSnapshot> = {
    type: '<game>:move_entity',

    parsePayload(raw): MoveEntityPayload {
        if (typeof raw.entityId !== 'string' || typeof raw.to !== 'object')
            throw new ActionSchemaError('<game>:move_entity', raw);
        return raw as MoveEntityPayload;
    },

    validate(payload, state, playerId, _ctx): ValidationResult {
        const entity = state.entities[payload.entityId];
        if (!entity) return { ok: false, reason: 'entity_not_found' };
        if (entity.ownerId !== playerId) return { ok: false, reason: 'not_owner' };
        if (entity.movesLeft <= 0) return { ok: false, reason: 'no_moves_remaining' };
        return { ok: true };
    },

    reduce(state, payload, _playerId, _ctx): MyGameSnapshot {
        return {
            ...state,
            entities: {
                ...state.entities,
                [payload.entityId]: {
                    ...state.entities[payload.entityId],
                    position: payload.to,
                    movesLeft: state.entities[payload.entityId].movesLeft - 1,
                },
            },
        };
    },

    predictable: true,
};

export default MoveEntityAction;
```

---

## Key Invariants

- **Invariant #1** — `GameSnapshot` never leaves main process; only `PlayerSnapshot` crosses boundaries.
- **Invariant #2** — `simulation/` has zero runtime dependencies on React, DOM, or networking.
- **Invariant #7** — `engine:undo` and `engine:redo` go through the normal `ActionPipeline`; no side-door.
- **Invariant #10** — All game action types are registered in `ActionRegistry` before tick loop starts.
- **Invariant #11** — The `engine:` namespace is reserved; games must not use it.
- **Invariant #12** — `ActionPipeline` steps are invariant in order; games supply strategies, not ordering.
- **Invariant #43** — `validate()` and `reduce()` must not call `Math.random`, `Date.now`, or any I/O.
- **Invariant #44** — All arithmetic `GameSnapshot` fields must be integers.
- **Invariant #45** — `ActionHistory` is bounded by `TURN_MEMENTO_RETENTION=4` and cap `10_000`.

---

## Cross-References

- [Undo/Redo Policy](undo-redo-policy.md) — `UndoPolicy` interface, `DEFAULT_UNDO_POLICY`
- [State Projection Interfaces](state-projection-interfaces.md) — `StateProjector`, `VisibilityRules`
- [Content Database](content-database-data-refs.md) — `ContentDatabase` passed via `ReduceContext.db`
- [Fixed-Point Math](fixed-point-math.md) — `FixedPoint` Q32.32 type for fractional simulation values
- [Game Timers](game-timers.md) — `engine:tick` reducer + `ctx.dispatch` re-entry
