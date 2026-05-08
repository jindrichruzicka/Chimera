// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
    entityId,
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import {
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera/shared/tactics.js';
import { TacticsDemoBoard } from './TacticsDemoBoard';

function makeSnapshot(): PlayerSnapshot {
    const viewerId = playerId('p1');
    const unitId = entityId(TACTICS_DEFAULT_UNIT_ID_VALUE);

    return {
        tick: 7,
        viewerId,
        players: {
            [viewerId]: { id: viewerId },
        },
        entities: {
            [unitId]: { id: unitId },
        },
        phase: gamePhase('playing'),
        events: [],
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
    };
}

describe('TacticsDemoBoard', () => {
    it('dispatches a move action through the injected sender', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        fireEvent.click(screen.getByTestId('selectable-unit'));
        fireEvent.click(screen.getByTestId('move-target'));

        expect(sendAction).toHaveBeenCalledWith({
            type: TACTICS_MOVE_UNIT_ACTION,
            playerId: localPlayerId,
            tick: 7,
            payload: {
                unitId: TACTICS_DEFAULT_UNIT_ID_VALUE,
                x: 1,
                y: 0,
            },
        });
    });
});
