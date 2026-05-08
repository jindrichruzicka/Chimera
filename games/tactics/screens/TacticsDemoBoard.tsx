'use client';

import React, { useState } from 'react';
import type { GameScreenProps } from '@chimera/renderer/components/shell/MatchShell.js';
import {
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera/shared/tactics.js';

export function TacticsDemoBoard({
    snapshot,
    localPlayerId,
    sendAction,
}: GameScreenProps): React.ReactElement | null {
    const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

    const hasDemoUnit = Object.prototype.hasOwnProperty.call(
        snapshot.entities,
        TACTICS_DEFAULT_UNIT_ID_VALUE,
    );

    if (!hasDemoUnit) {
        return null;
    }

    const canUseControls = localPlayerId !== undefined;
    const canMove = canUseControls && selectedUnitId === TACTICS_DEFAULT_UNIT_ID_VALUE;

    return (
        <div aria-label="Tactics board">
            <button
                data-testid="selectable-unit"
                type="button"
                disabled={!canUseControls}
                onClick={() => setSelectedUnitId(TACTICS_DEFAULT_UNIT_ID_VALUE)}
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
                            unitId: TACTICS_DEFAULT_UNIT_ID_VALUE,
                            x: 1,
                            y: 0,
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
