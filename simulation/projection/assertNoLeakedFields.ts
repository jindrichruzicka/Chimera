import type { PlayerId } from '../engine/types.js';

import type { PlayerSnapshot } from './StateProjector.js';
import type { VisibilityScope } from './types.js';

interface FieldScanContext {
    readonly ownerId: PlayerId | undefined;
    readonly path: readonly string[];
}

export class ObfuscationAssertionError extends Error {
    readonly fieldName: string;
    readonly viewerId: PlayerId;

    constructor(fieldName: string, viewerId: PlayerId, reason: string) {
        super(`PlayerSnapshot for viewer ${viewerId} leaked ${reason} field "${fieldName}".`);
        this.name = 'ObfuscationAssertionError';
        this.fieldName = fieldName;
        this.viewerId = viewerId;
    }
}

/**
 * Checks a projected snapshot for diagnostic visibility markers that survived masking.
 * Owner-only markers are allowed only inside the viewer's own player/entity context;
 * hidden markers are never allowed in a `PlayerSnapshot`.
 */
export function assertNoLeakedFields(
    snapshot: PlayerSnapshot,
    viewerId: PlayerId,
    allPlayerIds: readonly PlayerId[],
): void {
    const visited = new WeakSet<object>();
    const rootFields = Object.entries(snapshot).filter(
        ([fieldName]) => fieldName !== 'players' && fieldName !== 'entities',
    );
    const scan = (value: unknown, context: FieldScanContext): void => {
        if (!isRecord(value)) {
            return;
        }

        if (visited.has(value)) {
            return;
        }
        visited.add(value);

        const visibility = readVisibilityScope(value);
        if (visibility === 'hidden') {
            throw new ObfuscationAssertionError(formatPath(context.path), viewerId, 'hidden');
        }
        if (visibility === 'owner-only' && context.ownerId !== viewerId) {
            throw new ObfuscationAssertionError(formatPath(context.path), viewerId, 'owner-only');
        }

        const ownerId = context.ownerId ?? readOwnerId(value, allPlayerIds);
        for (const [fieldName, child] of Object.entries(value)) {
            scan(child, {
                ownerId,
                path: [...context.path, fieldName],
            });
        }
    };

    for (const [rawPlayerId, playerState] of Object.entries(snapshot.players)) {
        scan(playerState, {
            ownerId: findPlayerId(rawPlayerId, allPlayerIds),
            path: ['players', rawPlayerId],
        });
    }

    for (const [rawEntityId, entityState] of Object.entries(snapshot.entities)) {
        scan(entityState, {
            ownerId: readOwnerId(entityState, allPlayerIds),
            path: ['entities', rawEntityId],
        });
    }

    for (const [fieldName, value] of rootFields) {
        scan(value, { ownerId: undefined, path: [fieldName] });
    }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function readVisibilityScope(
    value: Readonly<Record<string, unknown>>,
): VisibilityScope | undefined {
    const visibility = value['__visibility'];
    if (
        visibility === 'public' ||
        visibility === 'owner-only' ||
        visibility === 'hidden' ||
        visibility === 'committed'
    ) {
        return visibility;
    }

    return undefined;
}

function readOwnerId(
    value: Readonly<Record<string, unknown>>,
    allPlayerIds: readonly PlayerId[],
): PlayerId | undefined {
    const ownerId = value['ownerId'];
    return typeof ownerId === 'string' ? findPlayerId(ownerId, allPlayerIds) : undefined;
}

function findPlayerId(
    rawPlayerId: string,
    allPlayerIds: readonly PlayerId[],
): PlayerId | undefined {
    return allPlayerIds.find((candidate) => candidate === rawPlayerId);
}

function formatPath(path: readonly string[]): string {
    return path.join('.');
}
