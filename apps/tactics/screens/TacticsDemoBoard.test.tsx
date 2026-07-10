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
} from '@chimera-engine/electron/preload/api-types.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_DEFAULT_UNIT_ID_VALUE,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera-engine/tactics/simulation/constants.js';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import { TacticsDemoBoard } from './TacticsDemoBoard';
import { useCommitmentBuffer } from './useCommitmentBuffer';

// Colour hexes now arrive via the generic `content` prop (loaded from the content
// database). Mirrors apps/tactics/data/{player,board}-colors. Hexes are lifted to
// plain consts so they are not flagged as hardcoded design values nested under a
// colour-named content key (chimera/no-hardcoded-design-values).
const BLUE_HEX = '#2563eb';
const GREEN_HEX = '#16a34a';
const AMBER_HEX = '#f59e0b';
const NAVY_HEX = '#1e293b';
const TACTICS_CONTENT: GameContent = {
    'player-colors': [
        { id: 'blue', name: 'Blue', hex: BLUE_HEX },
        { id: 'green', name: 'Green', hex: GREEN_HEX },
        { id: 'amber', name: 'Amber', hex: AMBER_HEX },
    ],
    'board-colors': [{ id: 'navy', name: 'Navy', hex: NAVY_HEX }],
};

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

vi.mock('@chimera-engine/renderer/components/r3f', () => ({
    PerfProbe: () => <div data-testid="perf-probe" />,
}));

