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
- AI is **honest by default** — it sees only its own `PlayerSnapshot`, respecting fog of war.

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

## AIParams — Personality Parameters

```typescript
// Base — all fields must be primitives (number | string | boolean | null | undefined).
// Primitive-only values ensure shallow Object.freeze in AIBrain is complete (Invariant #18).
// Arrays and nested objects are not allowed; reference unit def IDs as strings instead.
interface AIParams extends Record<string, number | string | boolean | null | undefined> {}

// Example game extension:
interface TacticsAIParams extends AIParams {
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
    readonly type: string; // namespaced: 'tactics:move-to-target'
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

## Per-Tick Lifecycle Diagram

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

> **Invariant #16** — AI players submit `EngineAction` through `ActionPipeline` — there is no back-door mutation path for AI.
> **Invariant #17** — AI receives `PlayerSnapshot` by default (honest AI). Omniscient mode must be explicitly declared and is logged at game start.

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `ActionPipeline`, `EngineAction`, `ReduceContext`
- [State Projection Interfaces](state-projection-interfaces.md) — `StateProjector.project()` used by `AgentManager`
