/**
 * Public contract surface of `@chimera-engine/ai`.
 *
 * The package root (`.`) exposes the game-agnostic agent framework's
 * side-effect-free CONTRACT TYPES only. Importing `@chimera-engine/ai` therefore
 * evaluates no AI runtime module — it is the curated, tree-shakeable type
 * barrel that hosts depend on for type annotations without pulling the AI
 * runtime graph.
 *
 * Runtime APIs — the framework classes — are reached through the `./engine`
 * subpath, never the root:
 *   - `@chimera-engine/ai/engine` — AIBrain, AgentManager, CommandSchedulerImpl,
 *                            AIStateMachineImpl, CommandContextImpl,
 *                            AIPlayerAgent, HumanPlayerAgent
 *
 * Only the game-agnostic framework is reachable from this package (Invariant
 * #106): game-specific AI policies live in the consumer's `games/<name>/ai/`,
 * never inside `@chimera-engine/ai`.
 *
 * Asserted side-effect-free by
 * `ai/__tests__/contract-barrel-side-effects.test.ts`.
 */
export type { AIParams, PlayerSnapshot, GameResult } from './engine/AITypes.js';
export type { AIState } from './engine/AIState.js';
export type { AICommand, CommandProgress, AnyAICommand } from './engine/AICommand.js';
export type { CommandScheduler } from './engine/CommandScheduler.js';
export type { CommandContext } from './engine/CommandContext.js';
export type { AIStateMachine } from './engine/AIStateMachine.js';
export type { PlayerAgent, AIPlayerAgentOptions } from './engine/PlayerAgent.js';
