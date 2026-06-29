/**
 * simulation/replay/ReplayPlayer.ts
 *
 * Deterministic replay playback over an injected live ActionPipeline.
 * Pure simulation code — no I/O, platform APIs, Electron, renderer, or game imports.
 *
 * Architecture reference: §4.28
 * Task: F44 / T2 (issue #656)
 *
 * Invariants upheld:
 *   #1  — simulation/replay has zero runtime deps on Electron, renderer, games, or networking
 *   #42 — replay advances only by one ActionPipeline.process() call per recorded action
 *   #43 — replay path does not call Date.now, Math.random, or perform I/O
 *   #70 — ReplayPlayer uses the injected ActionPipeline instance; it never constructs one
 *   #71 — typed initial state is reconstructed from seed + gameConfig, never from PlayerSnapshot input
 */

import type { Logger } from '../foundation/logging.js';
import type { ActionPipeline } from '../engine/ActionPipeline.js';
import type {
    ActionEnvelope,
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    EntityId,
    GamePhase,
    PlayerId,
    SceneId,
} from '../engine/types.js';
import { entityId, gamePhase, playerId, sceneId } from '../engine/types.js';
import type { RecordedAction, ReplayFile } from './ReplayFile.js';

const DEFAULT_TURN_DEADLINE_MS = 30_000;

export type ReplayInitialSnapshotFactory<TState extends BaseGameSnapshot> = (
    file: ReplayFile,
) => TState;

export type ReplayStopFn = () => void;

export type ReplayFrameCallback<TState extends BaseGameSnapshot> = (
    snapshot: TState,
    stop: ReplayStopFn,
) => void;

export type ReplayEnvelopeMismatchField = 'tick' | 'playerId';

const NOOP_LOGGER: Logger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: function () {
        return this;
    },
};

interface ParsedReplayGameConfig {
    readonly hostPlayerId?: PlayerId;
    readonly playerIds: readonly PlayerId[];
    readonly firstPlayerId?: PlayerId;
    readonly phase: GamePhase;
    readonly initialEntities: BaseGameSnapshot['entities'];
}

export class ReplaySeekError extends Error {
    readonly code = 'REPLAY_SEEK' as const;
    readonly requestedTick: number;
    readonly finalTick: number | undefined;

