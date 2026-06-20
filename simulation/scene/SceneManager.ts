import type { ActionRegistry } from '../engine/ActionRegistry.js';
import type {
    ActionDefinition,
    BaseGameSnapshot,
    GameReduceContext,
    PlayerId,
    SceneId,
    SceneTransitionState,
    ValidationResult,
} from '../engine/types.js';
import { playerId, sceneId } from '../engine/types.js';
import {
    DEFAULT_SCENE_CLIENT_TIMEOUT_POLICY,
    DEFAULT_SCENE_TRANSITION_TIMEOUT_TICKS,
    type SceneEnterParams,
    type SceneRegistry,
} from './SceneRegistry.js';

export interface ScenePreparePayload {
    readonly toSceneId: SceneId;
    readonly params: SceneEnterParams;
}

export interface SceneReadyPayload {
    readonly playerId: PlayerId;
}

export type SceneCommitPayload = Record<string, never>;

const SCENE_PREPARE_TYPE = 'engine:scene_prepare' as const;
const SCENE_READY_TYPE = 'engine:scene_ready' as const;
const SCENE_COMMIT_TYPE = 'engine:scene_commit' as const;
const SCENE_DROP_TYPE = 'engine:scene_drop' as const;

export class SceneManager<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #registry: SceneRegistry<TState>;

    constructor(registry: SceneRegistry<TState>) {
        this.#registry = registry;
    }

    registerActions(registry: ActionRegistry<TState>): void {
        registry.registerEngineAction(this.#createScenePrepareDefinition());
        registry.registerEngineAction(this.#createSceneReadyDefinition());
        registry.registerEngineAction(this.#createSceneCommitDefinition());
        registry.registerEngineAction(this.#createSceneDropDefinition());
    }

    requestTransition(toSceneId: SceneId, params: SceneEnterParams = {}): ScenePreparePayload {
        this.#registry.resolve(toSceneId);
        return { toSceneId, params };
    }

    readonly #createScenePrepareDefinition = (): ActionDefinition<ScenePreparePayload, TState> => ({
        type: SCENE_PREPARE_TYPE,

        parsePayload(raw): ScenePreparePayload {
            const rawToSceneId = raw['toSceneId'];
            if (typeof rawToSceneId !== 'string' || rawToSceneId.length === 0) {
                throw new TypeError(
                    'engine:scene_prepare payload must have a non-empty string "toSceneId" field; ' +
                        `received ${JSON.stringify(raw)}.`,
                );
            }
            return {
                toSceneId: sceneId(rawToSceneId),
                params: parseParams(raw['params']),
            };
        },

        validate: (payload, state, dispatcherId): ValidationResult => {
            if (!isHost(state, dispatcherId)) {
                return { ok: false, reason: 'host_only' };
            }
            if (state.sceneTransition !== undefined && state.sceneTransition !== null) {
                return { ok: false, reason: 'transition_in_progress' };
            }
            if (!this.#registry.has(payload.toSceneId)) {
                return { ok: false, reason: 'unknown_scene' };
            }
            return { ok: true };
        },

        reduce: (state, payload): TState => {
            const descriptor = this.#registry.resolve(payload.toSceneId);
            return {
                ...state,
                tick: state.tick + 1,
                sceneTransition: {
                    toSceneId: payload.toSceneId,
                    phase: 'preparing',
                    startedAtTick: state.tick,
                    params: payload.params,
                    playersReady: [],
                    timeoutTicks: descriptor.timeoutTicks ?? DEFAULT_SCENE_TRANSITION_TIMEOUT_TICKS,
                    onClientTimeout:
                        descriptor.onClientTimeout ?? DEFAULT_SCENE_CLIENT_TIMEOUT_POLICY,
                },
            };
        },
    });

    readonly #createSceneReadyDefinition = (): ActionDefinition<SceneReadyPayload, TState> => ({
        type: SCENE_READY_TYPE,

        parsePayload(raw): SceneReadyPayload {
            const rawPlayerId = raw['playerId'];
            if (typeof rawPlayerId !== 'string' || rawPlayerId.length === 0) {
                throw new TypeError(
                    'engine:scene_ready payload must have a non-empty string "playerId" field; ' +
                        `received ${JSON.stringify(raw)}.`,
                );
            }
            return { playerId: playerId(rawPlayerId) };
        },

        validate(payload, state, dispatcherId): ValidationResult {
            const transition = state.sceneTransition;
            if (transition === undefined || transition === null) {
                return { ok: false, reason: 'no_transition' };
            }
            if (payload.playerId !== dispatcherId) {
                return { ok: false, reason: 'player_mismatch' };
            }
            if (!(payload.playerId in state.players)) {
                return { ok: false, reason: 'unknown_player' };
            }
            if (transition.playersReady.includes(payload.playerId)) {
                return { ok: false, reason: 'already_ready' };
            }
            return { ok: true };
        },

        reduce(state, payload): TState {
            const transition = state.sceneTransition;
            if (transition === undefined || transition === null) {
                return state;
            }

            const playersReady = [...transition.playersReady, payload.playerId];
            return {
                ...state,
                tick: state.tick + 1,
                sceneTransition: {
                    ...transition,
                    phase: areAllPlayersReady(state, playersReady) ? 'ready' : 'preparing',
                    playersReady,
                },
            };
        },
    });

    readonly #createSceneCommitDefinition = (): ActionDefinition<SceneCommitPayload, TState> => ({
        type: SCENE_COMMIT_TYPE,

        parsePayload(raw): SceneCommitPayload {
            if (Object.keys(raw).length > 0) {
                throw new TypeError(
                    'engine:scene_commit payload must be an empty object; ' +
                        `received ${JSON.stringify(raw)}.`,
                );
            }
            return {};
        },

        validate: (_payload, state, dispatcherId): ValidationResult => {
            if (!isHost(state, dispatcherId)) {
                return { ok: false, reason: 'host_only' };
            }
            const transition = state.sceneTransition;
            if (transition === undefined || transition === null) {
                return { ok: false, reason: 'no_transition' };
            }
            const allPlayersReady = areAllPlayersReady(state, transition.playersReady);
            if (!allPlayersReady) {
                if (!isTransitionTimedOut(state, transition)) {
                    return { ok: false, reason: 'players_not_ready' };
                }
                const onClientTimeout =
                    transition.onClientTimeout ?? DEFAULT_SCENE_CLIENT_TIMEOUT_POLICY;
                if (onClientTimeout === 'drop') {
                    return { ok: false, reason: 'transition_timed_out_drop' };
                }
            }
            if (!this.#registry.has(transition.toSceneId)) {
                return { ok: false, reason: 'unknown_scene' };
            }
            return { ok: true };
        },

        reduce: (state, _payload, _playerId, ctx): TState => {
            const transition = state.sceneTransition;
            if (transition === undefined || transition === null) {
                return state;
            }

            const frozenContext = freezeDescriptorContext(ctx);
            const committingState = {
                ...state,
                tick: state.tick + 1,
                sceneTransition: {
                    ...transition,
                    phase: 'committing',
                } satisfies SceneTransitionState,
            };
            const currentDescriptor = this.#registry.maybeResolve(state.sceneId);
            const afterTeardown =
                currentDescriptor?.teardown?.(committingState, frozenContext) ?? committingState;
            const nextDescriptor = this.#registry.resolve(transition.toSceneId);
            const initialized = nextDescriptor.initialize(
                afterTeardown,
                transition.params,
                frozenContext,
            );

            return {
                ...initialized,
                tick: state.tick + 1,
                sceneId: transition.toSceneId,
                sceneDefaultScreen: nextDescriptor.defaultScreen,
                sceneTransition: null,
            };
        },
    });

    readonly #createSceneDropDefinition = (): ActionDefinition<SceneCommitPayload, TState> => ({
        type: SCENE_DROP_TYPE,

        parsePayload(raw): SceneCommitPayload {
            if (Object.keys(raw).length > 0) {
                throw new TypeError(
                    'engine:scene_drop payload must be an empty object; ' +
                        `received ${JSON.stringify(raw)}.`,
                );
            }
            return {};
        },

        validate: (_payload, state, dispatcherId): ValidationResult => {
            if (!isHost(state, dispatcherId)) {
                return { ok: false, reason: 'host_only' };
            }
            const transition = state.sceneTransition;
            if (transition === undefined || transition === null) {
                return { ok: false, reason: 'no_transition' };
            }
            if (!isTransitionTimedOut(state, transition)) {
                return { ok: false, reason: 'transition_not_timed_out' };
            }
            if ((transition.onClientTimeout ?? DEFAULT_SCENE_CLIENT_TIMEOUT_POLICY) !== 'drop') {
                return { ok: false, reason: 'timeout_policy_not_drop' };
            }
            return { ok: true };
        },

        reduce(state): TState {
            return {
                ...state,
                tick: state.tick + 1,
                sceneTransition: null,
            };
        },
    });
}

