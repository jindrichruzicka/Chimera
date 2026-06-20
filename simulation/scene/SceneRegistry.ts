import type { AssetRef } from '../content/AssetRef.js';
import type { BaseGameSnapshot, GameReduceContext, SceneId } from '../engine/types.js';
import { sceneId } from '../engine/types.js';

export { sceneId };
export type { SceneId };

export type SceneEnterParams = Readonly<Record<string, unknown>>;
export type SceneClientTimeoutPolicy = 'proceed' | 'drop';

export const DEFAULT_SCENE_TRANSITION_TIMEOUT_TICKS = 1_800;
export const DEFAULT_SCENE_CLIENT_TIMEOUT_POLICY: SceneClientTimeoutPolicy = 'proceed';

export interface SceneDescriptor<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly sceneId: SceneId;
    readonly defaultScreen: string;
    readonly requiredAssets: readonly AssetRef[];
    readonly timeoutTicks?: number;
    readonly onClientTimeout?: SceneClientTimeoutPolicy;
    initialize(state: Readonly<TState>, params: SceneEnterParams, ctx: GameReduceContext): TState;
    teardown?(state: Readonly<TState>, ctx: GameReduceContext): TState;
}

export class DuplicateSceneRegistrationError extends Error {
    readonly code = 'DUPLICATE_SCENE_REGISTRATION' as const;
    readonly sceneId: SceneId;

    constructor(registeredSceneId: SceneId) {
        super(
            `DuplicateSceneRegistrationError: scene "${registeredSceneId}" is already registered.`,
        );
        this.name = 'DuplicateSceneRegistrationError';
        this.sceneId = registeredSceneId;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class UnknownSceneError extends Error {
    readonly code = 'UNKNOWN_SCENE' as const;
    readonly sceneId: SceneId;

    constructor(missingSceneId: SceneId) {
        super(`UnknownSceneError: no SceneDescriptor is registered for scene "${missingSceneId}".`);
        this.name = 'UnknownSceneError';
        this.sceneId = missingSceneId;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class SceneRegistry<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #descriptors = new Map<SceneId, SceneDescriptor<TState>>();

    register(descriptor: SceneDescriptor<TState>): void {
        if (this.#descriptors.has(descriptor.sceneId)) {
            throw new DuplicateSceneRegistrationError(descriptor.sceneId);
        }
        this.#descriptors.set(descriptor.sceneId, descriptor);
    }

    resolve(sceneIdToResolve: SceneId): SceneDescriptor<TState> {
        const descriptor = this.#descriptors.get(sceneIdToResolve);
        if (descriptor === undefined) {
            throw new UnknownSceneError(sceneIdToResolve);
        }
        return descriptor;
    }

    maybeResolve(sceneIdToResolve: SceneId | undefined): SceneDescriptor<TState> | undefined {
        return sceneIdToResolve === undefined ? undefined : this.#descriptors.get(sceneIdToResolve);
    }

    has(sceneIdToCheck: SceneId): boolean {
        return this.#descriptors.has(sceneIdToCheck);
    }

    requiredAssets(sceneIdToResolve: SceneId): readonly AssetRef[] {
        return this.resolve(sceneIdToResolve).requiredAssets;
    }

    registeredSceneIds(): readonly SceneId[] {
        return Array.from(this.#descriptors.keys());
    }
}