    constructor(requestedTick: number, finalTick?: number) {
        super(
            finalTick === undefined
                ? `ReplaySeekError: requested tick ${requestedTick.toString()} is not a non-negative integer.`
                : `ReplaySeekError: requested tick ${requestedTick.toString()} is beyond final tick ${finalTick.toString()}.`,
        );
        this.name = 'ReplaySeekError';
        this.requestedTick = requestedTick;
        this.finalTick = finalTick;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class DeterminismError extends Error {
    readonly code = 'REPLAY_DETERMINISM' as const;
    readonly firstTick: number;
    readonly secondTick: number;

    constructor(firstTick: number, secondTick: number, message?: string) {
        super(
            message ??
                `DeterminismError: replay runs diverged at final ticks ${firstTick.toString()} and ${secondTick.toString()}.`,
        );
        this.name = 'DeterminismError';
        this.firstTick = firstTick;
        this.secondTick = secondTick;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class ReplayEnvelopeMismatchError extends Error {
    readonly code = 'REPLAY_ENVELOPE_MISMATCH' as const;
    readonly field: ReplayEnvelopeMismatchField;
    readonly recordedValue: number | PlayerId;
    readonly envelopeValue: number | PlayerId;

    constructor(
        field: ReplayEnvelopeMismatchField,
        recordedValue: number | PlayerId,
        envelopeValue: number | PlayerId,
    ) {
        super(
            `ReplayEnvelopeMismatchError: recorded ${field} ${String(
                recordedValue,
            )} does not match envelope ${field} ${String(envelopeValue)}.`,
        );
        this.name = 'ReplayEnvelopeMismatchError';
        this.field = field;
        this.recordedValue = recordedValue;
        this.envelopeValue = envelopeValue;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class ReplayPlayer<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #pipeline: ActionPipeline<TState>;
    readonly #file: ReplayFile;
    readonly #initialSnapshotFactory: ReplayInitialSnapshotFactory<TState>;
    readonly #logger: Logger;
    #snapshot: TState | null = null;
    #cursor = 0;

    // @chimera-review: ActionRegistry is intentionally not accepted here because ActionPipeline
    // owns the live registry wiring; the factory is required to reconstruct concrete game state.
    constructor(
        file: ReplayFile,
        pipeline: ActionPipeline<TState>,
        initialSnapshotFactory: ReplayInitialSnapshotFactory<TState>,
        logger: Logger = NOOP_LOGGER,
    ) {
        this.#file = file;
        this.#pipeline = pipeline;
        this.#initialSnapshotFactory = initialSnapshotFactory;
        this.#logger = logger.child({ module: 'simulation.replay-player', gameId: file.gameId });
    }

    /** Reset to initial state derived from file.seed and file.gameConfig. */
    initialize(): TState {
        const snapshot = this.#initialSnapshotFactory(this.#file);
        this.#snapshot = snapshot;
        this.#cursor = 0;
        return snapshot;
    }

    /** Apply the next recorded action; returns the resulting snapshot or null if complete. */
    step(): TState | null {
        const current = this.#snapshot ?? this.initialize();
        const entry = this.#file.actions[this.#cursor];
        if (entry === undefined) {
            return null;
        }

        const action = toActionEnvelope(entry);
        const next = this.#pipeline.process(current, action);
        if (next.tick !== current.tick + 1) {
            this.#logger.warn('replay determinism error', {
                actionType: action.type,
                expectedTick: current.tick + 1,
                actualTick: next.tick,
                recordedTick: entry.tick,
            });
            throw new DeterminismError(
                current.tick + 1,
                next.tick,
                `DeterminismError: replay action at tick ${current.tick.toString()} advanced to ${next.tick.toString()} instead of ${(current.tick + 1).toString()}.`,
            );
        }
        this.#snapshot = next;
        this.#cursor += 1;
        return next;
    }

    /** Jump to the snapshot at the given tick by replaying from 0 up to that snapshot tick. */
    seek(tick: number): TState {
        if (!Number.isInteger(tick) || tick < 0) {
            this.#logger.warn('replay seek rejected', { requestedTick: tick });
            throw new ReplaySeekError(tick);
        }

        let snapshot = this.initialize();
        while (snapshot.tick < tick) {
            const next = this.step();
            if (next === null) {
                this.#logger.warn('replay seek beyond final tick', {
                    requestedTick: tick,
                    finalTick: snapshot.tick,
                });
                throw new ReplaySeekError(tick, snapshot.tick);
            }
            snapshot = next;
        }

        if (snapshot.tick !== tick) {
            this.#logger.warn('replay seek skipped requested tick', {
                requestedTick: tick,
                actualTick: snapshot.tick,
            });
            throw new ReplaySeekError(tick, snapshot.tick);
        }

        return snapshot;
    }

    /** Replay remaining actions, invoking the frame callback for each produced snapshot. */
    play(speedMultiplier: number, onFrame: ReplayFrameCallback<TState>): ReplayStopFn {
        if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
            throw new RangeError('Replay speedMultiplier must be a positive finite number.');
        }
        // Reserved for caller-side scheduling; simulation playback stays tick-driven.

        let stopped = false;
        const stop = (): void => {
            stopped = true;
        };

        let next = this.step();
        while (next !== null) {
            onFrame(next, stop);
            if (stopped) {
                break;
            }
            next = this.step();
        }

        return stop;
    }

    /** Replay all remaining actions to the end; returns the final snapshot. */
    playSync(): TState {
        let snapshot = this.#snapshot ?? this.initialize();
        let next = this.step();
        while (next !== null) {
            snapshot = next;
            next = this.step();
        }
        return snapshot;
    }
}

