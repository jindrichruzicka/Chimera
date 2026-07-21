---
title: 'AI Framework and Agent System'
description: 'PlayerAgent/HumanPlayerAgent, AgentManager, AIStateMachine, AIBrain, AICommand, CommandScheduler, CommandContext, per-tick lifecycle, honest vs omniscient AI policy.'
tags: [ai, agents, state-machine, commands, simulation, strategy-pattern]
---

# AI Framework and Agent System

> §4.9 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Module Boundaries](../executive-architecture/module-boundaries-file-tree.md)

---

## Design Rationale

The simulation engine works exclusively with `PlayerId`. It has no concept of whether a player is a human at a keyboard or an AI. The AI layer sits **above** the simulation as a set of agent controllers — each agent observes `PlayerSnapshot` and dispatches `EngineAction` through the same `ActionPipeline` as human players.

- AI actions are validated and logged identically to human actions.
- Determinism and auditability are preserved.
- Games can mix human and AI players freely without engine changes.
- AI is **honest by default** — it sees only its own `PlayerSnapshot`, respecting fog of war. This holds on **every** state-delivery path: the snapshot an agent is seeded with at construction is projected exactly like the per-tick fan-out (Invariant #17).

---

## PlayerAgent — Strategy Pattern

```typescript
// ai/engine/PlayerAgent.ts

interface PlayerAgent {
    readonly playerId: PlayerId;
    readonly kind: 'human' | 'ai';
    readonly omniscient: boolean;
    onTick(snapshot: PlayerSnapshot, tick: number): void;
    onGameStart(snapshot: PlayerSnapshot): void;
    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void;
}

interface AIPlayerAgentOptions {
    readonly omniscient?: boolean;
}

// Human agent is a no-op stub — human actions arrive through IPC, not here
class HumanPlayerAgent implements PlayerAgent {
    readonly kind = 'human' as const;
    readonly omniscient = false as const;
    constructor(readonly playerId: PlayerId) {}
    onTick() {}
    onGameStart() {}
    onGameEnd() {}
}

class AIPlayerAgent implements PlayerAgent {
    readonly kind = 'ai' as const;
    readonly omniscient: boolean;

    constructor(playerId: PlayerId, brain: AIBrain, options: AIPlayerAgentOptions = {}) {
        this.omniscient = options.omniscient ?? false;
    }
}
```

---

## AgentManager

```typescript
// ai/engine/AgentManager.ts
// Owned by simulation-host.ts in Electron main. Called after every simulation tick.

interface AgentManager {
    registerAgent(agent: PlayerAgent): void;
    // Projects GameSnapshot per AI player, forwards to each agent
    tickAll(fullState: GameSnapshot, tick: number, projector: StateProjector): void;
    onGameStart(fullState: GameSnapshot, projector: StateProjector): void;
    onGameEnd(fullState: GameSnapshot, result: GameResult, projector: StateProjector): void;
}
```

---

## Lobby Agent-Slot Controls

AI players are provisioned **in the lobby**, before the match starts, so the host can fill empty seats with AI and reclaim them for late-joining humans. The engine owns the slots; a game contributes only the AI brain.

- `LobbyAgentSlot` (`{ slotIndex, kind, omniscient? }`) marks a seat as AI on the synced `LobbyState.agentSlots`. Adding or removing an AI is a **host-only** write (mirroring the host-authored match-setting rule, Invariant #99) and rebroadcasts to every peer, so all clients render the same roster — humans in the player list, AI in a separate sub-list. The Add-AI control is disabled when the lobby is full.
- The host **auto-removes** an AI slot when admitting a human would otherwise exceed `maxPlayers`, so a human join never bounces off an AI-filled lobby.
- At match start the host materialises each `agentSlot` into an `AIPlayerAgent` through `HostedSessionAgents`, wiring the game-supplied `AIBrain`; from there the agent ticks via `AgentManager` like any other AI player (honest by default — it sees only its own `PlayerSnapshot`). `buildDefaultAIPlayerAgent` projects the **seed** snapshot through the session's `StateProjector` before handing it to `AIStateMachine.setInitialState`, so an honest agent's very first `onEnter` is fog-respecting too — this matters most on the restore path, where the roster is seated _after_ a mid-game checkpoint is applied. The simulation still works purely in `PlayerId` and never learns a seat was lobby-provisioned.

---

## AIParams — Personality Parameters

```typescript
// Base — all fields must be primitives (number | string | boolean | null | undefined).
// Primitive-only values ensure shallow Object.freeze in AIBrain is complete (Invariant #18).
// Arrays and nested objects are not allowed; reference unit def IDs as strings instead.
interface AIParams extends Record<string, number | string | boolean | null | undefined> {}

// Example game extension:
interface GameAIParams extends AIParams {
    aggressivity: number; // 0.0 (passive) → 1.0 (all-out attack)
    riskTolerance: number; // 0.0 (never gambles) → 1.0 (high risk)
    preferredStrategy?: string; // strategy key (e.g. 'rush' | 'turtle' | 'balanced')
}
```

`AIParams` are passed **by value (frozen)** to every lifecycle method. AI state and command implementations must not mutate them. Fields are restricted to primitives so that shallow `Object.freeze` provides complete immutability.

> **Invariant #18** — `AIParams` are passed by value (frozen) to every lifecycle method.
> **Invariant #19** — At most one state transition is applied per AI tick.

---

## AIState — State Pattern

```typescript
// ai/engine/AIState.ts

interface AIState<TParams extends AIParams = AIParams> {
    readonly name: string;

    onEnter(
        snapshot: PlayerSnapshot,
        params: Readonly<TParams>,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    onTick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: Readonly<TParams>,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    // Primary planning opportunity — called when scheduler queue empties
    onIdle(
        snapshot: PlayerSnapshot,
        tick: number,
        params: Readonly<TParams>,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;

    onExit(snapshot: PlayerSnapshot, params: Readonly<TParams>): void;
}
```

---

## AICommand — Command Pattern

Commands span multiple simulation ticks. `onTick` returns `CommandProgress` to drive the scheduler.

```typescript
// ai/engine/AICommand.ts

interface AICommand<TParams extends AIParams = AIParams, TPayload = unknown> {
    readonly type: string; // namespaced: '<game>:move-to-target'
    readonly payload: Readonly<TPayload>;

    onStart(snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;
    onTick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        context: CommandContext,
    ): CommandProgress;
    onEnd(snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;
    onFail(
        snapshot: PlayerSnapshot,
        params: TParams,
        context: CommandContext,
        reason: string,
    ): void;
}

type CommandProgress =
    | { status: 'running' }
    | { status: 'done' }
    | { status: 'failed'; reason: string };

// Existential wrapper so the scheduler queue remains well-typed without `any`
type AnyAICommand<TParams extends AIParams = AIParams> = AICommand<TParams, unknown>;
```

---

## CommandContext — Dispatch Bridge

```typescript
// ai/engine/CommandContext.ts

interface CommandContext {
    // Submit EngineAction — routes through ActionPipeline like a human action
    dispatch(action: EngineAction): void;
    // Request state transition — deferred to end of current tick (re-entrancy guard)
    transitionState(stateName: string): void;
}
```

---

## CommandScheduler

```typescript
// ai/engine/CommandScheduler.ts

interface CommandScheduler<TParams extends AIParams = AIParams> {
    enqueue(command: AnyAICommand<TParams>): void;
    enqueueNext(command: AnyAICommand<TParams>): void; // urgent/interrupt
    advance(snapshot: PlayerSnapshot, tick: number, params: TParams, context: CommandContext): void;
    clearQueue(): void;
    abort(reason: string, snapshot: PlayerSnapshot, params: TParams, context: CommandContext): void;
    readonly isIdle: boolean;
    readonly queueLength: number;
}
```

---

## AIStateMachine

```typescript
// ai/engine/AIStateMachine.ts

interface AIStateMachine<TParams extends AIParams = AIParams> {
    registerState(state: AIState<TParams>): void;
    // setInitialState calls onEnter — identical to a later transition
    setInitialState(
        stateName: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;
    transition(
        stateName: string,
        snapshot: PlayerSnapshot,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;
    tick(
        snapshot: PlayerSnapshot,
        tick: number,
        params: TParams,
        scheduler: CommandScheduler<TParams>,
        context: CommandContext,
    ): void;
    readonly currentState: AIState<TParams>;
}
```

---

## AIBrain + AIPlayerAgent

```typescript
// ai/engine/AIBrain.ts — Facade wiring stateMachine + scheduler + context + params
class AIBrain<TParams extends AIParams = AIParams> {
    /** Frozen copy of the params provided at construction (Invariant #18). */
    readonly params: Readonly<TParams>;

    constructor(
        private readonly stateMachine: AIStateMachine<TParams>,
        private readonly scheduler: CommandScheduler<TParams>,
        private readonly context: CommandContext,
        params: TParams,
    ) {
        this.params = Object.freeze({ ...params });
    }

    onGameStart(snapshot: PlayerSnapshot): void {
        this.stateMachine.tick(snapshot, 0, this.params, this.scheduler, this.context);
    }

    tick(snapshot: PlayerSnapshot, tick: number): void {
        this.stateMachine.tick(snapshot, tick, this.params, this.scheduler, this.context);
    }

    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void {
        this.scheduler.abort('game_ended', snapshot, this.params, this.context);
    }
}

class AIPlayerAgent<TParams extends AIParams = AIParams> implements PlayerAgent {
    readonly kind = 'ai' as const;
    constructor(
        readonly playerId: PlayerId,
        private readonly brain: AIBrain<TParams>,
    ) {}
    onTick(snapshot: PlayerSnapshot, tick: number): void {
        this.brain.tick(snapshot, tick);
    }
    onGameStart(snapshot: PlayerSnapshot): void {
        this.brain.onGameStart(snapshot);
    }
    onGameEnd(snapshot: PlayerSnapshot, result: GameResult): void {
        this.brain.onGameEnd(snapshot, result);
    }
}
```

---

## Lifecycle Diagram

Projection is not a per-tick concern — it gates **every** delivery, starting at
construction (Invariant #17):

```
Agent construction (host seats the slot) → GameSnapshot
     │
     ▼
[buildDefaultAIPlayerAgent({ initialSnapshot, projector, omniscient })]
     │
     ▼  honest: project(gameSnapshot, playerId) → PlayerSnapshot
        omniscient: declared full-state spread
   [AIStateMachine.setInitialState(...)] → currentState.onEnter(...)
```

```
Simulation tick N completes → GameSnapshot
     │
     ▼
[AgentManager.tickAll(gameSnapshot, tick, projector)]
     │
     └── for each AI PlayerAgent:
           ▼  project(gameSnapshot, playerId) → PlayerSnapshot (honest: fog respected)
         [AIBrain.tick(playerSnapshot, tick)]
           ▼
         [AIStateMachine.tick(...)]
           ├── 1. Apply deferred state transition (if any)
           ├── 2. CommandScheduler.advance(...)
           │        ├── active command: onTick() → CommandProgress
           │        │     'done'   → onEnd(); dequeue next; next.onStart()
           │        │     'failed' → onFail(); clear queue
           │        └── idle: scheduler.isIdle = true
           ├── 3. if scheduler.isIdle: currentState.onIdle(...)  ← planning
           └── 4. currentState.onTick(...)                       ← reactions
```

---

## Information Access Policy

| AI Mode                 | Snapshot received                                        | Use when                                            |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| **Honest AI** (default) | `PlayerSnapshot` — fog of war respected, hands hidden    | Competitive play; AI has same info as human         |
| **Omniscient AI**       | `GameSnapshot` (full truth) — host-only, never networked | Puzzle modes, tutorial AI, declared "cheating" mode |

Omniscient mode is opt-in per `PlayerAgent` object, declared via `omniscient: true`. Games declare this in their player configuration; it is never the default.

The honest row means a `PlayerSnapshot` **produced by `StateProjector.project()`**, not merely a value of that type. Spreading a `GameSnapshot` into `PlayerSnapshot` shape type-checks — TypeScript does not excess-property-check spread-in members — while carrying `seed`, `turnClock`, `turnNumber`, `hostPlayerId`, `timers`, `committedTurns` and every game-local root field. Only `AgentManager`'s omniscient branch and `buildDefaultAIPlayerAgent`'s omniscient seed branch may build a snapshot that way.

> **Invariant #16** — AI players submit `EngineAction` through `ActionPipeline` — there is no back-door mutation path for AI.
> **Invariant #17** — AI receives a `PlayerSnapshot` produced by `StateProjector.project()` by default (honest AI), on every state-delivery path — the construction-time seed as much as the per-tick fan-out. Omniscient mode must be explicitly declared and is logged at game start.

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `ActionPipeline`, `EngineAction`, `ReduceContext`
- [State Projection Interfaces](state-projection-interfaces.md) — `StateProjector.project()` used by `AgentManager`
