'use client';

import React, { useState } from 'react';
import type { GameScreenProps } from '@chimera/renderer/components/shell/MatchShell.js';
import { TACTICS_ATTACK_ACTION, TACTICS_MOVE_UNIT_ACTION } from '@chimera/shared/tactics.js';

interface TacticsUnit {
    readonly id: string;
    readonly kind: 'unit';
    readonly ownerId: string;
    readonly x: number;
    readonly y: number;
    readonly hp: number;
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
        typeof obj['y'] === 'number' &&
        typeof obj['hp'] === 'number'
    );
}

function areAdjacent(first: TacticsUnit, second: TacticsUnit): boolean {
    const dx = Math.abs(first.x - second.x);
    const dy = Math.abs(first.y - second.y);
    return dx + dy === 1;
}

export function TacticsDemoBoard({
    snapshot,
    localPlayerId,
    sendAction,
}: GameScreenProps): React.ReactElement | null {
    const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

    const units = Object.values(snapshot.entities)
        .map((entity) => entity as unknown as TacticsUnit)
        .filter(isTacticsUnit);

    // Find the unit owned by the local player
    const demoUnit = units.find((unit) => unit.ownerId === localPlayerId);

    if (demoUnit === undefined) {
        return null;
    }

    const canUseControls = localPlayerId !== undefined;
    const canMove = canUseControls && selectedUnitId === demoUnit.id;
    const selectedUnit = units.find((unit) => unit.id === selectedUnitId);
    const attackTarget =
        canUseControls && selectedUnit !== undefined
            ? units.find(
                  (unit) =>
                      unit.ownerId !== localPlayerId &&
                      unit.hp > 0 &&
                      areAdjacent(selectedUnit, unit),
              )
            : undefined;

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
            {attackTarget !== undefined && (
                <button
                    data-testid="attack-target"
                    type="button"
                    onClick={() => {
                        if (localPlayerId === undefined || selectedUnit === undefined) {
                            return;
                        }
                        sendAction({
                            type: TACTICS_ATTACK_ACTION,
                            playerId: localPlayerId,
                            tick: snapshot.tick,
                            payload: {
                                attackerId: selectedUnit.id,
                                defenderId: attackTarget.id,
                            },
                        });
                        setSelectedUnitId(null);
                    }}
                >
                    Attack
                </button>
            )}
        </div>
    );
}

export default TacticsDemoBoard;
