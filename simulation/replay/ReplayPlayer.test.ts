/**
 * simulation/replay/ReplayPlayer.test.ts
 *
 * TDD tests for ReplayPlayer over the live ActionPipeline.
 * Tests written first (RED before implementation).
 *
 * Architecture reference: §4.28
 * Task: F44 / T2 (issue #656)
 *
 * Invariants upheld:
 *   #1  — simulation/replay has zero runtime deps on Electron, renderer, games, or networking
 *   #42 — every replayed action advances tick by exactly 1 via ActionPipeline
 *   #43 — replay methods are pure; no I/O, Date.now, or Math.random
 *   #70 — ReplayPlayer uses the injected ActionPipeline
 *   #71 — initialization derives from seed + gameConfig only
 */

import { describe, expect, it } from 'vitest';
import type { Logger } from '../foundation/logging.js';
import { ActionPipeline } from '../engine/ActionPipeline.js';
import { ActionRegistry } from '../engine/ActionRegistry.js';
import type { ActionDefinition, BaseGameSnapshot } from '../engine/types.js';
import { entityId as toEntityId, playerId as toPlayerId } from '../engine/types.js';
import type { ReplayFile } from './ReplayFile.js';
import {
    assertReplayDeterministic,
    createBaseReplayInitialSnapshot,
    DeterminismError,
    ReplayEnvelopeMismatchError,
    ReplayPlayer,
    ReplaySeekError,
} from './ReplayPlayer.js';

interface CounterSnapshot extends BaseGameSnapshot {
    readonly total?: number;
}

interface StructuralSnapshot extends BaseGameSnapshot {
    readonly leftOnly?: true;
    readonly rightOnly?: true;
    readonly marker?: string | null;
    readonly tags?: readonly string[];
}

interface RequiredSnapshot extends BaseGameSnapshot {
    readonly requiredState: {
        readonly ready: true;
    };
}

interface AddPayload {
    readonly amount: number;
}

const P1 = toPlayerId('p1');
const P2 = toPlayerId('p2');

const noopLogger: Logger = {
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

function makeCapturingLogger(): { readonly logger: Logger; readonly warnings: string[] } {
    const warnings: string[] = [];
    const logger: Logger = {
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: (message) => {
            warnings.push(message);
        },
        error: () => undefined,
        fatal: () => undefined,
        child: function () {
            return this;
        },
    };

    return { logger, warnings };
}

const addDefinition: ActionDefinition<AddPayload, CounterSnapshot> = {
    type: 'test:add',
    parsePayload(raw) {
        const amount = raw['amount'];
        if (typeof amount !== 'number' || !Number.isInteger(amount)) {
            throw new TypeError('test:add amount must be an integer');
        }
        return { amount };
    },
    validate(_payload, state, playerId) {
        return state.players[playerId] === undefined
            ? { ok: false, reason: 'unknown_player' }
            : { ok: true };
    },
    reduce(state, payload): CounterSnapshot {
        return {
            ...state,
            tick: state.tick + 1,
            total: (state.total ?? 0) + payload.amount,
        };
    },
};

const stalledDefinition: ActionDefinition<Record<string, never>, CounterSnapshot> = {
    type: 'test:stall',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => state,
};

function makePipeline(): ActionPipeline<CounterSnapshot> {
    const registry = new ActionRegistry<CounterSnapshot>();
    registry.register(addDefinition);
    return new ActionPipeline(registry);
}

function makeRequiredPipeline(): ActionPipeline<RequiredSnapshot> {
    return new ActionPipeline(new ActionRegistry<RequiredSnapshot>());
}

function makeInitialSnapshot(file: ReplayFile): CounterSnapshot {
    return createBaseReplayInitialSnapshot(file);
}

function makeRequiredInitialSnapshot(file: ReplayFile): RequiredSnapshot {
    return {
        ...createBaseReplayInitialSnapshot(file),
        requiredState: { ready: true },
    };
}

function makeStructuralInitialSnapshot(file: ReplayFile): StructuralSnapshot {
    return createBaseReplayInitialSnapshot(file);
}

function makeReplayFile(overrides: Partial<ReplayFile> = {}): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '0.7.0',
        gameId: 'test-counter',
        gameVersion: '0.1.0',
        gameConfig: {
            hostPlayerId: P1,
            playerIds: [P1, P2],
            firstPlayerId: P2,
            phase: 'playing',
        },
        seed: 12345,
        actions: [
            {
                tick: 0,
                playerId: P1,
                action: { type: 'test:add', playerId: P1, tick: 0, payload: { amount: 2 } },
            },
            {
                tick: 1,
                playerId: P2,
                action: { type: 'test:add', playerId: P2, tick: 1, payload: { amount: 3 } },
            },
            {
                tick: 2,
                playerId: P1,
                action: { type: 'test:add', playerId: P1, tick: 2, payload: { amount: 5 } },
            },
        ],
        metadata: {
            recordedAt: '2026-06-02T10:00:00.000Z',
            durationTicks: 3,
            players: [
                { playerId: P1, displayName: 'Player One' },
                { playerId: P2, displayName: 'Player Two' },
            ],
        },
        ...overrides,
    };
}

