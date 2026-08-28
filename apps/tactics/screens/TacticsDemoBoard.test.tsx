// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import boardStyles from './TacticsDemoBoard.module.css';
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
import type { CommitmentId } from '@chimera-engine/simulation/foundation/commitment-contract.js';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import {
    AudioManagerProvider,
    rateFromSemitones,
    type AudioManager,
} from '@chimera-engine/renderer/audio';
import { tacticsBundleEn } from '../shell/translations/en.js';
import { tacticsAudioRefs } from '../asset-manifest.js';
import { gridToWorldPoint } from '../components/tacticsSceneModel.js';
import { TACTICS_SFX_JITTER_SEMITONES } from '../components/tacticsSfxJitter.js';
import { TACTICS_CAMERA_POSITION } from '../components/tacticsCamera.js';
import { TacticsDemoBoard } from './TacticsDemoBoard';
import { useCommitmentBuffer } from '../components/useCommitmentBuffer';

// The board renders its fallback aria-labels + the reveal overlay through
// useTranslate() (throws outside a provider), and reaches the audio manager
// through useAudioManager()/useSpatialAudio() (same rule). Wrap every render in
// the English Tactics bundle and a fresh audio-manager double.
function EnProviders({ children }: { readonly children: React.ReactNode }): React.ReactElement {
    return (
        <I18nProvider gameOverride={tacticsBundleEn}>
            <AudioManagerProvider audioManager={audioManager}>{children}</AudioManagerProvider>
        </I18nProvider>
    );
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: EnProviders });

function makeAudioManagerDouble(): AudioManager {
    return {
        play: vi.fn((ref: unknown) => ({
            id: 'board-test-handle',
            ref,
            bus: 'sfx',
            priority: 0,
            valid: true,
        })) as unknown as AudioManager['play'],
        stop: vi.fn(),
        fadeOut: vi.fn(),
        fadeTo: vi.fn(),
        crossfade: vi.fn(),
        crossfadeAtCue: vi.fn(),
        fadeOutAtCue: vi.fn(),
        secondsUntilCue: vi.fn(() => null),
        observeCues: vi.fn(() => () => undefined),
        stopAll: vi.fn(),
        duck: vi.fn(),
        setListener: vi.fn(),
        setVoicePosition: vi.fn(),
        dispose: vi.fn(),
    };
}

let audioManager = makeAudioManagerDouble();

/**
 * The rate every positioned SFX has been played at so far, in call order.
 * Read off the double rather than off a DOM marker: pitch has no marker, and
 * `data-ref` would report two steps at two pitches as the same play twice.
 */
function playedRates(): readonly (number | undefined)[] {
    return vi.mocked(audioManager.play).mock.calls.map((call) => call[1]?.rate);
}

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

const gameCanvasCalls = vi.hoisted(
    (): {
        readonly camera: unknown;
        readonly role: string | undefined;
        readonly className: string | undefined;
    }[] => [],
);

// The mock exports ONLY GameCanvas: the engine mounts PerfProbe and
// FrameRateLimiter itself, so if the board ever re-adds either import (the
// double-mount mutant — a second FrameRateLimiter owns a second
// requestAnimationFrame chain and advances the canvas at roughly double the
// target rate), the component resolves `undefined` and every render test
// crashes red. The `role` fork keys the testid so the board canvas and the
// minimap overlay stay individually addressable.
vi.mock('@chimera-engine/renderer/components/r3f', () => ({
    GameCanvas: ({
        camera,
        children,
        role,
        className,
    }: {
        readonly camera: unknown;
        readonly children: React.ReactNode;
        readonly role?: string;
        readonly className?: string;
    }) => {
        gameCanvasCalls.push({ camera, role, className });
        const renderedChildren = React.Children.toArray(children).filter((child) => {
            return React.isValidElement(child) && typeof child.type !== 'string';
        });
        return (
            <div data-testid={role === 'overlay' ? 'tactics-minimap-canvas' : 'tactics-r3f-canvas'}>
                {renderedChildren}
            </div>
        );
    },
}));

interface MinimapMockUnit {
    readonly id: string;
    readonly ownerId: string;
}