vi.mock('../scene/TacticsGroundPlane.js', () => ({
    TacticsGroundPlane: ({
        color,
        onSelectGridPoint,
        onRevealGridPoint,
    }: {
        readonly color: string;
        readonly onSelectGridPoint: (grid: { readonly x: number; readonly y: number }) => void;
        readonly onRevealGridPoint: (grid: { readonly x: number; readonly y: number }) => void;
    }) => (
        <>
            <button
                data-testid="tactics-ground-plane"
                data-board-color={color}
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

vi.mock('../scene/TacticsUnitPrimitive.js', () => ({
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
    useCommitmentBuffer.getState().reset();
});

function makeSnapshot(
    options: {
        readonly includeEnemy?: boolean;
        readonly isMyTurn?: boolean;
        readonly includeSetup?: boolean;
        readonly commitment?: boolean;
        readonly localCommitted?: boolean;
    } = {},
): PlayerSnapshot {
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

    const matchSettings: Record<string, string> = {
        ...(options.includeSetup ? { boardColor: 'navy' } : {}),
        ...(options.commitment ? { turnMode: 'commitment' } : {}),
    };

    return {
        tick: 7,
        viewerId,
        players: {
            [viewerId]: { id: viewerId, ...(options.localCommitted ? { committed: true } : {}) },
            [opponentId]: { id: opponentId },
        },
        entities,
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: options.isMyTurn ?? true,
        ...(options.includeSetup || options.commitment
            ? {
                  setup: {
                      matchSettings,
                      playerAttributes: options.includeSetup
                          ? {
                                [viewerId]: { color: 'green' },
                                [opponentId]: { color: 'amber' },
                            }
                          : {},
                  },
              }
            : {}),
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
        // No host setup → board falls back to slate and every unit to the default blue.
        expect(screen.getByTestId('tactics-ground-plane')).toHaveAttribute(
            'data-board-color',
            '#3f3f46',
        );
        expect(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`)).toHaveAttribute(
            'data-color',
            '#2563eb',
        );
        expect(screen.getByTestId('tactics-unit-unit-2')).toHaveAttribute('data-color', '#2563eb');
        expect(screen.queryByTestId('move-target')).not.toBeInTheDocument();
        expect(screen.queryByTestId('reveal-target')).not.toBeInTheDocument();
        expect(screen.queryByTestId('attack-target')).not.toBeInTheDocument();
        expect(canvasCalls).toHaveLength(1);
        const camera = canvasCalls[0]?.camera;
        expect(camera).toBeInstanceOf(OrthographicCamera);
        expect((camera as OrthographicCamera & { readonly manual?: boolean }).manual).toBe(true);
        expect((camera as OrthographicCamera).up.toArray()).toEqual([0, 0, 1]);
    });

    it('mounts the engine PerfProbe inside the canvas so the Perf HUD gets GL metrics', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        const canvas = screen.getByTestId('tactics-r3f-canvas');
        const probe = screen.getByTestId('perf-probe');
        expect(canvas).toContainElement(probe);
    });

    it("paints the host-configured board color and each unit's host-assigned color", () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ includeSetup: true })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
                content={TACTICS_CONTENT}
            />,
        );

        // navy board, green local units, amber opponent units — resolved from setup
        // names against the content-supplied hex maps.
        expect(screen.getByTestId('tactics-ground-plane')).toHaveAttribute(
            'data-board-color',
            '#1e293b',
        );
        expect(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`)).toHaveAttribute(
            'data-color',
            '#16a34a',
        );
        expect(screen.getByTestId('tactics-unit-unit-2')).toHaveAttribute('data-color', '#f59e0b');
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
        expect(sendAction).toHaveBeenCalledOnce();
        expect(localUnit).toHaveAttribute('data-selected', 'false');
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

        const localUnit = screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`);
        const opponentUnit = screen.getByTestId('tactics-unit-unit-2');

        fireEvent.click(localUnit);
        expect(localUnit).toHaveAttribute('data-selected', 'true');
        fireEvent.click(opponentUnit);

        expect(sendAction).toHaveBeenCalledWith({
            type: TACTICS_ATTACK_ACTION,
            playerId: localPlayerId,
            tick: 7,
            payload: {
                attackerId: TACTICS_DEFAULT_UNIT_ID_VALUE,
                defenderId: 'unit-2',
            },
        });
        expect(sendAction).toHaveBeenCalledOnce();
        expect(localUnit).toHaveAttribute('data-selected', 'false');
        expect(opponentUnit).toHaveAttribute('data-selected', 'false');
    });

    it('buffers a move locally in commitment mode instead of dispatching to the host', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ commitment: true })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));

        // Secrecy: nothing crosses to the host until commit/reveal.
        expect(sendAction).not.toHaveBeenCalled();
        expect(useCommitmentBuffer.getState().buffer).toHaveLength(1);
        expect(useCommitmentBuffer.getState().buffer[0]?.type).toBe(TACTICS_MOVE_UNIT_ACTION);
    });

    it('clears the optimistic buffer when the rendered seat changes (host hot-seat handoff)', () => {
        const sendAction = vi.fn();
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ commitment: true })}
                localPlayerId={playerId('p1')}
                sendAction={sendAction}
            />,
        );

        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));
        expect(useCommitmentBuffer.getState().buffer).toHaveLength(1);

        // A seat handoff re-projects a different viewer WITHOUT remounting the
        // board; the prior seat's buffer must not bleed into the new seat's view.
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ commitment: true })}
                localPlayerId={playerId('p2')}
                sendAction={sendAction}
            />,
        );
        expect(useCommitmentBuffer.getState().buffer).toHaveLength(0);
    });

    it('goes inert once the local seat is committed in commitment mode', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ commitment: true, localCommitted: true })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        const localUnit = screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`);
        fireEvent.click(localUnit);
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));

        // A committed seat's board is non-interactive: no selection, no buffering.
        expect(localUnit).toHaveAttribute('data-selected', 'false');
        expect(sendAction).not.toHaveBeenCalled();
        expect(useCommitmentBuffer.getState().buffer).toHaveLength(0);
    });

    it('selects an opponent primitive alone without enabling move or attack dispatch', () => {
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
        const opponentUnit = screen.getByTestId('tactics-unit-unit-2');

        fireEvent.click(opponentUnit);
        expect(opponentUnit).toHaveAttribute('data-selected', 'true');

        fireEvent.click(screen.getByTestId('tactics-ground-plane'));
        fireEvent.click(localUnit);

        expect(sendAction).not.toHaveBeenCalled();
        expect(localUnit).toHaveAttribute('data-selected', 'true');
        expect(opponentUnit).toHaveAttribute('data-selected', 'false');
    });

    it('ignores primitive and ground clicks when it is not the local player turn', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ isMyTurn: false })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        const localUnit = screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`);
        const opponentUnit = screen.getByTestId('tactics-unit-unit-2');

        fireEvent.click(localUnit);
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));
        fireEvent.click(opponentUnit);

        expect(sendAction).not.toHaveBeenCalled();
        expect(localUnit).toHaveAttribute('data-selected', 'false');
        expect(opponentUnit).toHaveAttribute('data-selected', 'false');
    });

    it('ignores primitive and ground clicks after a match result is resolved', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();
        const snapshot = {
            ...makeSnapshot({ isMyTurn: true }),
            phase: gamePhase('ended'),
            gameResult: { winnerIds: [playerId('p2')] },
        } satisfies PlayerSnapshot;

        render(
            <TacticsDemoBoard
                snapshot={snapshot}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        const localUnit = screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`);
        const opponentUnit = screen.getByTestId('tactics-unit-unit-2');

        fireEvent.click(localUnit);
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));
        fireEvent.click(opponentUnit);
        fireEvent.click(screen.getByTestId('tactics-ground-plane-reveal'));

        expect(sendAction).not.toHaveBeenCalled();
        expect(localUnit).toHaveAttribute('data-selected', 'false');
        expect(opponentUnit).toHaveAttribute('data-selected', 'false');
    });

    it('clears renderer-local selection when turn transitions away and back', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ isMyTurn: true })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        const localUnit = screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`);
        fireEvent.click(localUnit);
        expect(localUnit).toHaveAttribute('data-selected', 'true');

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ isMyTurn: false })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        expect(localUnit).toHaveAttribute('data-selected', 'false');

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ isMyTurn: true })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        expect(localUnit).toHaveAttribute('data-selected', 'false');
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));
        expect(sendAction).not.toHaveBeenCalled();
    });

    it('clears renderer-local selection when the match ends while a unit is selected', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ isMyTurn: true })}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        const localUnit = screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`);
        fireEvent.click(localUnit);
        expect(localUnit).toHaveAttribute('data-selected', 'true');

        // The board goes non-interactive on game end (result + ended phase), so the
        // active selection must be dropped even though it is still "my turn".
        const ended = {
            ...makeSnapshot({ isMyTurn: true }),
            phase: gamePhase('ended'),
            gameResult: { winnerIds: [playerId('p2')] },
        } satisfies PlayerSnapshot;
        rerender(
            <TacticsDemoBoard
                snapshot={ended}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        expect(localUnit).toHaveAttribute('data-selected', 'false');
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));
        expect(sendAction).not.toHaveBeenCalled();
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
        expect(sendAction).not.toHaveBeenCalled();
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
