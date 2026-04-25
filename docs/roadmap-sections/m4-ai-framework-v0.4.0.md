---
title: 'M4 — AI Framework (v0.4.0)'
description: 'F22–F25: Player Abstraction/AgentManager, AIBrain/State Machine, CommandScheduler/Commands, and Honest vs Omniscient AI policy. AI plays a full headless match; honest-AI fog-of-war projection verified by tests.'
tags: [milestone, m4, ai, agent, state-machine, command-scheduler, fog-of-war]
---

# M4 — AI Framework (v0.4.0)

> **Goal**: AI plays a full headless match; honest-AI fog-of-war projection verified by tests.
> Architecture sections: §4.9

---

## F22 — Player Abstraction and AgentManager `§4.9`

Implement `PlayerAgent` interface, `HumanPlayerAgent` (no-op stub), `AgentManager` (tick fan-out), and `AIPlayerAgent`. Register agents for every player slot before tick loop starts. Wire `AgentManager.tickAll()` into `simulation-host.ts` after each tick.

---

## F23 — AIBrain and State Machine `§4.9 ai/engine/`

Implement `AIStateMachine` (state registration, deferred transitions, `setInitialState`), `AIBrain` facade, `AIState<TParams>` interface (`onEnter`, `onTick`, `onIdle`, `onExit`), and `AIParams` base type.

---

## F24 — CommandScheduler and Commands `§4.9 ai/engine/`

Implement `CommandScheduler` (queue, `advance`, `abort`, `isIdle`), `AICommand<TParams, TPayload>` interface (`onStart`, `onTick`, `onEnd`, `onFail`), `CommandProgress` discriminated union, `AnyAICommand` existential wrapper, and `CommandContext` (dispatch bridge + deferred `transitionState`).

---

## F25 — Honest vs Omniscient AI Policy `§4.9`

Enforce that `AgentManager` projects `GameSnapshot` per AI player (via `StateProjector`) before calling `AIBrain.tick()`. Implement opt-in omniscient mode per `AIPlayerAgent` instance with startup log entry. Add honest-AI isolation test: AI snapshot never exposes opponent's fog-hidden entities.

---

## Cross-References

- [AI Framework & Agent System](../core-components/ai-framework-agent-system.md)
- [State Projection Interfaces](../core-components/state-projection-interfaces.md) — `StateProjector` used by honest-AI isolation
- [Fog of War & Cryptographic Commitment](../security-trust/fog-of-war-cryptographic-commitment.md)
- [Testing Strategy](../testing/property-tests-soak.md) — AI integration test scenario, honest-AI isolation test