function makeSingleActionReplayFile(actionType: string): ReplayFile {
    return makeReplayFile({
        actions: [
            {
                tick: 0,
                playerId: P1,
                action: { type: actionType, playerId: P1, tick: 0, payload: {} },
            },
        ],
    });
}

function makePlayer(file: ReplayFile = makeReplayFile()): ReplayPlayer<CounterSnapshot> {
    return new ReplayPlayer(file, makePipeline(), makeInitialSnapshot, noopLogger);
}

function makePlayerWithDefinition(
    definition: ActionDefinition<object, CounterSnapshot>,
    file: ReplayFile,
    logger: Logger = noopLogger,
): ReplayPlayer<CounterSnapshot> {
    const registry = new ActionRegistry<CounterSnapshot>();
    registry.register(definition);
    return new ReplayPlayer(file, new ActionPipeline(registry), makeInitialSnapshot, logger);
}

function makeStructuralPlayer(
    definition: ActionDefinition<Record<string, never>, StructuralSnapshot>,
    file: ReplayFile,
): ReplayPlayer<StructuralSnapshot> {
    const registry = new ActionRegistry<StructuralSnapshot>();
    registry.register(definition);
    return new ReplayPlayer(
        file,
        new ActionPipeline(registry),
        makeStructuralInitialSnapshot,
        noopLogger,
    );
}

function makeStructuralDefinition(
    actionType: string,
    reduceSnapshot: (state: StructuralSnapshot) => StructuralSnapshot,
): ActionDefinition<Record<string, never>, StructuralSnapshot> {
    return {
        type: actionType,
        parsePayload: () => ({}),
        validate: () => ({ ok: true }),
        reduce: reduceSnapshot,
    };
}

describe('ReplayPlayer.initialize', () => {
    it('resets to an initial snapshot derived from file.seed and file.gameConfig', () => {
        const player = makePlayer();

        const snapshot = player.initialize();

        expect(snapshot).toMatchObject({
            tick: 0,
            seed: 12345,
            turnNumber: 0,
            hostPlayerId: P1,
            gameResult: null,
        });
        expect(Object.keys(snapshot.players)).toEqual(['p1', 'p2']);
        expect(snapshot.turnClock?.activePlayerId).toBe(P2);
    });

    it('resets the cursor after replay progress', () => {
        const player = makePlayer();
        expect(player.step()?.tick).toBe(1);
        expect(player.step()?.tick).toBe(2);

        const reset = player.initialize();

        expect(reset.tick).toBe(0);
        expect(player.step()?.tick).toBe(1);
    });

    it('uses an injected factory for concrete game snapshot fields', () => {
        const player = new ReplayPlayer(
            makeReplayFile({ actions: [] }),
            makeRequiredPipeline(),
            makeRequiredInitialSnapshot,
            noopLogger,
        );

        const snapshot = player.initialize();

        expect(snapshot.requiredState.ready).toBe(true);
    });

    it('stores replay config maps in null-prototype dictionaries', () => {
        const pollutingPlayerId = toPlayerId('__proto__');
        const pollutingEntityId = toEntityId('__proto__');
        const initialEntities: unknown = JSON.parse(
            '{"__proto__":{"id":"__proto__","kind":"trap"}}',
        );
        const snapshot = createBaseReplayInitialSnapshot(
            makeReplayFile({
                actions: [],
                gameConfig: {
                    playerIds: [pollutingPlayerId],
                    initialEntities,
                },
            }),
        );

        expect(Object.getPrototypeOf(snapshot.players)).toBeNull();
        expect(Object.getPrototypeOf(snapshot.entities)).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(snapshot.players, '__proto__')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(snapshot.entities, '__proto__')).toBe(true);
        expect(snapshot.players[pollutingPlayerId]?.id).toBe(pollutingPlayerId);
        expect(snapshot.entities[pollutingEntityId]?.id).toBe(pollutingEntityId);
    });
});

