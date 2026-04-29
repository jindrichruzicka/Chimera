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
 *   - F16 (§4.5): UndoPolicy, DEFAULT_UNDO_POLICY,
 *                TurnMemento, ActionHistoryEntry, ActionHistory, UndoManager,
 *                UndoNotAllowedError, InMemoryActionHistory, InMemoryUndoManager
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
    UndoContext,
    HistoryContext,
    BroadcastContext,
    ViewerSnapshot,
    UndoMeta,
    DebugContext,
    PipelineContext,
    ActionDefinition,
    SimulationHostRole,
    SimulationClientRole,
} from './types.js';

export { playerId, toViewerSnapshot } from './types.js';

export type { DeterministicRng } from './DeterministicRng.js';
export { createRng } from './DeterministicRng.js';

export { simulationClock } from './SimulationClock.js';
export type { SimulationClock } from './SimulationClock.js';

export {
    ActionRegistry,
    NamespaceCollisionError,
    UnknownActionTypeError,
} from './ActionRegistry.js';

export type { EngineTickPayload, EngineEndTurnPayload } from './EngineActions.js';

export {
    EngineActions,
    registerEngineActions,
    engineTickDefinition,
    engineEndTurnDefinition,
    engineSaveDefinition,
    engineLoadDefinition,
    engineUndoDefinition,
    engineRedoDefinition,
    engineSyncRequestDefinition,
} from './EngineActions.js';

export { StateReducer, ActionSchemaError } from './StateReducer.js';

export {
    ActionPipeline,
    StaleActionError,
    ActionUnauthorizedError,
    RecursiveDispatchError,
    MAX_NESTED_DISPATCH,
} from './ActionPipeline.js';

export type { UndoPolicy } from './UndoPolicy.js';
export { DEFAULT_UNDO_POLICY } from './UndoPolicy.js';

export type { TurnMemento, ActionHistoryEntry, ActionHistory, UndoManager } from './UndoManager.js';
export {
    UndoNotAllowedError,
    InMemoryActionHistory,
    InMemoryUndoManager,
    TURN_MEMENTO_RETENTION,
    MAX_ACTION_HISTORY_ENTRIES,
} from './UndoManager.js';

export { ClientPredictor, NonPredictableActionError } from './prediction/ClientPredictor.js';