const minimapCalls = vi.hoisted(
    (): {
        readonly units: readonly MinimapMockUnit[];
        readonly boardColor: string;
        readonly unitColorFor: (unit: MinimapMockUnit) => string;
    }[] => [],
);

vi.mock('../components/TacticsMinimap.js', () => ({
    TacticsMinimap: ({
        units,
        boardColor,
        unitColorFor,
    }: {
        readonly units: readonly MinimapMockUnit[];
        readonly boardColor: string;
        readonly unitColorFor: (unit: MinimapMockUnit) => string;
    }) => {
        minimapCalls.push({ units, boardColor, unitColorFor });
        return <div data-testid="tactics-minimap-scene" data-board-color={boardColor} />;
    },
}));

vi.mock('../components/TacticsGroundPlane.js', () => ({
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

const unitPrimitiveUnits = vi.hoisted((): { readonly id: string }[] => []);

vi.mock('../components/TacticsUnitPrimitive.js', () => ({
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
    }) => {
        unitPrimitiveUnits.push(unit);
        return (
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
        );
    },
}));

afterEach(() => {
    cleanup();
    gameCanvasCalls.length = 0;
    minimapCalls.length = 0;
    unitPrimitiveUnits.length = 0;
    useCommitmentBuffer.getState().reset();
    audioManager = makeAudioManagerDouble();
});

function makeSnapshot(
    options: {
        readonly includeEnemy?: boolean;
        readonly isMyTurn?: boolean;
        readonly includeSetup?: boolean;
        readonly commitment?: boolean;
        readonly localCommitted?: boolean;
        /** Off-axis grid placements exist so world-tuple axis swaps cannot hide behind zeros. */
        readonly localUnitAt?: { readonly x: number; readonly y: number };
        /** The opponent's tile, for deltas that move a unit the viewer does not own. */
        readonly enemyUnitAt?: { readonly x: number; readonly y: number };
        /** The viewer's own hp, for deltas where the opponent's blow lands on it. */
        readonly localUnitHp?: number;
        /** The tick the projection carries; a delta is voiced only as this advances. */
        readonly tick?: number;
    } = {},
): PlayerSnapshot {
    const viewerId = playerId('p1');
    const opponentId = playerId('p2');
    const unitId = entityId(TACTICS_DEFAULT_UNIT_ID_VALUE);
    const enemyUnitId = entityId('unit-2');
    const entities: Record<string, ProjectedUnitFixture> = {
        [unitId]: {
            id: unitId,
            kind: 'unit',
            ownerId: viewerId,
            x: options.localUnitAt?.x ?? 0,
            y: options.localUnitAt?.y ?? 0,
            hp: options.localUnitHp ?? 1,
        },
    };

    if (options.includeEnemy ?? true) {
        entities[enemyUnitId] = {
            id: enemyUnitId,
            kind: 'unit',
            ownerId: opponentId,
            x: options.enemyUnitAt?.x ?? 1,
            y: options.enemyUnitAt?.y ?? 0,
            hp: 1,
        };
    }

    const gameParams: Record<string, string> = {
        ...(options.includeSetup ? { boardColor: 'navy' } : {}),
        ...(options.commitment ? { turnMode: 'commitment' } : {}),
    };

    return {
        tick: options.tick ?? 7,
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
                      gameParams,
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
        // Every render must hand each GameCanvas the SAME camera object
        // (reference-compared memo — a new identity per render would
        // re-realize the camera). Two mounts now: the board (default role)
        // and the minimap overlay, one stable camera each.
        expect(gameCanvasCalls.length).toBeGreaterThanOrEqual(2);
        const mainCameraIdentities = new Set(
            gameCanvasCalls.filter((call) => call.role === undefined).map((call) => call.camera),
        );
        expect(mainCameraIdentities.size).toBe(1);
        const overlayCameraIdentities = new Set(
            gameCanvasCalls.filter((call) => call.role === 'overlay').map((call) => call.camera),
        );
        expect(overlayCameraIdentities.size).toBe(1);
        // The board's camera contract is the declarative config it hands the
        // engine GameCanvas (instance realization — manual frustum, up before
        // lookAt — is pinned in the renderer's GameCanvas tests). The e2e pixel
        // projection in e2e/pages/GamePage.ts mirrors these numbers.
        expect(gameCanvasCalls[0]?.camera).toEqual({
            mode: 'orthographic',
            position: [1, 12, 0],
            lookAt: [1, 0, 0],
            up: [0, 0, 1],
            frustum: { left: -3.75, right: 3.75, top: 2.5, bottom: -2.5, near: 0.1, far: 100 },
        });
    });

    it('renders every positioned overlay AFTER the board GameCanvas', () => {
        // Positioned and after the canvas, both — camera-system.md §4.22
        // "Canvas-fit rules". jsdom computes no paint, but it does hold the two
        // facts that decide it.
        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ commitment: true })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
                reveal={{
                    id: 'reveal-1' as CommitmentId,
                    nonce: 'nonce-1',
                    value: { playerId: 'p2', turnNumber: 1, actions: [] },
                }}
            />,
        );

        // The GameCanvas stand-in above renders one div, so its parent is the
        // board scene root the overlays are siblings in.
        const scene = screen.getByTestId('tactics-r3f-canvas').parentElement;
        if (!scene) {
            throw new Error('Expected the board scene to wrap the board GameCanvas');
        }
        const order = [...scene.children].map((child) => child.getAttribute('data-testid'));

        // The trailing audio-listener marker is a HIDDEN span, not a positioned
        // overlay — it sits in the enumeration only because the order is pinned
        // exactly.
        expect(order).toEqual([
            'tactics-r3f-canvas',
            'tactics-reveal',
            'tactics-minimap',
            'tactics-audio-listener',
        ]);
        expect(screen.getByTestId('tactics-reveal')).toHaveStyle({ position: 'absolute' });
    });

    it('mounts exactly two GameCanvas roots — the default-role board and the overlay minimap', () => {
        const localPlayerId = playerId('p1');

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={vi.fn()}
            />,
        );

        expect(screen.getByTestId('tactics-r3f-canvas')).toBeInTheDocument();
        expect(screen.getByTestId('tactics-minimap-canvas')).toBeInTheDocument();
        expect(screen.getByTestId('tactics-minimap')).toBeInTheDocument();

        const roles = gameCanvasCalls.map((call) => call.role);
        expect(roles).toEqual([undefined, 'overlay']);
        // The wrapper and the overlay canvas carry exactly the board's own
        // module-CSS classes — the corner anchor and the canvas chrome; a
        // dropped or swapped class survives every layout-blind assertion.
        const minimapClass = boardStyles['minimap'];
        const minimapCanvasClass = boardStyles['minimapCanvas'];
        if (!minimapClass || !minimapCanvasClass) {
            throw new Error('Expected the board stylesheet to resolve both minimap classes');
        }
        expect(screen.getByTestId('tactics-minimap').className).toBe(minimapClass);
        expect(gameCanvasCalls[1]?.className).toBe(minimapCanvasClass);
        // The minimap camera is a module-level top-down config framing the
        // whole board — the same world framing the main camera uses.
        expect(gameCanvasCalls[1]?.camera).toEqual({
            mode: 'orthographic',
            position: [1, 12, 0],
            lookAt: [1, 0, 0],
            up: [0, 0, 1],
            frustum: { left: -3.75, right: 3.75, top: 2.5, bottom: -2.5, near: 0.1, far: 100 },
        });

        // Reference-stable across renders, per mount.
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={vi.fn()}
            />,
        );
        const overlayCameras = new Set(
            gameCanvasCalls.filter((call) => call.role === 'overlay').map((call) => call.camera),
        );
        expect(overlayCameras.size).toBe(1);
    });

    it('feeds the minimap the same parsed units, board color, and unit colors the board renders', () => {
        const localPlayerId = playerId('p1');

        // WITH content: every colour resolves off its default, so a minimap
        // hardwired to the defaults cannot pass vacuously.
        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ includeSetup: true })}
                localPlayerId={localPlayerId}
                sendAction={vi.fn()}
                content={TACTICS_CONTENT}
            />,
        );

        const minimapProps = minimapCalls.at(-1);
        if (minimapProps === undefined) {
            throw new Error('Expected the board to mount the TacticsMinimap');
        }
        // The SAME unit objects, by identity — one parse feeds both scenes, so
        // a second data path (or a store subscription widening) cannot appear
        // without failing this.
        expect(minimapProps.units).toHaveLength(unitPrimitiveUnits.length);
        for (const unit of unitPrimitiveUnits) {
            expect(minimapProps.units).toContain(unit);
        }
        // The same resolved board color the ground plane paints — the
        // content-supplied navy, never the default.
        expect(minimapProps.boardColor).toBe('#1e293b');
        expect(screen.getByTestId('tactics-minimap-scene')).toHaveAttribute(
            'data-board-color',
            screen.getByTestId('tactics-ground-plane').getAttribute('data-board-color') ?? '',
        );
        // The board's own resolver reaches the minimap: host-assigned green
        // for the local seat, amber for the opponent.
        const ownUnit = minimapProps.units.find(
            (unit) => unit.id === TACTICS_DEFAULT_UNIT_ID_VALUE,
        );
        const opponentUnit = minimapProps.units.find((unit) => unit.id === 'unit-2');
        if (ownUnit === undefined || opponentUnit === undefined) {
            throw new Error('Expected both fixture units to reach the minimap');
        }
        expect(minimapProps.unitColorFor(ownUnit)).toBe('#16a34a');
        expect(minimapProps.unitColorFor(opponentUnit)).toBe('#f59e0b');
    });

    it('renders the scene through the engine GameCanvas', () => {
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={localPlayerId}
                sendAction={sendAction}
            />,
        );

        // GameCanvas owns PerfProbe/FrameRateLimiter mounting (pinned in the
        // renderer's GameCanvas tests and the perf-hud e2e); the board only
        // contributes the scene.
        const canvas = screen.getByTestId('tactics-r3f-canvas');
        expect(canvas).toContainElement(screen.getByTestId('tactics-ground-plane'));
        expect(canvas).toContainElement(
            screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`),
        );
    });

    it('carries no model-showcase status element', () => {
        // The showcase test meshes live on the `/model-showcase/` route now
        // (TacticsModelShowcaseScreen). Re-mounting them here would put two
        // magenta quads back into every board pixel-count and board-click
        // spec's frame — the exact pollution the route exists to prevent.
        // Only the status element is asserted, because that is all this suite
        // can see: the quads mount as `<primitive>`, which this jsdom suite
        // renders as an unrecognized tag rather than as geometry, while the
        // status element is plain DOM the showcase SCREEN renders beside the
        // canvas.
        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(screen.queryByTestId('tactics-model-showcase-status')).not.toBeInTheDocument();
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

    it('plays sword-hit with its own level and band, on the unit that took the blow', () => {
        // The whole options object, not `objectContaining`: the clip, the level
        // and the distance band are per-cue-kind, so an entry that swapped its
        // volume or band with the other kind's would satisfy any partial match.
        // The position comes from the same gridToWorldPoint the board's units are
        // parsed through, so the assertion pins the COUPLING — the sound plays
        // where the unit renders.
        const defenderWorld = gridToWorldPoint({ x: 0, y: 0 });

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitHp: 2 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitHp: 1, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
        expect(audioManager.play).toHaveBeenCalledWith(tacticsAudioRefs.swordHit, {
            bus: 'sfx',
            volume: 0.65,
            // Pitch is per PLAY, not per cue kind, so its value is asserted where
            // variation is the subject; naming the key keeps this object exhaustive.
            rate: expect.any(Number),
            spatial: {
                position: [defenderWorld.x, defenderWorld.y, defenderWorld.z],
                fullVolumeDistance: 1,
                falloffDistance: 6,
            },
        });
    });

    it('plays step with its own level and band, on the tile the unit reached', () => {
        // The other fork of the same table, asserted whole for the same reason.
        const moverWorld = gridToWorldPoint({ x: 0, y: 1 });

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
        expect(audioManager.play).toHaveBeenCalledWith(tacticsAudioRefs.step, {
            bus: 'sfx',
            volume: 0.45,
            rate: expect.any(Number),
            spatial: {
                position: [moverWorld.x, moverWorld.y, moverWorld.z],
                fullVolumeDistance: 1,
                falloffDistance: 6,
            },
        });
    });

    it('gives each step of one turn its own pitch, inside the authored band', () => {
        // The machine-gun defect: two units move in one revealed turn and, at a
        // fixed rate, play the same clip twice bit-identically. The band is read
        // from the game's own constant — its WIDTH is pinned by literals in
        // `tacticsSfxJitter.test.ts`, and what this asserts is that the board
        // plays a draw FROM it rather than an unbounded number.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({
                    localUnitAt: { x: 0, y: 1 },
                    enemyUnitAt: { x: 1, y: 1 },
                    tick: 8,
                })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        const rates = playedRates();
        expect(rates).toHaveLength(2);
        expect(new Set(rates).size).toBe(2);
        for (const rate of rates) {
            expect(rate).toBeGreaterThanOrEqual(rateFromSemitones(-TACTICS_SFX_JITTER_SEMITONES));
            expect(rate).toBeLessThanOrEqual(rateFromSemitones(TACTICS_SFX_JITTER_SEMITONES));
        }
    });

    it('re-pitches the next turn rather than repeating the last one', () => {
        // Two turns rather than two cues, which is what kills a stream keyed on a
        // constant instead of on the turn: it would hand every turn's first step
        // one pitch while a single turn's cues still differed from each other.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 0 }, tick: 9 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        const rates = playedRates();
        expect(rates).toHaveLength(2);
        expect(rates[0]).not.toBe(rates[1]);
    });

    it('keys the pitch on the turn, not on the mount', () => {
        // Reaching ONE turn from two different histories, which is what kills a
        // per-mount stream — `useRef(createTacticsSfxJitter(tick))`. Such a stream
        // still varies its draws per play and per turn, so a single history cannot
        // see it; what it changes is WHICH draw a turn gets. Turn 9 is the second
        // turn of the long history and the first of the short one, and a stream
        // keyed on the turn hands both the same interval.
        const long = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        long.rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        long.rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 0 }, tick: 9 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        const acrossTwoTurns = playedRates();
        expect(acrossTwoTurns).toHaveLength(2);

        // A fresh mount AND a fresh double: `playedRates` reads the calls the double
        // has collected, and the second history has to start from an empty one.
        cleanup();
        audioManager = makeAudioManagerDouble();

        const short = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        short.rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 0 }, tick: 9 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        const fromOneTurn = playedRates();
        expect(fromOneTurn).toHaveLength(1);

        expect(fromOneTurn[0]).toBe(acrossTwoTurns[1]);
    });

    it('anchors the listener at the board centre, which is not the camera position', () => {
        render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.setListener).toHaveBeenCalledTimes(1);
        const pose = vi.mocked(audioManager.setListener).mock.calls[0]?.[0];
        expect(pose?.position).toEqual([1, 0, 0]);
        expect(pose?.position).not.toEqual([...TACTICS_CAMERA_POSITION]);
        expect(screen.getByTestId('tactics-audio-listener')).toHaveAttribute(
            'data-position',
            '1,0,0',
        );
    });

    it('moves the listener to the selected unit and back, keyed on the focus', () => {
        const attackerWorld = gridToWorldPoint({ x: 0, y: 0 });

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));

        expect(audioManager.setListener).toHaveBeenCalledTimes(2);
        expect(vi.mocked(audioManager.setListener).mock.calls[1]?.[0]?.position).toEqual([
            attackerWorld.x,
            attackerWorld.y,
            attackerWorld.z,
        ]);

        // A rerender with the SAME focus writes nothing — the pose is keyed on
        // the focus, never per render.
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        expect(audioManager.setListener).toHaveBeenCalledTimes(2);
    });

    it('pins the world-tuple axis order with an off-axis unit', () => {
        // Grid (1, -1) maps to world (1, 0, -1): distinct x and z components, so a
        // y/z swap in the play position, the listener pose, or the DOM marker
        // cannot hide behind the zeros every on-axis fixture carries
        // (gridToWorldPoint maps grid.y onto world Z, the classic confusion).
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 0 } })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));

        expect(vi.mocked(audioManager.setListener).mock.calls.at(-1)?.[0]?.position).toEqual([
            0, 0, 0,
        ]);

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 1, y: -1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledWith(
            tacticsAudioRefs.step,
            expect.objectContaining({
                spatial: expect.objectContaining({ position: [1, 0, -1] }),
            }),
        );
        expect(screen.getByTestId('tactics-audio-sfx')).toHaveAttribute('data-position', '1,0,-1');
    });

    it('plays nothing for a buffered commitment move until the reveal lands', () => {
        // AC: the pre-reveal buffer play cannot leak an opponent's secret actions,
        // because there is no pre-reveal play at all. A buffered action never
        // reaches the host, so the AUTHORITATIVE projection is unchanged and owes
        // no cue — the optimistic view moves the unit on screen and nothing else.
        const localPlayerId = playerId('p1');

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ commitment: true })}
                localPlayerId={localPlayerId}
                sendAction={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));

        // The move IS buffered — without this the silence below would be the
        // silence of an action that never happened.
        expect(useCommitmentBuffer.getState().buffer).toHaveLength(1);
        expect(audioManager.play).not.toHaveBeenCalled();

        // The reveal: the host applies both seats' turns and the projection
        // finally moves. Only now is the turn audible — and to both seats, since
        // each derives from the projection it received.
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({
                    commitment: true,
                    localUnitAt: { x: 0, y: 1 },
                    enemyUnitAt: { x: 1, y: 1 },
                    tick: 8,
                })}
                localPlayerId={localPlayerId}
                sendAction={vi.fn()}
            />,
        );

        expect(vi.mocked(audioManager.play).mock.calls).toHaveLength(2);
        expect(
            vi
                .mocked(audioManager.play)
                .mock.calls.map((call) => [String(call[0]), call[1]?.spatial?.position]),
        ).toEqual([
            [String(tacticsAudioRefs.step), [0, 0, 1]],
            [String(tacticsAudioRefs.step), [1, 0, 1]],
        ]);
    });

    it('mirrors the last positioned SFX into the DOM for the e2e', () => {
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('tactics-audio-sfx')).toBeNull();

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitHp: 0, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        const marker = screen.getByTestId('tactics-audio-sfx');
        expect(marker).toHaveAttribute('data-ref', String(tacticsAudioRefs.swordHit));
        expect(marker).toHaveAttribute('data-position', '0,0,0');
    });

    it("plays an opponent's move on the observing client, which reaches no intent site", () => {
        // The defect this branch closes. `filterEvents` returns every event to
        // every seat, so both clients had been playing both verbs; moving the play
        // to the intent site left the observer — who never dispatches — silent.
        // Here the viewer p1 does nothing at all and still hears p2's unit.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        expect(audioManager.play).not.toHaveBeenCalled();

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ enemyUnitAt: { x: 2, y: -1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
        expect(audioManager.play).toHaveBeenCalledWith(
            tacticsAudioRefs.step,
            expect.objectContaining({
                spatial: expect.objectContaining({ position: [2, 0, -1] }),
            }),
        );
    });

    it("plays an opponent's attack on the observing client, positioned on the unit hit", () => {
        // The other half of the same restoration. The viewer owns the defender, so
        // its hp drop is visible to it by construction — the case that holds even
        // under fog of war.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitHp: 2, isMyTurn: false })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitHp: 1, isMyTurn: false, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
        expect(audioManager.play).toHaveBeenCalledWith(
            tacticsAudioRefs.swordHit,
            expect.objectContaining({
                bus: 'sfx',
                spatial: expect.objectContaining({ position: [0, 0, 0] }),
            }),
        );
    });

    it('plays a dispatched move exactly once on the acting client', () => {
        // The double-play the binding entries were removed to prevent. The click
        // dispatches and sounds nothing; the projection that comes back sounds
        // once. One writer, so a verb cannot be owed by two paths.
        const sendAction = vi.fn();
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot()}
                localPlayerId={playerId('p1')}
                sendAction={sendAction}
            />,
        );

        fireEvent.click(screen.getByTestId(`tactics-unit-${TACTICS_DEFAULT_UNIT_ID_VALUE}`));
        fireEvent.click(screen.getByTestId('tactics-ground-plane'));

        expect(sendAction).toHaveBeenCalledTimes(1);
        expect(audioManager.play).not.toHaveBeenCalled();

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={sendAction}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
    });

    it('does not re-voice a move on the next tick that changed nothing', () => {
        // Three snapshots, because the baseline is only observable across TWO
        // delta steps: a fixture that stops after the first cue reads the mount
        // projection and the moved one and can never tell whether the baseline
        // advanced. Frozen at mount, this unit's step would fire again on every
        // later tick forever.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ tick: 7 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        expect(audioManager.play).toHaveBeenCalledTimes(1);

        // A later turn that moved nobody — the opponent passed, say.
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 9 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
    });

    it('carries a same-tick re-projection into the baseline the next tick reads', () => {
        // The silent branch still has to record what it saw. If the same-tick
        // projection is dropped instead of baselined, the next advance measures
        // against a tree two projections old and voices a move no turn produced.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ tick: 7 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 7 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        expect(audioManager.play).not.toHaveBeenCalled();

        // Same units, tick finally advances. Nothing moved since the projection
        // above, so nothing is owed.
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 8 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).not.toHaveBeenCalled();
    });

    it('follows the tick back down when a rewind leaves the board untouched', () => {
        // A restore to an earlier tick that happens to reach the same board: the
        // entity map comes back referentially identical, so the parsed unit list
        // is unchanged and only the TICK moved. The baseline has to follow it
        // anyway — otherwise the next real move is measured against a tick from
        // the future and silently swallowed.
        const base = makeSnapshot({ tick: 9 });
        const rewound: PlayerSnapshot = { ...base, tick: 4 };

        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={base}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        rerender(
            <TacticsDemoBoard
                snapshot={rewound}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );
        expect(audioManager.play).not.toHaveBeenCalled();

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 0, y: 1 }, tick: 5 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
    });

    it('stays silent when a re-projection moves a unit on the SAME tick', () => {
        // The boundary case of the guard, which a strictly-lower fixture cannot
        // reach: the comparison is inclusive, so a tick that merely repeats is
        // not a turn. Only a fixture exactly ON the boundary kills the `<=` → `<`
        // mutant.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ tick: 7 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 2, y: 1 }, tick: 7 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).not.toHaveBeenCalled();
    });

    it('re-baselines without sounding when the tick does not advance', () => {
        // A restored save, an undo, or a re-projection for a new seat can move
        // every unit at once without a turn having been played. Voicing those
        // would fire a burst of steps for a board the player never watched move,
        // so the delta is read only as the tick moves forward.
        const { rerender } = render(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ tick: 9 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 3, y: -2 }, tick: 4 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).not.toHaveBeenCalled();

        // The rewound tree is the new baseline, so play resumes from it rather
        // than replaying the jump the moment the tick next moves.
        rerender(
            <TacticsDemoBoard
                snapshot={makeSnapshot({ localUnitAt: { x: 3, y: -1 }, tick: 5 })}
                localPlayerId={playerId('p1')}
                sendAction={vi.fn()}
            />,
        );

        expect(audioManager.play).toHaveBeenCalledTimes(1);
        expect(audioManager.play).toHaveBeenCalledWith(
            tacticsAudioRefs.step,
            expect.objectContaining({
                spatial: expect.objectContaining({ position: [3, 0, -1] }),
            }),
        );
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

    it('labels the board in Czech when the Czech bundle is active', async () => {
        const { tacticsBundleCs } = await import('../shell/translations/cs.js');
        const localPlayerId = playerId('p1');
        const sendAction = vi.fn();

        baseRender(
            <I18nProvider
                gameOverride={tacticsBundleCs}
                languages={[
                    { code: 'en-US', label: 'English' },
                    { code: 'cs-CZ', label: 'Čeština' },
                ]}
                locale="cs-CZ"
            >
                <AudioManagerProvider audioManager={audioManager}>
                    <TacticsDemoBoard
                        snapshot={makeSnapshot()}
                        localPlayerId={localPlayerId}
                        sendAction={sendAction}
                    />
                </AudioManagerProvider>
            </I18nProvider>,
        );

        expect(screen.getByLabelText('Herní pole Tactics')).toBeInTheDocument();
    });
});
