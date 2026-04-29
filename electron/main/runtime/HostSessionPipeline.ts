/**
 * electron/main/runtime/HostSessionPipeline.ts
 *
 * Factory that constructs an `ActionPipeline` with `InMemoryActionHistory`
 * and `InMemoryUndoManager` wired via `PipelineContext` for a single hosted
 * game session.
 *
 * Called once per hosted session in the `onSessionHosted` callback wired in
 * `electron/main/index.ts`.  Injecting these collaborators here (the DIP
 * wiring point) keeps `ActionPipeline` and `simulation/` free of any
 * Electron or Node dependencies.
 *
 * Architecture: §4.5, §4.7, §7 — UndoManager, PipelineContext, ActionPipeline
 *   host bootstrap.
 * Issue: #364
 *
 * Invariants upheld:
 *   #2  — Zero imports from renderer/, electron/, games/*, or DOM APIs.
 *   #7  — engine:undo/redo enter the pipeline via Stage 3 intercept when
 *          PipelineContext.undoManager is present; this factory ensures it
 *          always is for hosted sessions.
 *   #43 — The replay callback is pure: uses only StateReducer.apply with
 *          a freshly seeded createRng(s.seed, s.tick) — no Math.random(),
 *          no Date.now(), no I/O.
 */

import type { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import type {
    BaseGameSnapshot,
    PlayerId,
    ViewerSnapshot,
} from '@chimera/simulation/engine/types.js';
import { ActionPipeline } from '@chimera/simulation/engine/ActionPipeline.js';
import { StateReducer } from '@chimera/simulation/engine/StateReducer.js';
import { createRng } from '@chimera/simulation/engine/DeterministicRng.js';
import {
    InMemoryActionHistory,
    InMemoryUndoManager,
} from '@chimera/simulation/engine/UndoManager.js';
import type { ActionHistoryEntry } from '@chimera/simulation/engine/UndoManager.js';
import { DEFAULT_UNDO_POLICY } from '@chimera/simulation/engine/UndoPolicy.js';

/**
 * Result of `buildHostSessionPipeline`.
 *
 * `pipeline`         — the fully wired `ActionPipeline` with history and undo context.
 * `undoManager`      — direct access to the `InMemoryUndoManager` for calling
 *                      `saveTurnMemento` at turn-start and any out-of-band queries.
 * `clearUndoHistory` — call at session close to release per-player undo memory
 *                      (Invariant #7, issue #364 teardown requirement).
 */
export interface HostSessionPipelineResult {
    readonly pipeline: ActionPipeline;
    readonly undoManager: InMemoryUndoManager;
    readonly clearUndoHistory: (activePlayerIds: readonly PlayerId[]) => void;
}

/**
 * Build a per-session `ActionPipeline` wired with `InMemoryActionHistory` and
 * `InMemoryUndoManager`.
 *
 * @param registry    - The `ActionRegistry` with game and engine actions registered.
 * @param broadcastFn - Called by Stage 7 for each player-specific projected snapshot.
 *                      Typically `StateBroadcaster.broadcast` bound to the active
 *                      session's `HostTransport`.
 *
 * @returns `HostSessionPipelineResult` — pipeline, undoManager, and a teardown helper.
 *
 * ## Replay purity (Invariant #43)
 *
 * The replay callback reconstructs state from a turn-start memento by applying
 * each `ActionHistoryEntry.action` through `StateReducer.apply`.  Each step
 * seeds `createRng` from the intermediate state's `(seed, tick)` pair — the
 * same seeding the pipeline uses at Stage 5.  This guarantees determinism:
 * the same memento + the same history entries always yield the same snapshot.
 */
export function buildHostSessionPipeline(
    registry: ActionRegistry,
    broadcastFn: (snapshot: ViewerSnapshot, viewerId: PlayerId) => void,
): HostSessionPipelineResult {
    const history = new InMemoryActionHistory();
    const reducer = new StateReducer(registry);

    /**
     * Pure deterministic replay (Invariant #43).
     *
     * Replays each history entry's action through `StateReducer.apply` on top
     * of the turn-start memento.  `StateReducer.apply` calls only
     * `def.parsePayload` and `def.reduce` — no I/O, no wall-clock, no
     * `Math.random()` (the seeded `rng` satisfies the determinism invariant).
     *
     * `dispatch` is intentionally omitted from the context: replay entries
     * never contain engine:tick sub-dispatches, and including a live dispatch
     * would risk re-entrant side effects during reconstruction.
     */
    const replay = (
        base: BaseGameSnapshot,
        entries: readonly ActionHistoryEntry[],
    ): BaseGameSnapshot =>
        entries.reduce(
            (s, e) => reducer.apply(s, e.action, { rng: createRng(s.seed, s.tick) }),
            base,
        );

    const undoManager = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replay);

    const pipeline = new ActionPipeline(registry, {
        context: {
            undoManager,
            history,
            broadcast: broadcastFn,
        },
    });

    const clearUndoHistory = (activePlayerIds: readonly PlayerId[]): void => {
        for (const pid of activePlayerIds) {
            undoManager.clearUndoHistory(pid);
        }
    };

    return { pipeline, undoManager, clearUndoHistory };
}
