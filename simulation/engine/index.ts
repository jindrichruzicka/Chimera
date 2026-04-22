/**
 * Public API of the simulation engine sub-module.
 *
 * Re-exports all engine types and classes from `simulation/engine/`.
 * Populated progressively as F03 tasks land:
 *   - T2 (§4.2): BaseGameSnapshot, EngineAction, ActionEnvelope, ActionDefinition,
 *                ReduceContext, SimulationHostRole, SimulationClientRole
 *   - T3 (§4.7): ActionRegistry, UnknownActionTypeError, NamespaceCollisionError
 *   - T4 (§4.7): EngineActions, registerEngineActions
 *   - T5 (§4.7): ActionPipeline, StateReducer, StaleActionError,
 *                ActionSchemaError, ActionUnauthorizedError, RecursiveDispatchError,
 *                MAX_NESTED_DISPATCH
 */

export type {
    PlayerId,
    EntityId,
    GamePhase,
    BasePlayerState,
    BaseEntityState,
    GameEvent,
    BaseGameSnapshot,
    ContentDatabase,
    EngineAction,
    TypedAction,
    ActionEnvelope,
    ValidationResult,
    ReduceContext,
    ActionDefinition,
    SimulationHostRole,
    SimulationClientRole,
} from './types.js';

export {
    ActionRegistry,
    NamespaceCollisionError,
    UnknownActionTypeError,
} from './ActionRegistry.js';

export type { EngineTickPayload, EngineEndTurnPayload } from './EngineActions.js';

export { EngineActions, registerEngineActions } from './EngineActions.js';

export {
    ActionPipeline,
    StateReducer,
    StaleActionError,
    ActionSchemaError,
    ActionUnauthorizedError,
    RecursiveDispatchError,
    MAX_NESTED_DISPATCH,
} from './ActionPipeline.js';
