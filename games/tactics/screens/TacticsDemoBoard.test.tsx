// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    entityId,
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera/shared/tactics.js';
import { TacticsDemoBoard } from './TacticsDemoBoard';

afterEach(() => {
    cleanup();
});

function makeSnapshot(): PlayerSnapshot {
    const viewerId = playerId('p1');
    const opponentId = playerId('p2');
    const unitId = entityId(TACTICS_DEFAULT_UNIT_ID_VALUE);
    const enemyUnitId = entityId('unit-2');

    return {
        tick: 7,
        viewerId,
        players: {
            [viewerId]: { id: viewerId },
            [opponentId]: { id: opponentId },
        },
        entities: {
            [unitId]: { id: unitId, kind: 'unit', ownerId: viewerId, x: 0, y: 0, hp: 1 },
            [enemyUnitId]: {
                id: enemyUnitId,
                kind: 'unit',
                ownerId: opponentId,
                x: 1,
                y: 0,
                hp: 1,
            },
        },
        phase: gamePhase('playing'),
        events: [],
        matchResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
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

    it('shows and dispatches an attack target for a selected adjacent enemy', () => {
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
        fireEvent.click(screen.getByTestId('attack-target'));

        expect(sendAction).toHaveBeenCalledWith({
            type: TACTICS_ATTACK_ACTION,
            playerId: localPlayerId,
            tick: 7,
            payload: {
                attackerId: TACTICS_DEFAULT_UNIT_ID_VALUE,
                defenderId: 'unit-2',
            },
        });
    });
});
