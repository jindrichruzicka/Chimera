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
const SCENE_EXPIRE_TYPE = 'engine:scene_expire' as const;

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
        registry.registerEngineAction(this.#createSceneExpireDefinition());
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
            // Through the accessor, not off `descriptor` — this is the one
            // production call to it, which is what
            // `__tests__/required-assets-accessor.test.ts` pins. Simplifying it
            // to the field read is behaviour-identical and reds there.
            const requiredAssets = this.#registry.requiredAssets(payload.toSceneId);
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
                    // Always written, unlike `requiredAssets` below: every
                    // descriptor declares a `defaultScreen`, so there is no
                    // "declares none" case to omit for. It is what lets a client
                    // resolve the ENTERING scene's loading cover — the committed
                    // scene's key travels on `sceneDefaultScreen` instead, and
                    // until commit the renderer has no other source for it.
                    defaultScreen: descriptor.defaultScreen,
                    // Omitted when the scene declares none, so a transition
                    // into a scene that needs nothing keeps the shape it had
                    // before this field existed.
                    ...(requiredAssets.length === 0 ? {} : { requiredAssets }),
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
                // A match already resolved stays resolved across the commit.
                // `initialize`/`teardown` may return any state and this spread
                // takes it wholesale, so a descriptor that blanked the recorded
                // result would rewrite it — the resolver re-runs wherever
                // `gameResult` is null, and gameplay would flow again into a
                // match the pipeline calls finished. Re-pinned only when a
                // result was ALREADY recorded, so a scene that ENDS a match on
                // entry still can.
                //
                // `gameResult` alone, not `phase`: it is what the terminal gate
                // and the resolver both key on, and a scene entered after a
                // result has a legitimate reason to write its own phase.
                ...(state.gameResult === null ? {} : { gameResult: state.gameResult }),
                tick: state.tick + 1,
                sceneId: transition.toSceneId,
                sceneDefaultScreen: nextDescriptor.defaultScreen,
                // Unconditional, empty array included: `initialize` spreads the
                // prior state, so omitting the write when the entered scene
                // declares nothing would leave the previous scene's refs on it.
                sceneRequiredAssets: nextDescriptor.requiredAssets,
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

    /**
     * The host declaring its own budget for the pending transition elapsed.
     *
     * The barrier waits on an ack from every seat in `state.players`, and
     * `engine:scene_ready` is produced only inside a mounted `SceneRouter` — so
     * a seat with no renderer (an AI seat; a disconnect mid-transition) never
     * acks. `timeoutTicks` cannot cover for it, because a tick advances only
     * when an action is applied and a turn-based match applies none while the
     * transition is pending.
     *
     * So the wait is measured where a clock is allowed to exist — the host
     * runtime — and its outcome enters the simulation as an action like any
     * other. This one does NOT decide what the expiry means: it sets a flag
     * that `isTransitionTimedOut` reads, and the descriptor's own
     * `onClientTimeout` still chooses between committing and dropping, exactly
     * as it does when the tick budget elapses on its own.
     *
     * Carries no payload, for the reason `engine:scene_ready` carries only
     * `{ playerId }`: nothing about any client's load may enter authoritative
     * state.
     */
    readonly #createSceneExpireDefinition = (): ActionDefinition<SceneCommitPayload, TState> => ({
        type: SCENE_EXPIRE_TYPE,

        parsePayload(raw): SceneCommitPayload {
            if (Object.keys(raw).length > 0) {
                throw new TypeError(
                    'engine:scene_expire payload must be an empty object; ' +
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
            if (transition.expired === true) {
                return { ok: false, reason: 'already_expired' };
            }
            return { ok: true };
        },

        reduce(state): TState {
            const transition = state.sceneTransition;
            if (transition === undefined || transition === null) {
                return state;
            }
            return {
                ...state,
                tick: state.tick + 1,
                // Only the flag: the acks already collected stand, and the
                // phase is left to the commit or drop this unblocks.
                sceneTransition: { ...transition, expired: true },
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

/**
 * Whether the transition's wait is over — by either of the two budgets.
 *
 * `timeoutTicks` is the simulation's own, and it can be unreachable: a tick
 * advances only when an action is applied, so a barrier waiting on a seat that
 * cannot ack never closes the gap. `expired` is the host's, set through
 * `engine:scene_expire` once its wall clock has run out. Both feed the same
 * `onClientTimeout` branch, so an expiry means whatever the descriptor already
 * said a timeout means.
 */
export function isTransitionTimedOut(
    state: Readonly<BaseGameSnapshot>,
    transition: Readonly<SceneTransitionState>,
): boolean {
    if (transition.expired === true) {
        return true;
    }
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
