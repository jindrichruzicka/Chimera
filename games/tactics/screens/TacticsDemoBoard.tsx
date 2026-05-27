'use client';

import React, { useState } from 'react';
import type { GameScreenProps } from '@chimera/shared/game-screen-contract.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/shared/tactics.js';
import {
    parseTacticsSceneUnits,
    resolveTacticsSelectionIntent,
    type TacticsGridPoint,
    type TacticsSceneUnit,
    type TacticsSelectionIntent,
} from './tacticsSceneModel.js';

export function TacticsDemoBoard({
    snapshot,
    localPlayerId,
    sendAction,
}: GameScreenProps): React.ReactElement | null {
    const [selectedUnitId, setSelectedUnitId] = useState<TacticsSceneUnit['id'] | null>(null);

    const units = parseTacticsSceneUnits(snapshot.entities, localPlayerId);
    const demoUnit = units.find((unit) => unit.ownership === 'own');

    if (demoUnit === undefined) {
        return null;
    }

    const canUseControls = localPlayerId !== undefined;
    const selectedUnit = units.find((unit) => unit.id === selectedUnitId);
    const canMove = canUseControls && selectedUnit?.ownership === 'own';
    const canReveal = canMove;
    const nextGrid = { x: demoUnit.grid.x + 1, y: demoUnit.grid.y } satisfies TacticsGridPoint;
    const attackTarget =
        canUseControls && selectedUnit !== undefined
            ? units.find(
                  (unit) =>
                      unit.ownership === 'opponent' &&
                      unit.isAlive &&
                      resolveTacticsSelectionIntent({
                          units,
                          localPlayerId,
                          selectedUnitId,
                          target: { type: 'unit', unitId: unit.id },
                      }).type === 'attack-unit',
              )
            : undefined;

    const handleIntent = (intent: TacticsSelectionIntent): void => {
        if (intent.type === 'select-own-unit' || intent.type === 'select-opponent-unit') {
            setSelectedUnitId(intent.unitId);
            return;
        }
        if (localPlayerId === undefined) {
            return;
        }
        if (intent.type === 'move-unit') {
            sendAction({
                type: TACTICS_MOVE_UNIT_ACTION,
                playerId: localPlayerId,
                tick: snapshot.tick,
                payload: {
                    unitId: intent.unitId,
                    x: intent.grid.x,
                    y: intent.grid.y,
                },
            });
            setSelectedUnitId(null);
            return;
        }
        if (intent.type === 'attack-unit') {
            sendAction({
                type: TACTICS_ATTACK_ACTION,
                playerId: localPlayerId,
                tick: snapshot.tick,
                payload: {
                    attackerId: intent.attackerId,
                    defenderId: intent.defenderId,
                },
            });
            setSelectedUnitId(null);
            return;
        }
        if (intent.type === 'reveal-tile') {
            sendAction({
                type: TACTICS_REVEAL_TILE_ACTION,
                playerId: localPlayerId,
                tick: snapshot.tick,
                payload: {
                    scoutId: intent.scoutId,
                    x: intent.grid.x,
                    y: intent.grid.y,
                },
            });
            setSelectedUnitId(null);
        }
    };

    return (
        <div aria-label="Tactics board">
            <button
                data-testid="selectable-unit"
                type="button"
                disabled={!canUseControls}
                onClick={() =>
                    handleIntent(
                        resolveTacticsSelectionIntent({
                            units,
                            localPlayerId,
                            selectedUnitId,
                            target: { type: 'unit', unitId: demoUnit.id },
                        }),
                    )
                }
            >
                Unit
            </button>
            <button
                data-testid="move-target"
                type="button"
                disabled={!canMove}
                onClick={() =>
                    handleIntent(
                        resolveTacticsSelectionIntent({
                            units,
                            localPlayerId,
                            selectedUnitId,
                            target: { type: 'ground', grid: nextGrid },
                        }),
                    )
                }
            >
                Move
            </button>
            <button
                data-testid="reveal-target"
                type="button"
                disabled={!canReveal}
                onClick={() =>
                    handleIntent({
                        type: 'reveal-tile',
                        scoutId: demoUnit.id,
                        grid: nextGrid,
                    })
                }
            >
                Reveal
            </button>
            {attackTarget !== undefined && (
                <button
                    data-testid="attack-target"
                    type="button"
                    onClick={() =>
                        handleIntent(
                            resolveTacticsSelectionIntent({
                                units,
                                localPlayerId,
                                selectedUnitId,
                                target: { type: 'unit', unitId: attackTarget.id },
                            }),
                        )
                    }
                >
                    Attack
                </button>
            )}
        </div>
    );
}

export default TacticsDemoBoard;
