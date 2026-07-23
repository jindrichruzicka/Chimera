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
 * Architecture: §4.5, §4.7, §4.11 — UndoManager, PipelineContext, ActionPipeline
 *   host bootstrap, autosave wiring.
 *
 * Invariants upheld:
 *   #2  — Zero imports from renderer/, electron/, games/*, or DOM APIs.
 *   #7  — engine:undo/redo enter the pipeline via Stage 3 intercept when
 *          PipelineContext.undoManager is present; this factory ensures it
 *          always is for hosted sessions.
 *   #25 — Autosave is an out-of-band host call; it does NOT appear as a
 *          re-entrant engine:save action inside the pipeline.
 *   #43 — The replay callback is pure: uses only StateReducer.apply with
 *          a freshly seeded createRng(s.seed, s.tick) — no Math.random(),
 *          no Date.now(), no I/O.  Autosave I/O is wired here at the host
 *          orchestration layer (post-pipeline), never inside reduce().
 */

import type { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
    GameResult,
} from '@chimera-engine/simulation/engine/types.js';
import { ActionPipeline } from '@chimera-engine/simulation/engine/ActionPipeline.js';
import { StateReducer } from '@chimera-engine/simulation/engine/StateReducer.js';
import { createRng } from '@chimera-engine/simulation/engine/DeterministicRng.js';
import {
    InMemoryActionHistory,
    InMemoryUndoManager,
} from '@chimera-engine/simulation/engine/UndoManager.js';
import type { ActionHistoryEntry } from '@chimera-engine/simulation/engine/UndoManager.js';
import { DEFAULT_UNDO_POLICY } from '@chimera-engine/simulation/engine/UndoPolicy.js';
import type { RecordedAction, ReplayHeader } from '@chimera-engine/simulation/replay/index.js';
import type { ContentDatabase } from '@chimera-engine/simulation/content/index.js';
import type { Logger } from '../logging/logger.js';
import { createNoopLogger } from '../logging/logger.js';

// ─── AutoSave port ───────────────────────────────────────────────────────────

/**
 * Narrow interface through which `buildHostSessionPipeline` triggers autosave.
 *
 * Injected at construction time; the concrete implementation in
 * `electron/main/index.ts` delegates to `SaveManager.autoSave()`.
 * Tests inject a `vi.fn()` stub to verify call behaviour without I/O.
 *
 * Architecture: §4.11 — DIP wiring for persistence (invariant #37).
 */
export interface AutoSavePort {
    /**
     * Persist the current game state to the `<gameId>/autosave` slot.
     *
     * Called fire-and-forget after every successful `engine:end_turn`.
     * The concrete implementation must be non-blocking; errors are caught
     * and logged by the caller so they never propagate to the pipeline.
     */
    readonly autoSave: (gameId: string, snapshot: BaseGameSnapshot) => Promise<void>;
}

export interface GameEndPort {
    /** Notify the AI/runtime layer that the match reached a resolved result. */
    readonly onGameEnd: (snapshot: Readonly<BaseGameSnapshot>, result: GameResult) => void;
}

// ─── Replay port ─────────────────────────────────────────────────────────────

/**
 * Narrow interface through which `buildHostSessionPipeline` records a live match
 * for later replay (§4.28).  Wired to `ReplayManager` in `index.ts`.
 *
 * `startRecording` is called by the composition root at session initialisation
 * (after `seed` and `gameConfig` are resolved); the pipeline itself only calls
 * `recordAction` (per successfully applied `EngineAction`, while the match is
 * live). The match is deliberately NOT persisted at game-over — the in-progress
 * recording is retained in memory and written only when the user presses the
 * replay player's save icon (§4.28); an unsaved match is discarded at teardown.
 *
 * Recording is a best-effort side effect: a failure must never propagate to the
 * live transport path (same guarantee as `AutoSavePort`, invariant #25 spirit).
 */
export interface ReplayPort {
    /** Begin recording a new match with its static header metadata. */
    startRecording(header: ReplayHeader): void;
    /**
     * Append one applied action to the in-progress recording.  Stores the
     * `EngineAction` payload only — never a `GameSnapshot` (invariants #3/#71).
     */
    recordAction(entry: RecordedAction): void;
}

