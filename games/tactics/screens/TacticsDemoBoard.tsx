'use client';

import React, { useState } from 'react';
import type { GameScreenProps } from '@chimera/renderer/components/shell/MatchShell.js';
import { TACTICS_MOVE_UNIT_ACTION } from '@chimera/shared/tactics.js';

interface TacticsUnit {
    readonly id: string;
    readonly kind: 'unit';
    readonly ownerId: string;
    readonly x: number;
    readonly y: number;
}

/**
 * Type guard to safely narrow an entity to a tactics unit.
 * Checks that the entity is an object with kind='unit' and required fields.
 */
function isTacticsUnit(entity: unknown): entity is TacticsUnit {
    if (typeof entity !== 'object' || entity === null) {
        return false;
    }
    const obj = entity as Record<string, unknown>;
    return (
        obj['kind'] === 'unit' &&
        typeof obj['id'] === 'string' &&
        typeof obj['ownerId'] === 'string' &&
        typeof obj['x'] === 'number' &&
        typeof obj['y'] === 'number'
    );
}

export function TacticsDemoBoard({
    snapshot,
    localPlayerId,
    sendAction,
}: GameScreenProps): React.ReactElement | null {
    const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

    // Find the unit owned by the local player
    const demoUnit = Object.values(snapshot.entities)
        .map((entity) => entity as unknown as TacticsUnit)
        .filter(isTacticsUnit)
        .find((unit) => unit.ownerId === localPlayerId);

    if (demoUnit === undefined) {
        return null;
    }

    const canUseControls = localPlayerId !== undefined;
    const canMove = canUseControls && selectedUnitId === demoUnit.id;

    return (
        <div aria-label="Tactics board">
            <button
                data-testid="selectable-unit"
                type="button"
                disabled={!canUseControls}
                onClick={() => setSelectedUnitId(demoUnit.id)}
            >
                Unit
            </button>
            <button
                data-testid="move-target"
                type="button"
                disabled={!canMove}
                onClick={() => {
                    if (localPlayerId === undefined) {
                        return;
                    }
                    sendAction({
                        type: TACTICS_MOVE_UNIT_ACTION,
                        playerId: localPlayerId,
                        tick: snapshot.tick,
                        payload: {
                            unitId: demoUnit.id,
                            x: demoUnit.x + 1,
                            y: demoUnit.y,
                        },
                    });
                    setSelectedUnitId(null);
                }}
            >
                Move
            </button>
        </div>
    );
}

export default TacticsDemoBoard;
