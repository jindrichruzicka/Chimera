/**
 * `@chimera-engine/ai/engine` — the runtime surface of the game-agnostic agent
 * framework (Architecture §4.9 — AI Framework and Agent System).
 *
 * Consumers (e.g. the Electron host) import the framework classes from this
 * subpath rather than internal module paths directly. Unlike the side-effect-
 * free root barrel (`@chimera-engine/ai`, contract types only), importing this subpath
 * evaluates the AI runtime modules.
 *
 * Everything here is game-agnostic (Invariant #106): game-specific AI policies
 * live in the consumer's `games/<name>/ai/`, never inside `@chimera-engine/ai`.
 */

// ─── Framework runtime (classes) ──────────────────────────────────────────────
export { AIBrain } from './AIBrain.js';
export { AgentManager } from './AgentManager.js';
export { CommandSchedulerImpl } from './CommandScheduler.js';
export { AIStateMachineImpl } from './AIStateMachine.js';
export { CommandContextImpl } from './CommandContext.js';
export { HumanPlayerAgent, AIPlayerAgent } from './PlayerAgent.js';

// ─── Framework contracts (types) ──────────────────────────────────────────────
export type { AIParams, PlayerSnapshot, GameResult } from './AITypes.js';
export type { AIState } from './AIState.js';
export type { AICommand, CommandProgress, AnyAICommand } from './AICommand.js';
export type { CommandScheduler } from './CommandScheduler.js';
export type { CommandContext } from './CommandContext.js';
export type { AIStateMachine } from './AIStateMachine.js';
export type { PlayerAgent, AIPlayerAgentOptions } from './PlayerAgent.js';