// ─── Debug port ──────────────────────────────────────────────────────────────

/**
 * Narrow interface through which the Runtime Debug Layer observes a hosted
 * session (§4.12). Implemented by `electron/main/debug-bridge.ts`
 * and supplied only when `IS_DEBUG_MODE` is true — when absent, the pipeline
 * context carries NO `debugObserver` field (Invariant #31) and
 * `processAction` performs no timing work.
 *
 * Both callbacks are invoked from the live action path; implementations must
 * never throw (`observer` is invoked unguarded by `ActionPipeline`;
 * `onActionApplied` is guarded here, mirroring the replayPort isolation).
 */
export interface HostSessionDebugPort {
    /**
     * Wired as `PipelineContext.debugObserver`: fires between stage 5
     * (reduce) and stage 7 (broadcast) with the post-reduce state, and on
     * the Stage 3 undo/redo intercept with the reconstructed state.
     */
    readonly observer: (tick: number, snapshot: Readonly<BaseGameSnapshot>) => void;
    /**
     * Fires once per `processAction` call after `pipeline.process` returns.
     * `entry` mirrors the Stage 6 history append shape (`tickApplied` is the
     * PRE-state tick); `next` is the resulting authoritative state;
     * `durationMs` is the wall-clock duration of the `pipeline.process` call
     * (wall-clock reads are forbidden in `simulation/`, Invariant #43 — the
     * measurement therefore lives here, at the host orchestration layer).
     */
    readonly onActionApplied: (
        entry: ActionHistoryEntry,
        next: Readonly<BaseGameSnapshot>,
        durationMs: number,
    ) => void;
}

// ─── HostSessionPipelineOptions ──────────────────────────────────────────────

/**
 * Optional per-session configuration for `buildHostSessionPipeline`.
 *
 * When `gameId` and `savePort` are both supplied, `processAction` fires
 * `savePort.autoSave(gameId, nextState)` as a fire-and-forget call after
 * every successful `engine:end_turn` (Invariant #25, #43).
 */
export interface HostSessionPipelineOptions {
    /**
     * The game identifier for this session (e.g. `'tactics'`).
     * Passed directly to `savePort.autoSave` after `engine:end_turn`.
     */
    readonly gameId: string;
    /**
     * Narrow persistence port.  Wire to `SaveManager` in `index.ts`.
     * When absent, autosave is silently skipped (no error).
     */
    readonly savePort: AutoSavePort;
    /** Optional game-end notification port, wired to SimulationHost.onGameEnd. */
    readonly gameEndPort?: GameEndPort;
    /**
     * Optional live-match replay recording port, wired to `ReplayManager`.
     * When absent, recording is silently skipped (no error).  Purely additive:
     * `AutoSavePort`/`GameEndPort` behaviour is unchanged.
     */
    readonly replayPort?: ReplayPort;
    /**
     * Optional logger for autosave error reporting.
     * Defaults to a noop logger when absent.
     */
    readonly logger?: Logger;
    /**
     * Optional Runtime Debug Layer port (§4.12). Supplied by the debug
     * bridge only when `IS_DEBUG_MODE` is true; absent in production so the
     * pipeline context never carries a `debugObserver` field (Invariant #31).
     */
    readonly debugPort?: HostSessionDebugPort;
    /**
     * Optional immutable content database for this game (§4.8). When supplied
     * it is wired into `PipelineContext.db` so `validate()`/`reduce()` can read
     * game content. Absent for games that declare no content (Invariant #46).
     */
    readonly db?: ContentDatabase;
}

/**
 * Result of `buildHostSessionPipeline`.
 *
 * `pipeline`         — the fully wired `ActionPipeline` with history and undo context.
 * `processAction`    — thin wrapper around `pipeline.process` that fires autosave
 *                      fire-and-forget after a successful `engine:end_turn`.
 *                      Prefer calling this over `pipeline.process` directly.
 * `undoManager`      — direct access to the `InMemoryUndoManager` for calling
 *                      `saveTurnMemento` at turn-start and any out-of-band queries.
 * `clearUndoHistory` — call at session close to release per-player undo memory
 *                      (Invariant #7 teardown requirement).
 */
