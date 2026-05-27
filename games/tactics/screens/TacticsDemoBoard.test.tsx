// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { OrthographicCamera } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    entityId,
    gamePhase,
    playerId,
    type EntityId,
    type PlayerId,
    type PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/shared/tactics.js';
import { TacticsDemoBoard } from './TacticsDemoBoard';

interface ProjectedUnitFixture {
    readonly id: EntityId;
    readonly kind: 'unit';
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly hp: number;
}

const canvasCalls = vi.hoisted(
    (): {
        readonly camera: unknown;
    }[] => [],
);

vi.mock('@react-three/fiber', () => ({
    Canvas: ({
        camera,
        children,
    }: {
        readonly camera: unknown;
        readonly children: React.ReactNode;
    }) => {
        canvasCalls.push({ camera });
        const renderedChildren = React.Children.toArray(children).filter((child) => {
            return React.isValidElement(child) && typeof child.type !== 'string';
        });
        return <div data-testid="tactics-r3f-canvas">{renderedChildren}</div>;
    },
}));

vi.mock('./TacticsGroundPlane.js', () => ({
    TacticsGroundPlane: ({
        onSelectGridPoint,
        onRevealGridPoint,
    }: {
        readonly onSelectGridPoint: (grid: { readonly x: number; readonly y: number }) => void;
        readonly onRevealGridPoint: (grid: { readonly x: number; readonly y: number }) => void;
    }) => (
        <>
            <button
                data-testid="tactics-ground-plane"
                type="button"
                onClick={() => onSelectGridPoint({ x: 1, y: 0 })}
            >
                ground
            </button>
            <button
                data-testid="tactics-ground-plane-reveal"
                type="button"
                onClick={() => onRevealGridPoint({ x: 1, y: 0 })}
            >
                reveal ground
            </button>
        </>
    ),
}));

vi.mock('./TacticsUnitPrimitive.js', () => ({
    TACTICS_UNIT_COLOR_BY_OWNERSHIP: {
        own: 'blue',
        opponent: 'red',
    },
    TacticsUnitPrimitive: ({
        unit,
        color,
        isSelected,
        onSelect,
    }: {
        readonly unit: {
            readonly id: string;
            readonly ownership: string;
        };
        readonly color: string;
        readonly isSelected: boolean;
        readonly onSelect: (unitId: string) => void;
    }) => (
        <button
            data-testid={`tactics-unit-${unit.id}`}
            data-color={color}
            data-ownership={unit.ownership}
            data-selected={String(isSelected)}
            type="button"
            onClick={() => onSelect(unit.id)}
        >
            {unit.id}
        </button>
    ),
}));

afterEach(() => {
    cleanup();
    canvasCalls.length = 0;
});

function makeSnapshot(options: { readonly includeEnemy?: boolean } = {}): PlayerSnapshot {
    const viewerId = playerId('p1');
    const opponentId = playerId('p2');
    const unitId = entityId(TACTICS_DEFAULT_UNIT_ID_VALUE);
    const enemyUnitId = entityId('unit-2');
    const entities: Record<string, ProjectedUnitFixture> = {
        [unitId]: { id: unitId, kind: 'unit', ownerId: viewerId, x: 0, y: 0, hp: 1 },
    };

    if (options.includeEnemy ?? true) {
        entities[enemyUnitId] = {
            id: enemyUnitId,
            kind: 'unit',
            ownerId: opponentId,
            x: 1,
            y: 0,
            hp: 1,
        };
    }

    return {
        tick: 7,
        viewerId,
        players: {
            [viewerId]: { id: viewerId },
            [opponentId]: { id: opponentId },
        },
        entities,
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

describe('TacticsDemoBoard', () => {
    it('renders a canvas-backed scene with colored visible units and no legacy controls', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        expect(screen.getByTestId('tactics-r3f-canvas')).toBeInTheDocument();
        expect(screen.getByLabelText('Tactics board')).toHaveStyle({
            height: '100%',
            position: 'absolute',
        });
        expect(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`)).toHaveAttribute(
            'data-color',
            'blue',
        );
        expect(screen.getByTestId('tactics-unit-unit-2')).toHaveAttribute('data-color', 'red');
        expect(screen.queryByTestId('move-target')).not.toBeInTheDocument();
        expect(screen.queryByTestId('reveal-target')).not.toBeInTheDocument();
        expect(screen.queryByTestId('attack-target')).not.toBeInTheDocument();
        expect(canvasCalls).toHaveLength(1);
        const camera = canvasCalls[0]?.camera;
        expect(camera).toBeInstanceOf(OrthographicCamera);
        expect((camera as OrthographicCamera & { readonly manual?: boolean }).manual).toBe(true);
        expect((camera as OrthographicCamera).up.toArray()).toEqual([0, 0, 1]);
    });

    it('uses renderer-local selection state to move the selected local primitive', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        const localUnit = screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`);
        expect(localUnit).toHaveAttribute('data-selected', 'false');

        fireEvent.click(localUnit);
        expect(localUnit).toHaveAttribute('data-selected', 'true');
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));

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

    it('dispatches an attack when a visible opponent primitive is selected after a local primitive', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));
        fireEvent.click(screen.getByTestId('tactics-unit-unit-2'));

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

    it('dispatches a reveal when the selected local primitive requests reveal on an adjacent tile', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ includeEnemy: false })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));
        fireEvent.click(screen.getByTestId('tactics-ground-plane-reveal'));

        expect(sendAction).toHaveBeenCalledWith({
            type: TACTICS_REVEAL_TILE_ACTION,
            playerId: localPlayerId,
            tick: 7,
            payload: {
                scoutId: TACTICS_DEFAULT_UNIT_ID_VALUE,
                x: 1,
                y: 0,
            },
        });
    });

    it('renders a loading fallback while the local player identity is unavailable', () => {
        const sendAction = vi.fn();

        render(<TacticsDemoBoard snapshot={makeSnapshot()} sendAction={sendAction} />);

        expect(screen.getByTestId('tactics-board-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('tactics-r3f-canvas')).not.toBeInTheDocument();
    });

    it('renders an empty-board fallback when the projected snapshot has no visible units', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();
        const snapshot = { ...makeSnapshot(), entities: {} } satisfies PlayerSnapshot;

        render(
            <TacticsDemoBoard
                snapshot={snapshot}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        expect(screen.getByTestId('tactics-board-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('tactics-r3f-canvas')).not.toBeInTheDocument();
    });
});