export function assertReplayDeterministic<TState extends BaseGameSnapshot>(
    first: ReplayPlayer<TState>,
    second: ReplayPlayer<TState>,
): TState {
    let firstSnapshot = first.initialize();
    let secondSnapshot = second.initialize();

    if (!deepEqual(firstSnapshot, secondSnapshot)) {
        throw new DeterminismError(0, 0, 'DeterminismError: replay runs diverged at tick 0.');
    }

    while (true) {
        const firstNext = first.step();
        const secondNext = second.step();
        if (firstNext === null || secondNext === null) {
            if (firstNext === null && secondNext === null) {
                return firstSnapshot;
            }

            throw new DeterminismError(
                firstNext?.tick ?? firstSnapshot.tick,
                secondNext?.tick ?? secondSnapshot.tick,
                `DeterminismError: replay runs diverged at tick ${Math.max(
                    firstNext?.tick ?? firstSnapshot.tick,
                    secondNext?.tick ?? secondSnapshot.tick,
                ).toString()}; one run completed before the other.`,
            );
        }

        if (!deepEqual(firstNext, secondNext)) {
            throw new DeterminismError(
                firstNext.tick,
                secondNext.tick,
                `DeterminismError: replay runs diverged at tick ${firstNext.tick.toString()}.`,
            );
        }

        firstSnapshot = firstNext;
        secondSnapshot = secondNext;
    }
}

export function createBaseReplayInitialSnapshot(file: ReplayFile): BaseGameSnapshot {
    const config = parseReplayGameConfig(file.gameConfig);
    const allPlayerIds = uniquePlayerIds([
        ...config.playerIds,
        ...(config.hostPlayerId !== undefined ? [config.hostPlayerId] : []),
        ...(config.firstPlayerId !== undefined ? [config.firstPlayerId] : []),
    ]);
    const players = buildPlayers(allPlayerIds);
    const activePlayerId = config.firstPlayerId ?? allPlayerIds[0];
    const initialSceneId: SceneId =
        config.phase === gamePhase('playing') ? sceneId('engine:game') : sceneId('engine:lobby');

    // The session tick is monotonic across match boundaries (`engine:start_game`
    // and `engine:return_to_lobby` advance the tick, they do not reset it), so a
    // second-or-later match's first recorded action is at a non-zero tick. The
    // initial snapshot is the pre-`actions[0]` state, so under invariant #42 its
    // tick MUST equal `actions[0].tick`; otherwise the ActionPipeline rejects the
    // first replayed action with a StaleActionError. An empty replay has no
    // baseline action and reconstructs at tick 0.
    const baseTick = file.actions[0]?.tick ?? 0;

    const snapshot: BaseGameSnapshot = {
        tick: baseTick,
        seed: file.seed,
        players,
        entities: config.initialEntities,
        phase: config.phase,
        events: [],
        turnNumber: 0,
        ...(config.hostPlayerId !== undefined ? { hostPlayerId: config.hostPlayerId } : {}),
        ...(activePlayerId !== undefined
            ? {
                  turnClock: {
                      activePlayerId,
                      deadlineMs: DEFAULT_TURN_DEADLINE_MS,
                  },
              }
            : {}),
        timers: {},
        gameResult: null,
        sceneId: initialSceneId,
        sceneTransition: null,
    };

    return snapshot;
}

function parseReplayGameConfig(raw: Readonly<Record<string, unknown>>): ParsedReplayGameConfig {
    const hostPlayerId = parseOptionalPlayerId(raw['hostPlayerId'], 'gameConfig.hostPlayerId');
    const firstPlayerId = parseOptionalPlayerId(raw['firstPlayerId'], 'gameConfig.firstPlayerId');

    return {
        ...(hostPlayerId !== undefined ? { hostPlayerId } : {}),
        playerIds: parsePlayerIds(raw['playerIds']),
        ...(firstPlayerId !== undefined ? { firstPlayerId } : {}),
        phase: parsePhase(raw['phase']),
        initialEntities: parseInitialEntities(raw['initialEntities']),
    };
}

function parseOptionalPlayerId(raw: unknown, path: string): PlayerId | undefined {
    if (raw === undefined) {
        return undefined;
    }
    if (typeof raw !== 'string' || raw.length === 0) {
        throw new TypeError(`${path} must be a non-empty string when present.`);
    }
    return playerId(raw);
}