describe('ReplayPlayer.step', () => {
    it('applies the next recorded action through the injected ActionPipeline', () => {
        const player = makePlayer();
        player.initialize();

        const first = player.step();
        const second = player.step();

        expect(first).toMatchObject({ tick: 1, total: 2 });
        expect(second).toMatchObject({ tick: 2, total: 5 });
    });

    it('returns null after the final recorded action is applied', () => {
        const player = makePlayer();

        expect(player.step()).not.toBeNull();
        expect(player.step()).not.toBeNull();
        expect(player.step()).not.toBeNull();

        expect(player.step()).toBeNull();
    });

    it('throws DeterminismError when a replayed action does not advance exactly one tick', () => {
        const { logger, warnings } = makeCapturingLogger();
        const player = makePlayerWithDefinition(
            stalledDefinition,
            makeReplayFile({
                actions: [
                    {
                        tick: 0,
                        playerId: P1,
                        action: { type: 'test:stall', playerId: P1, tick: 0, payload: {} },
                    },
                ],
            }),
            logger,
        );

        expect(() => player.step()).toThrowError(DeterminismError);
        expect(warnings).toContain('replay determinism error');
    });

    it('throws ReplayEnvelopeMismatchError when the recorded tick differs from the envelope tick', () => {
        const player = makePlayer(
            makeReplayFile({
                actions: [
                    {
                        tick: 0,
                        playerId: P1,
                        action: { type: 'test:add', playerId: P1, tick: 1, payload: { amount: 2 } },
                    },
                ],
            }),
        );
        let thrown: unknown;

        try {
            player.step();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ReplayEnvelopeMismatchError);
        expect(thrown).toMatchObject({
            code: 'REPLAY_ENVELOPE_MISMATCH',
            field: 'tick',
            recordedValue: 0,
            envelopeValue: 1,
        });
    });

    it('throws ReplayEnvelopeMismatchError when the recorded player differs from the envelope player', () => {
        const player = makePlayer(
            makeReplayFile({
                actions: [
                    {
                        tick: 0,
                        playerId: P1,
                        action: { type: 'test:add', playerId: P2, tick: 0, payload: { amount: 2 } },
                    },
                ],
            }),
        );
        let thrown: unknown;

        try {
            player.step();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ReplayEnvelopeMismatchError);
        expect(thrown).toMatchObject({
            code: 'REPLAY_ENVELOPE_MISMATCH',
            field: 'playerId',
            recordedValue: P1,
            envelopeValue: P2,
        });
    });
});

describe('ReplayPlayer.seek', () => {
    it('returns the snapshot at a mid-replay tick', () => {
        const player = makePlayer();

        const snapshot = player.seek(2);

        expect(snapshot).toMatchObject({ tick: 2, total: 5 });
        expect(player.step()).toMatchObject({ tick: 3, total: 10 });
    });

    it('throws ReplaySeekError when the requested tick is outside the replay', () => {
        const player = makePlayer();

        expect(() => player.seek(4)).toThrowError(ReplaySeekError);
        expect(() => player.seek(-1)).toThrowError(ReplaySeekError);
    });
});

describe('ReplayPlayer.play', () => {
    it('replays all recorded actions through the callback API', () => {
        const player = makePlayer();
        const frames: number[] = [];

        const stop = player.play(1, (snapshot) => {
            frames.push(snapshot.tick);
        });

        expect(frames).toEqual([1, 2, 3]);
        expect(player.step()).toBeNull();
        expect(stop()).toBeUndefined();
    });

    it('stops replay when the frame callback invokes the stop handle', () => {
        const player = makePlayer();
        const frames: number[] = [];

        const stop = player.play(1, (snapshot, stopPlayback) => {
            frames.push(snapshot.tick);
            if (snapshot.tick === 2) {
                stopPlayback();
            }
        });

        expect(frames).toEqual([1, 2]);
        expect(player.step()).toMatchObject({ tick: 3, total: 10 });
        expect(stop()).toBeUndefined();
    });

    it('replays all recorded actions synchronously and returns the final snapshot', () => {
        const player = makePlayer();

        const finalSnapshot = player.playSync();

        expect(finalSnapshot).toMatchObject({ tick: 3, total: 10 });
    });

    it('returns the initialized snapshot when the replay has no actions', () => {
        const player = makePlayer(makeReplayFile({ actions: [] }));

        const finalSnapshot = player.playSync();

        expect(finalSnapshot).toMatchObject({ tick: 0 });
        expect(finalSnapshot.total).toBeUndefined();
    });
});