export interface HostSessionPipelineResult {
    readonly pipeline: ActionPipeline;
    /**
     * Process one action envelope and fire autosave if the action is
     * `engine:end_turn` and a `savePort` was supplied at construction.
     *
     * The autosave call is fire-and-forget (`void`); any rejection is caught
     * and logged — it NEVER propagates to the caller (Invariant #25).
     *
     * Returns the next authoritative `BaseGameSnapshot` (same contract as
     * `ActionPipeline.process`).
     */
    readonly processAction: (
        snapshot: Readonly<BaseGameSnapshot>,
        action: ActionEnvelope,
    ) => BaseGameSnapshot;
    readonly undoManager: InMemoryUndoManager;
    readonly clearUndoHistory: (activePlayerIds: readonly PlayerId[]) => void;
    /**
     * The session's pure replay callback (same instance injected into
     * `InMemoryUndoManager`). Exposed so the debug bridge can reconstruct
     * snapshots from a turn memento (§4.12); pure and deterministic
     * (Invariant #43).
     */
    readonly replay: (
        base: BaseGameSnapshot,
        entries: readonly ActionHistoryEntry[],
    ) => BaseGameSnapshot;
}

/**
 * Build a per-session `ActionPipeline` wired with `InMemoryActionHistory` and
 * `InMemoryUndoManager`.
 *
 * @param registry    - The `ActionRegistry` with game and engine actions registered.
 * @param broadcastFn - Called by Stage 7 for each player's full state. The callback
 *                      is responsible for projecting the state via `StateProjector.project()`
 *                      to produce a per-viewer `PlayerSnapshot` before forwarding to
 *                      transport (Invariants #3/#8). Typically this is
 *                      `StateBroadcaster.broadcast` bound to the active session's
 *                      `HostTransport`.
 * @param options     - Optional per-session configuration.  Supply `gameId` and
 *                      `savePort` to enable autosave after `engine:end_turn`.
 *
 * @returns `HostSessionPipelineResult` — pipeline, processAction, undoManager, and a teardown helper.
 *
 * ## Autosave wiring (Invariants #25 and #43)
 *
 * After a successful `engine:end_turn`, `processAction` fires
 * `options.savePort.autoSave(options.gameId)` as a fire-and-forget call.
 * The call happens AFTER Stage 7 broadcast returns so the pipeline response
 * path is never blocked.  Any rejection is caught and logged; it never
 * propagates to the transport caller.
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
    broadcastFn: (snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId) => void,
    broadcastTickFnOrOptions?:
        | ((tick: number, viewerId: PlayerId) => void)
        | HostSessionPipelineOptions,
    options?: HostSessionPipelineOptions,
): HostSessionPipelineResult {
    const broadcastTickFn =
        typeof broadcastTickFnOrOptions === 'function' ? broadcastTickFnOrOptions : undefined;
    const resolvedOptions =
        typeof broadcastTickFnOrOptions === 'function' ? options : broadcastTickFnOrOptions;
    const history = new InMemoryActionHistory(
        resolvedOptions?.logger !== undefined ? { logger: resolvedOptions.logger } : undefined,
    );
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
            (s, e) =>
                reducer.apply(s, e.action, { rng: createRng(s.seed, s.tick), dispatchDepth: 0 }),
            base,
        );

    const undoManager = new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replay);

    const pipeline = new ActionPipeline(registry, {
        ...(resolvedOptions?.gameId !== undefined ? { gameId: resolvedOptions.gameId } : {}),
        ...(resolvedOptions?.logger !== undefined ? { logger: resolvedOptions.logger } : {}),
        context: {
            undoManager,
            history,
            broadcast: broadcastFn,
            ...(broadcastTickFn === undefined ? {} : { broadcastTick: broadcastTickFn }),
            // Invariant #46: the `db` field is ABSENT unless this game supplied a
            // ContentDatabase, so reducers for content-free games see `ctx.db`
            // as undefined.
            ...(resolvedOptions?.db === undefined ? {} : { db: resolvedOptions.db }),
            // Invariant #31: the field is ABSENT (not undefined-assigned)
            // unless the debug bridge supplied a port.
            ...(resolvedOptions?.debugPort === undefined
                ? {}
                : { debugObserver: resolvedOptions.debugPort.observer }),
        },
    });

    const clearUndoHistory = (activePlayerIds: readonly PlayerId[]): void => {
        for (const pid of activePlayerIds) {
            undoManager.clearUndoHistory(pid);
        }
    };

    // ── Autosave hook ──────────────────────────────────────────────────────
    // Resolve the optional logger and save port once at construction time so
    // the hot `processAction` path has no conditional property accesses.
    const log: Logger = resolvedOptions?.logger ?? createNoopLogger();
    const { gameId, savePort, gameEndPort, replayPort, debugPort } = resolvedOptions ?? {};

    /**
     * Thin wrapper around `ActionPipeline.process` that fires autosave as a
     * fire-and-forget side effect after a successful `engine:end_turn`.
     *
     * Autosave is only triggered when BOTH `gameId` and `savePort` were
     * supplied in `options` — otherwise the call is a no-op (no error thrown).
     *
     * The autosave Promise is intentionally NOT awaited so the pipeline
     * response path is never blocked (Invariant #25).  Any rejection is
     * caught here and logged; it never propagates to the transport caller.
     */
    const processAction = (
        snapshot: Readonly<BaseGameSnapshot>,
        action: ActionEnvelope,
    ): BaseGameSnapshot => {
        const wasResolved = snapshot.gameResult !== null;
        const processStartMs = debugPort === undefined ? 0 : performance.now();
        const nextState = pipeline.process(snapshot, action);

        // ── Runtime Debug Layer feed (§4.12) ──────────────────────────────────
        // Mirror the Stage 6 history append shape (tickApplied = PRE-state
        // tick) and report the wall-clock pipeline.process duration. A debug
        // feed failure must never break the live pipeline (Invariant #25
        // spirit — same isolation as the replayPort block below).
        if (debugPort !== undefined) {
            const durationMs = performance.now() - processStartMs;
            try {
                debugPort.onActionApplied(
                    {
                        tickApplied: snapshot.tick,
                        turnNumber: snapshot.turnNumber,
                        action,
                    },
                    nextState,
                    durationMs,
                );
            } catch (err: unknown) {
                log.error(
                    'debug onActionApplied failed',
                    err instanceof Error ? err : new Error(String(err)),
                    { actionType: action.type },
                );
            }
        }

        // ── Replay recording ──────────────────────────────────────────────────
        // Record every successfully applied action while the match is live.
        // After resolution the recording is already finalised, so the
        // `!wasResolved` guard both records the match-ending action and prevents
        // a record-after-finalise.  Side-channel traffic never reaches here, so
        // it is excluded by construction (invariant #71).  A recording failure
        // must never break the live pipeline (invariant #25 spirit).
        if (!wasResolved && replayPort !== undefined) {
            try {
                replayPort.recordAction({
                    tick: action.tick, // invariant #42: tick at the time of the action
                    playerId: action.playerId,
                    action, // invariants #3/#71: EngineAction payload only — never a snapshot
                });
            } catch (err: unknown) {
                log.error(
                    'replay recordAction failed',
                    err instanceof Error ? err : new Error(String(err)),
                    { actionType: action.type },
                );
            }
        }

        if (!wasResolved && nextState.gameResult !== null) {
            // Signal match end, but do NOT persist the replay here: the recording
            // is retained in memory (invariant of `ReplayPort`) and written only on
            // an explicit save from the replay player. This is what keeps every
            // finished match from silently accumulating a replay file (§4.28).
            gameEndPort?.onGameEnd(nextState, nextState.gameResult);
        }

        if (action.type === 'engine:end_turn' && gameId !== undefined && savePort !== undefined) {
            void savePort.autoSave(gameId, nextState).catch((err: unknown) => {
                log.error(
                    'autosave failed after engine:end_turn',
                    err instanceof Error ? err : new Error(String(err)),
                    { gameId },
                );
            });
        }

        return nextState;
    };

    return { pipeline, processAction, undoManager, clearUndoHistory, replay };
}