function parsePlayerIds(raw: unknown): readonly PlayerId[] {
    if (raw === undefined) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new TypeError('gameConfig.playerIds must be an array when present.');
    }

    const result: PlayerId[] = [];
    for (const value of raw) {
        if (typeof value !== 'string' || value.length === 0) {
            throw new TypeError('gameConfig.playerIds must contain only non-empty strings.');
        }
        result.push(playerId(value));
    }
    return result;
}

function parsePhase(raw: unknown): GamePhase {
    if (raw === undefined) {
        return gamePhase('lobby');
    }
    if (typeof raw !== 'string' || raw.length === 0) {
        throw new TypeError('gameConfig.phase must be a non-empty string when present.');
    }
    return gamePhase(raw);
}

function parseInitialEntities(raw: unknown): BaseGameSnapshot['entities'] {
    if (raw === undefined) {
        return createDataDictionary<EntityId, BaseEntityState>();
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError('gameConfig.initialEntities must be an entity map when present.');
    }

    const entities = createDataDictionary<EntityId, BaseEntityState>();
    for (const [rawId, rawEntity] of Object.entries(raw)) {
        if (rawId.length === 0 || rawEntity === null || typeof rawEntity !== 'object') {
            throw new TypeError(
                'gameConfig.initialEntities must map non-empty entity ids to objects.',
            );
        }
        const entityRecord = rawEntity as Readonly<Record<string, unknown>>;
        const rawEntityId = entityRecord['id'];
        if (typeof rawEntityId !== 'string' || rawEntityId.length === 0) {
            throw new TypeError(
                'gameConfig.initialEntities entries must include a non-empty string id.',
            );
        }
        entities[entityId(rawId)] = copyEntityRecord(entityRecord, entityId(rawEntityId));
    }
    return entities;
}

function copyEntityRecord(
    entityRecord: Readonly<Record<string, unknown>>,
    id: EntityId,
): BaseEntityState {
    const entity = createDataDictionary<string, unknown>();
    for (const [key, value] of Object.entries(entityRecord)) {
        entity[key] = value;
    }
    entity['id'] = id;
    if (!hasEntityId(entity)) {
        throw new TypeError('gameConfig.initialEntities entry id was not copied.');
    }
    return entity;
}

function uniquePlayerIds(playerIds: readonly PlayerId[]): readonly PlayerId[] {
    const seen = new Set<PlayerId>();
    const result: PlayerId[] = [];
    for (const id of playerIds) {
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        result.push(id);
    }
    return result;
}

function buildPlayers(playerIds: readonly PlayerId[]): Record<PlayerId, BasePlayerState> {
    const players = createDataDictionary<PlayerId, BasePlayerState>();
    for (const id of playerIds) {
        players[id] = { id };
    }
    return players;
}

function toActionEnvelope(entry: RecordedAction): ActionEnvelope {
    const { action } = entry;
    if (entry.tick !== action.tick) {
        throw new ReplayEnvelopeMismatchError('tick', entry.tick, action.tick);
    }
    if (entry.playerId !== action.playerId) {
        throw new ReplayEnvelopeMismatchError('playerId', entry.playerId, action.playerId);
    }
    return {
        type: action.type,
        playerId: action.playerId,
        tick: action.tick,
        payload: action.payload,
    };
}

function createDataDictionary<TKey extends string, TValue>(): Record<TKey, TValue> {
    return Object.create(null) as Record<TKey, TValue>;
}

function hasEntityId(
    entity: Record<string, unknown>,
): entity is BaseEntityState & Record<string, unknown> {
    return typeof entity['id'] === 'string';
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (typeof left !== typeof right || left === null || right === null) {
        return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }
        for (let index = 0; index < left.length; index += 1) {
            if (!deepEqual(left[index], right[index])) {
                return false;
            }
        }
        return true;
    }
    if (typeof left !== 'object' || typeof right !== 'object') {
        return false;
    }

    const leftRecord = left as Readonly<Record<string, unknown>>;
    const rightRecord = right as Readonly<Record<string, unknown>>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) {
            return false;
        }
        if (!deepEqual(leftRecord[key], rightRecord[key])) {
            return false;
        }
    }
    return true;
}
