// electron/main/__test-support__/sustained-match-harness.ts
//
// Drives a REAL hosted session for an arbitrary number of beats and reports the
// size of every structure the host retains across them.
//
// It wires the retention a live host has and a bare `ActionPipeline` does not:
// the session's `InMemoryActionHistory` (through `buildHostSessionPipeline`),
// the deterministic recorder, and the perspective recorder fed off the
// broadcast callback.
//
// Nothing here touches the filesystem: both recorders expose their in-progress
// buffer (`getCurrentMatchFile` / `getCurrentFile`) without persisting, and the
// repositories below reject every call so a stray write would fail loudly
// rather than leave a file behind.

import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { TimerManager } from '@chimera-engine/simulation/engine/GameTimer.js';
import type { TimerId, TimerRegistry } from '@chimera-engine/simulation/engine/GameTimer.js';
import type {
    ActionDefinition,
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase, playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import { ReplayMigrator } from '@chimera-engine/simulation/replay/index.js';
import type {
    PerspectiveReplayFile,
    PerspectiveReplayListItem,
    PerspectiveReplayRepository,
    ReplayFile,
    ReplayListingEntry,
    ReplayRepository,
} from '@chimera-engine/simulation/replay/index.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/StateProjector.js';
import type { VisibilityRules } from '@chimera-engine/simulation/projection/types.js';

import { createLogger, createMemorySink } from '../logging/logger.js';
import type { Logger } from '../logging/logger.js';
import { PerspectiveReplayManager } from '../replay/PerspectiveReplayManager.js';
import { ReplayManager } from '../replay/replay-manager.js';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';

/** The seat the harness hosts and records a perspective for. */
export const HARNESS_VIEWER: PlayerId = toPlayerId('player-1');

const HARNESS_GAME_ID = 'retention-harness';

/** Action a fired one-shot timer dispatches — a registered no-op. */
const HARNESS_TIMER_ACTION = 'harness:timer-fired';

/** Event type the beat hook appends. */
const HARNESS_EVENT = 'harness:beat';

// ─── Repositories that must never be reached ─────────────────────────────────

function refuse(method: string): never {
    throw new Error(
        `sustained-match-harness: ${method} must not be reached — the gate never persists`,
    );
}

const NEVER_PERSISTS: ReplayRepository = {
    save: (_file: ReplayFile): Promise<string> => refuse('ReplayRepository.save'),
    load: (): Promise<ReplayFile> => refuse('ReplayRepository.load'),
    list: (): Promise<string[]> => refuse('ReplayRepository.list'),
    listItems: (): Promise<ReplayListingEntry[]> => refuse('ReplayRepository.listItems'),
    delete: (): Promise<void> => refuse('ReplayRepository.delete'),
};

const NEVER_PERSISTS_PERSPECTIVE: PerspectiveReplayRepository = {
    save: (_file: PerspectiveReplayFile): Promise<string> =>
        refuse('PerspectiveReplayRepository.save'),
    load: (): Promise<PerspectiveReplayFile> => refuse('PerspectiveReplayRepository.load'),
    list: (): Promise<PerspectiveReplayListItem[]> => refuse('PerspectiveReplayRepository.list'),
    delete: (): Promise<void> => refuse('PerspectiveReplayRepository.delete'),
};

// ─── The hosted game ─────────────────────────────────────────────────────────

/** A no-op reducer for the action a fired timer dispatches. */
const timerFiredDef: ActionDefinition<Record<string, never>> = {
    type: HARNESS_TIMER_ACTION,
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => state,
};

/**
 * The per-beat hook. Every beat it:
 *
 *   - APPENDS one event, the way every shipped reducer does
 *     (`events: [...state.events, …]`). Appending is what makes the outbox
 *     measurable: a hook that ASSIGNED a fresh one-element array would hold
 *     `events.length` at 1 whether or not the pipeline still cleared the outbox
 *     at the start of each action, and the accumulation defect would be
 *     invisible here.
 *   - installs ONE one-shot timer under a beat-unique id, so `snapshot.timers`
 *     gains an entry per beat and only `TimerManager.advance`'s REMOVAL of a
 *     fired one-shot keeps the registry bounded. A fixed id would be replaced
 *     in place by `create` and would hold the registry at one entry whether the
 *     removal existed or not — the tombstone defect would be invisible too.
 *
 * The timer waits TWO beats rather than one, which puts the registry's steady
 * state at 2 while the outbox's is 1. Equal steady states would leave a reader
 * that mixed the two fields up reporting the wrong structure's growth under the
 * right structure's name.
 */
export function harnessBeat(state: BaseGameSnapshot): BaseGameSnapshot {
    const timerId = `harness-${state.tick.toString()}` as TimerId;
    const timers: TimerRegistry = TimerManager.create(state.timers, {
        id: timerId,
        remainingTicks: 2,
        intervalTicks: 0,
        actionType: HARNESS_TIMER_ACTION,
        payload: {},
    });
    return {
        ...state,
        events: [...state.events, { type: HARNESS_EVENT }],
        timers,
    };
}

/**
 * Everything visible, nothing masked. Retention is what this harness measures,
 * and a rule that hid entities would only shrink the frames the recorder holds
 * — never change whether their number follows the beat count.
 */
const HARNESS_VISIBILITY: VisibilityRules = {
    isEntityVisible: () => true,
    maskEntity: (entity) => entity,
    maskPlayerState: (target) => target,
    filterEvents: (events) => events,
};

// ─── Harness ─────────────────────────────────────────────────────────────────

/** The structures this harness measures, sampled at one instant. */
export interface RetainedSizes {
    /** Live entries in the session's `InMemoryActionHistory`. */
    readonly historyEntries: number;
    /** Frames held by the in-progress perspective recording. */
    readonly perspectiveFrames: number;
    /** Length of the authoritative snapshot's per-action event outbox. */
    readonly snapshotEvents: number;
    /** Keys in the authoritative snapshot's timer registry. */
    readonly snapshotTimers: number;
    /** Actions held by the in-progress deterministic recording. */
    readonly recordedActions: number;
}

export interface SustainedMatchHarness {
    /** Dispatch `count` more `engine:tick` beats through the real pipeline. */
    beat(count: number): void;
    /** Beats dispatched so far. */
    beatsElapsed(): number;
    /** Measure every retained structure at this instant. */
    retained(): RetainedSizes;
    /** Discard both in-progress recordings. */
    dispose(): void;
}

export interface SustainedMatchHarnessOptions {
    /** Bound handed to the session's action history. */
    readonly retainActions: number;
    /** Bound handed to the perspective recorder. */
    readonly maxPerspectiveFrames: number;
    /**
     * Whether the beat hook writes per-beat working state — appending an event
     * and installing a one-shot timer on every beat.
     *
     * Off, the hook is inert and only the capped buffers grow. That is not a
     * convenience: the timer registry is WALKED once per beat by
     * `TimerManager.advance`, so a defect that lets a fired timer survive its
     * beat makes the run quadratic. A caller measuring the capped buffers wants
     * tens of thousands of beats and must not pay that — measured, the mutant
     * proving its own gate works then hangs instead of failing, and a
     * synchronous beat loop cannot be cut short by a test timeout.
     */
    readonly perBeatState: boolean;
}

/**
 * Build a live hosted session with history, deterministic recording and
 * perspective recording all armed, driven by `engine:tick` beats.
 */
export function createSustainedMatchHarness(
    options: SustainedMatchHarnessOptions,
): SustainedMatchHarness {
    const logger: Logger = createLogger({
        source: { process: 'main', module: 'retention-harness' },
        sink: createMemorySink(),
    });

    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registry.register(timerFiredDef);
    registry.registerGame(HARNESS_GAME_ID, {
        buildInitialEntities: () => ({}),
        resolveGameResult: () => null,
        onBeat: options.perBeatState ? harnessBeat : (state) => state,
    });

    const deterministic = new ReplayManager(
        NEVER_PERSISTS,
        new ReplayMigrator(),
        { engineVersion: '0.0.0-harness', gameVersions: new Map([[HARNESS_GAME_ID, '0.0.0']]) },
        logger,
    );
    const perspective = new PerspectiveReplayManager(
        NEVER_PERSISTS_PERSPECTIVE,
        { engineVersion: '0.0.0-harness' },
        logger,
        { maxFrames: options.maxPerspectiveFrames },
    );
    const projector = new DefaultStateProjector(HARNESS_VISIBILITY);

    deterministic.startRecording({
        engineVersion: '0.0.0-harness',
        gameId: HARNESS_GAME_ID,
        gameVersion: '0.0.0',
        gameConfig: {},
        seed: 42,
        recordedAt: '2026-01-01T00:00:00.000Z',
        players: [{ playerId: HARNESS_VIEWER, displayName: 'Host' }],
    });
    perspective.start({
        formatVersion: 1,
        kind: 'perspective',
        engineVersion: '0.0.0-harness',
        gameId: HARNESS_GAME_ID,
        gameVersion: '0.0.0',
        viewerId: HARNESS_VIEWER,
        recordedAt: '2026-01-01T00:00:00.000Z',
        players: [{ playerId: HARNESS_VIEWER, displayName: 'Host' }],
    });

    // Stage 7 hands the authoritative snapshot per viewer; the callback
    // projects it and the projection is the frame. A live host also passes a
    // `broadcastTick` callback that records NO frame, so a clock-only beat
    // there costs no frame at all — this harness records on every beat, which
    // can only over-count frames relative to a real match, never under-count.
    const broadcast = (snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId): void => {
        const projected = projector.project(snapshot, viewerId);
        perspective.recordSnapshot({ tick: projected.tick, snapshot: projected });
    };

    const session = buildHostSessionPipeline(registry, broadcast, {
        gameId: HARNESS_GAME_ID,
        savePort: { autoSave: () => Promise.resolve() },
        replayPort: {
            startRecording: () => undefined,
            recordAction: (entry) => {
                deterministic.recordAction(entry);
            },
        },
        retainActions: options.retainActions,
        logger,
    });

    let snapshot: BaseGameSnapshot = {
        tick: 0,
        seed: 42,
        players: { [HARNESS_VIEWER]: { id: HARNESS_VIEWER } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: HARNESS_VIEWER,
        timers: {},
        gameResult: null,
    };
    let beats = 0;

    const tickEnvelope = (): ActionEnvelope => ({
        type: 'engine:tick',
        playerId: HARNESS_VIEWER,
        tick: snapshot.tick,
        payload: { seed: snapshot.seed },
    });

    return {
        beat(count: number): void {
            for (let i = 0; i < count; i += 1) {
                snapshot = session.processAction(snapshot, tickEnvelope());
                beats += 1;
            }
        },
        beatsElapsed: () => beats,
        retained: () => ({
            historyEntries: session.retainedActionCount(),
            perspectiveFrames: perspective.getCurrentFile().frames.length,
            snapshotEvents: snapshot.events.length,
            snapshotTimers: Object.keys(snapshot.timers).length,
            recordedActions: deterministic.getCurrentMatchFile().actions.length,
        }),
        dispose(): void {
            deterministic.abortRecording();
            perspective.abort();
        },
    };
}