describe('assertReplayDeterministic', () => {
    it('returns the final snapshot when two independent players produce identical output', () => {
        const file = makeReplayFile();

        const finalSnapshot = assertReplayDeterministic(makePlayer(file), makePlayer(file));

        expect(finalSnapshot).toMatchObject({ tick: 3, total: 10 });
    });

    it('throws DeterminismError at the first divergent tick', () => {
        const first = makePlayer(makeReplayFile());
        const second = makePlayer(
            makeReplayFile({
                actions: [
                    {
                        tick: 0,
                        playerId: P1,
                        action: {
                            type: 'test:add',
                            playerId: P1,
                            tick: 0,
                            payload: { amount: 99 },
                        },
                    },
                    {
                        tick: 1,
                        playerId: P2,
                        action: { type: 'test:add', playerId: P2, tick: 1, payload: { amount: 3 } },
                    },
                    {
                        tick: 2,
                        playerId: P1,
                        action: { type: 'test:add', playerId: P1, tick: 2, payload: { amount: 5 } },
                    },
                ],
            }),
        );

        expect(() => assertReplayDeterministic(first, second)).toThrowError(/diverged at tick 1/u);
    });

    it('throws DeterminismError when snapshots diverge by key count', () => {
        const file = makeSingleActionReplayFile('test:shape');
        const leftDefinition = makeStructuralDefinition('test:shape', (state) => ({
            ...state,
            tick: state.tick + 1,
            leftOnly: true,
        }));
        const stableDefinition = makeStructuralDefinition('test:shape', (state) => ({
            ...state,
            tick: state.tick + 1,
        }));

        expect(() =>
            assertReplayDeterministic(
                makeStructuralPlayer(leftDefinition, file),
                makeStructuralPlayer(stableDefinition, file),
            ),
        ).toThrowError(/diverged at tick 1/u);
    });

    it('throws DeterminismError when snapshots diverge by key presence', () => {
        const file = makeSingleActionReplayFile('test:shape');
        const leftDefinition = makeStructuralDefinition('test:shape', (state) => ({
            ...state,
            tick: state.tick + 1,
            leftOnly: true,
        }));
        const rightDefinition = makeStructuralDefinition('test:shape', (state) => ({
            ...state,
            tick: state.tick + 1,
            rightOnly: true,
        }));

        expect(() =>
            assertReplayDeterministic(
                makeStructuralPlayer(leftDefinition, file),
                makeStructuralPlayer(rightDefinition, file),
            ),
        ).toThrowError(/diverged at tick 1/u);
    });

    it('throws DeterminismError when snapshot arrays diverge by length', () => {
        const file = makeSingleActionReplayFile('test:tags');
        const shortDefinition = makeStructuralDefinition('test:tags', (state) => ({
            ...state,
            tick: state.tick + 1,
            tags: ['alpha'],
        }));
        const longDefinition = makeStructuralDefinition('test:tags', (state) => ({
            ...state,
            tick: state.tick + 1,
            tags: ['alpha', 'beta'],
        }));

        expect(() =>
            assertReplayDeterministic(
                makeStructuralPlayer(shortDefinition, file),
                makeStructuralPlayer(longDefinition, file),
            ),
        ).toThrowError(/diverged at tick 1/u);
    });

    it('throws DeterminismError when snapshot arrays diverge by value', () => {
        const file = makeSingleActionReplayFile('test:tags');
        const alphaDefinition = makeStructuralDefinition('test:tags', (state) => ({
            ...state,
            tick: state.tick + 1,
            tags: ['alpha'],
        }));
        const betaDefinition = makeStructuralDefinition('test:tags', (state) => ({
            ...state,
            tick: state.tick + 1,
            tags: ['beta'],
        }));

        expect(() =>
            assertReplayDeterministic(
                makeStructuralPlayer(alphaDefinition, file),
                makeStructuralPlayer(betaDefinition, file),
            ),
        ).toThrowError(/diverged at tick 1/u);
    });

    it('throws DeterminismError when snapshot fields diverge by primitive type', () => {
        const file = makeSingleActionReplayFile('test:marker');
        const nullDefinition = makeStructuralDefinition('test:marker', (state) => ({
            ...state,
            tick: state.tick + 1,
            marker: null,
        }));
        const stringDefinition = makeStructuralDefinition('test:marker', (state) => ({
            ...state,
            tick: state.tick + 1,
            marker: 'ready',
        }));

        expect(() =>
            assertReplayDeterministic(
                makeStructuralPlayer(nullDefinition, file),
                makeStructuralPlayer(stringDefinition, file),
            ),
        ).toThrowError(/diverged at tick 1/u);
    });
});