function parseParams(raw: unknown): SceneEnterParams {
    if (raw === undefined) {
        return {};
    }
    if (!isRecord(raw)) {
        throw new TypeError(
            'engine:scene_prepare payload "params" must be an object when present; ' +
                `received ${JSON.stringify(raw)}.`,
        );
    }

    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!isUnsafeObjectKey(key)) {
            params[key] = value;
        }
    }
    return params;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnsafeObjectKey(key: string): boolean {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function isHost(state: Readonly<BaseGameSnapshot>, dispatcherId: PlayerId): boolean {
    return state.hostPlayerId !== undefined && dispatcherId === state.hostPlayerId;
}

function areAllPlayersReady(
    state: Readonly<BaseGameSnapshot>,
    playersReady: readonly PlayerId[],
): boolean {
    const readySet = new Set<PlayerId>(playersReady);
    return Object.keys(state.players).every((rawPlayerId) => readySet.has(playerId(rawPlayerId)));
}

function isTransitionTimedOut(
    state: Readonly<BaseGameSnapshot>,
    transition: Readonly<SceneTransitionState>,
): boolean {
    const timeoutTicks = Math.max(
        0,
        transition.timeoutTicks ?? DEFAULT_SCENE_TRANSITION_TIMEOUT_TICKS,
    );
    return state.tick - transition.startedAtTick >= timeoutTicks;
}

function freezeDescriptorContext(ctx: GameReduceContext): GameReduceContext {
    const frozenContext: GameReduceContext = {
        rng: ctx.rng,
        dispatchDepth: ctx.dispatchDepth,
        ...(ctx.db !== undefined ? { db: ctx.db } : {}),
        ...(ctx.undoManager !== undefined ? { undoManager: ctx.undoManager } : {}),
    };
    return Object.freeze(frozenContext);
}
