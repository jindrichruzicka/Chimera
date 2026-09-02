// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    entityId,
    gamePhase,
    playerId,
    type PlayerId,
    type PlayerSnapshot,
} from '@chimera-engine/electron/preload/api-types.js';
import { InputManagerProvider, type InputManager } from '@chimera-engine/renderer/input';
import type { InputActionId, InputEvent } from '@chimera-engine/renderer/input';

import {
    ACTION_CONTROL_ATTRIBUTE,
    ACTION_PRIMITIVE_ATTRIBUTE,
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
    ACTION_WASD_CONTROL,
} from '../simulation/constants.js';
import { ACTION_ALL_MOVE_ACTION_IDS, ACTION_MOVE_ACTION_IDS } from '../input-action-ids.js';
import { ACTION_PRIMITIVE_HEIGHT, arenaToWorld } from '../components/actionSceneModel.js';
import { ActionPlayfield } from './ActionPlayfield';
import playfieldStyles from './ActionPlayfield.module.css';

const P1 = playerId('player-1');
const P2 = playerId('player-2');

// ── The engine seams this screen stands on ───────────────────────────────────
//
// Only `GameCanvas` is exported from the r3f mock: the engine mounts `PerfProbe`
// and `FrameRateLimiter` itself, so if the screen ever re-adds either import the
// component resolves `undefined` and every render test crashes red.
const gameCanvasCalls = vi.hoisted(
    (): { readonly camera: unknown; readonly role: string | undefined }[] => [],
);

vi.mock('@chimera-engine/renderer/components/r3f', () => ({
    GameCanvas: ({
        camera,
        children,
        role,
    }: {
        readonly camera: unknown;
        readonly children: React.ReactNode;
        readonly role?: string;
    }) => {
        gameCanvasCalls.push({ camera, role });
        return (
            <div data-testid="action-r3f-canvas">
                {React.Children.toArray(children).filter(
                    (child) => React.isValidElement(child) && typeof child.type !== 'string',
                )}
            </div>
        );
    },
}));

interface GroundMockProps {
    readonly ground: { readonly widthCells: number; readonly depthCells: number };
}

vi.mock('../components/ActionGroundPlane.js', () => ({
    ActionGroundPlane: ({ ground }: GroundMockProps) => (
        <div
            data-testid="action-ground"
            data-width={String(ground.widthCells)}
            data-depth={String(ground.depthCells)}
        />
    ),
}));

interface PrimitiveMockProps {
    readonly primitive: {
        readonly id: string;
        readonly shape: string;
        readonly world: readonly [number, number, number];
        readonly ownerId: string | null;
    };
    readonly isControlled: boolean;
    readonly onSelect: (entityId: string) => void;
}

// The double keeps the real mesh's one judgement — it does not report a click
// on the primitive this viewer already drives. Without it a composed test can
// assert a dispatch the real tree never makes.
vi.mock('../components/ActionPrimitiveMesh.js', () => ({
    ActionPrimitiveMesh: ({ primitive, isControlled, onSelect }: PrimitiveMockProps) => (
        <button
            data-testid={`action-primitive-${primitive.id}`}
            data-shape={primitive.shape}
            data-world={primitive.world.join(',')}
            data-controlled={String(isControlled)}
            type="button"
            onClick={() => {
                if (isControlled) return;
                onSelect(primitive.id);
            }}
        >
            {primitive.id}
        </button>
    ),
}));

// ── An InputManager double that lets a test push key events ──────────────────

type Subscribers = Map<InputActionId, Set<(event: InputEvent) => void>>;

let subscribers: Subscribers;
let inputManager: InputManager;

function makeInputManagerDouble(): InputManager {
    return {
        onAction: vi.fn((id: InputActionId, callback: (event: InputEvent) => void) => {
            const forId = subscribers.get(id) ?? new Set();
            forId.add(callback);
            subscribers.set(id, forId);
            return () => {
                forId.delete(callback);
            };
        }),
        isPressed: vi.fn(() => false),
        rebind: vi.fn(),
        getBindings: vi.fn(() => ({})),
        dispose: vi.fn(),
    } as unknown as InputManager;
}

/**
 * Delivers one key-down / key-up for `id`, exactly as the manager would.
 *
 * Wrapped in `act` because the subscription updates React state: without it the
 * held-set update and the effect that dispatches off it are still queued when
 * the assertion runs, and every dispatch assertion reads zero calls.
 */
function fireInput(id: InputActionId, pressed: boolean): void {
    act(() => {
        for (const callback of subscribers.get(id) ?? []) {
            callback({
                actionId: id,
                code: 'Arrow',
                modifiers: [],
                repeat: false,
                pressed,
                timestamp: 0,
            });
        }
    });
}

function makeSnapshot(
    overrides: Readonly<Record<string, Record<string, unknown>>> = {},
): PlayerSnapshot {
    const base: Record<string, Record<string, unknown>> = {
        ground: { id: entityId('ground'), kind: 'ground', widthCells: 17, depthCells: 11 },
        'primitive-cube': {
            id: entityId('primitive-cube'),
            kind: 'primitive',
            shape: 'cube',
            x: -4,
            y: 0,
            dx: 0,
            dy: 0,
            ownerId: P1,
        },
        'primitive-sphere': {
            id: entityId('primitive-sphere'),
            kind: 'primitive',
            shape: 'sphere',
            x: 0,
            y: 0,
            dx: 0,
            dy: 0,
            ownerId: P2,
        },
        'primitive-cone': {
            id: entityId('primitive-cone'),
            kind: 'primitive',
            shape: 'cone',
            x: 4,
            y: 0,
            dx: 0,
            dy: 0,
            ownerId: null,
        },
    };
    const entities = { ...base, ...overrides };
    return {
        tick: 12,
        viewerId: P1,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: entities as unknown as PlayerSnapshot['entities'],
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function renderPlayfield(
    options: {
        readonly snapshot?: PlayerSnapshot;
        readonly localPlayerId?: PlayerId;
        readonly sendAction?: ReturnType<typeof vi.fn>;
        readonly isHost?: boolean;
    } = {},
): { readonly sendAction: ReturnType<typeof vi.fn> } {
    const sendAction = options.sendAction ?? vi.fn();
    render(
        <InputManagerProvider inputManager={inputManager}>
            <ActionPlayfield
                snapshot={options.snapshot ?? makeSnapshot()}
                localPlayerId={options.localPlayerId ?? P1}
                sendAction={sendAction as GameSendAction}
                {...(options.isHost === undefined ? {} : { isHost: options.isHost })}
            />
        </InputManagerProvider>,
    );
    return { sendAction };
}

type GameSendAction = React.ComponentProps<typeof ActionPlayfield>['sendAction'];

beforeEach(() => {
    subscribers = new Map();
    inputManager = makeInputManagerDouble();
    gameCanvasCalls.length = 0;
});

afterEach(() => {
    // The suite renders several times per test; without an explicit cleanup
    // (vitest runs with `globals: false`, so RTL installs none) every query
    // finds the previous render's DOM as well as this one's.
    cleanup();
    vi.clearAllMocks();
});

// ── The arena ────────────────────────────────────────────────────────────────

describe('ActionPlayfield — the arena', () => {
    it('makes the scene host the screen root', () => {
        // The full-bleed rule only reaches the host section from the OUTERMOST
        // element: any in-flow wrapper between them re-introduces the
        // auto-height link the absolute positioning exists to skip, and the
        // canvas collapses to a strip. jsdom computes no layout, so element
        // identity is the only part of that this can assert.
        const { container } = render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={vi.fn() as GameSendAction}
                />
            </InputManagerProvider>,
        );

        expect(container.firstElementChild?.className).toContain(
            playfieldStyles['sceneHost'] ?? 'sceneHost',
        );
    });

    it('mounts exactly one main-role canvas on the top-down preset', () => {
        renderPlayfield();

        expect(gameCanvasCalls).toEqual([{ camera: 'top-down', role: 'main' }]);
        expect(screen.getByTestId('action-r3f-canvas')).toBeInTheDocument();
    });

    it('renders the ground plane at the size the snapshot declares', () => {
        renderPlayfield();

        const ground = screen.getByTestId('action-ground');
        expect(ground).toHaveAttribute('data-width', '17');
        expect(ground).toHaveAttribute('data-depth', '11');
    });

    it('renders one mesh per primitive, at the world position of its cell', () => {
        renderPlayfield();

        expect(screen.getByTestId('action-primitive-primitive-cube')).toHaveAttribute(
            'data-world',
            arenaToWorld({ x: -4, y: 0 }, ACTION_PRIMITIVE_HEIGHT).join(','),
        );
        expect(screen.getByTestId('action-primitive-primitive-sphere')).toHaveAttribute(
            'data-shape',
            'sphere',
        );
    });

    it('marks only the viewer’s own primitive as controlled', () => {
        renderPlayfield({ localPlayerId: P1 });

        expect(screen.getByTestId('action-primitive-primitive-cube')).toHaveAttribute(
            'data-controlled',
            'true',
        );
        expect(screen.getByTestId('action-primitive-primitive-sphere')).toHaveAttribute(
            'data-controlled',
            'false',
        );
        // The whole rendered set, so "only" is exhaustive: an ownerless
        // primitive is not the viewer’s either.
        expect(screen.getByTestId('action-primitive-primitive-cone')).toHaveAttribute(
            'data-controlled',
            'false',
        );
    });

    it('falls back to the snapshot’s viewer when no local player id is passed', () => {
        render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield snapshot={makeSnapshot()} sendAction={vi.fn() as GameSendAction} />
            </InputManagerProvider>,
        );

        expect(screen.getByTestId('action-primitive-primitive-cube')).toHaveAttribute(
            'data-controlled',
            'true',
        );
    });

    it('renders the keyboard hint after the canvas', () => {
        const { container } = render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={vi.fn() as GameSendAction}
                />
            </InputManagerProvider>,
        );

        const host = container.firstElementChild;
        const children = [...(host?.children ?? [])];
        const canvasIndex = children.findIndex(
            (child) => child.getAttribute('data-testid') === 'action-r3f-canvas',
        );
        const hintIndex = children.findIndex((child) => child.tagName === 'P');
        expect(canvasIndex).toBeGreaterThanOrEqual(0);
        expect(hintIndex).toBeGreaterThan(canvasIndex);
    });
});

// ── Arrow-key movement ───────────────────────────────────────────────────────

describe('ActionPlayfield — arrow-key movement', () => {
    it('subscribes exactly the declared movement actions', () => {
        renderPlayfield();

        expect([...subscribers.keys()].sort()).toEqual([...ACTION_MOVE_ACTION_IDS].sort());
    });

    it('sends nothing on mount', () => {
        // The initial velocity is already zero; a screen that dispatched it
        // anyway would fire an action for every match entry.
        const { sendAction } = renderPlayfield();

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('sends a velocity on key DOWN', () => {
        const { sendAction } = renderPlayfield();

        fireInput('game:move-right', true);

        expect(sendAction).toHaveBeenCalledWith({
            type: ACTION_SET_VELOCITY_ACTION,
            playerId: P1,
            tick: 12,
            payload: { dx: 1, dy: 0 },
        });
    });

    it('clears the velocity on key UP', () => {
        const { sendAction } = renderPlayfield();

        fireInput('game:move-right', true);
        sendAction.mockClear();
        fireInput('game:move-right', false);

        expect(sendAction).toHaveBeenCalledWith({
            type: ACTION_SET_VELOCITY_ACTION,
            playerId: P1,
            tick: 12,
            payload: { dx: 0, dy: 0 },
        });
    });

    it('combines two held keys into one diagonal velocity', () => {
        const { sendAction } = renderPlayfield();

        fireInput('game:move-right', true);
        sendAction.mockClear();
        fireInput('game:move-up', true);

        expect(sendAction).toHaveBeenCalledTimes(1);
        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ payload: { dx: 1, dy: -1 } }),
        );
    });

    it('maps each arrow to its own axis', () => {
        const { sendAction } = renderPlayfield();

        for (const [id, payload] of [
            ['game:move-up', { dx: 0, dy: -1 }],
            ['game:move-down', { dx: 0, dy: 1 }],
            ['game:move-left', { dx: -1, dy: 0 }],
            ['game:move-right', { dx: 1, dy: 0 }],
        ] as const) {
            sendAction.mockClear();
            fireInput(id, true);
            expect(sendAction, id).toHaveBeenCalledWith(expect.objectContaining({ payload }));
            fireInput(id, false);
        }
    });

    it('sends nothing when a repeated press leaves the velocity unchanged', () => {
        // The held set is rebuilt on every event, so the effect DOES re-run —
        // what stops the duplicate action is the comparison against the last
        // velocity sent. Deleting that comparison makes this red.
        const { sendAction } = renderPlayfield();

        fireInput('game:move-up', true);
        sendAction.mockClear();

        fireInput('game:move-up', true);

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('sends nothing when a key nobody held is released', () => {
        const { sendAction } = renderPlayfield();

        fireInput('game:move-left', false);

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('cancels an opposing pair and resumes the survivor, dispatching each change', () => {
        // The velocity guard must not swallow a REAL change: Left+Right cancels
        // to a stop, and releasing Right has to start the primitive moving again.
        const { sendAction } = renderPlayfield();

        fireInput('game:move-left', true);
        fireInput('game:move-right', true);
        sendAction.mockClear();

        fireInput('game:move-right', false);

        expect(sendAction).toHaveBeenCalledTimes(1);
        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ payload: { dx: -1, dy: 0 } }),
        );
    });

    it('does not re-send the held velocity when a new snapshot arrives', () => {
        // The heartbeat delivers a snapshot ten times a second. A screen that
        // dispatched on `snapshot.tick` would send ten identical actions per
        // second for one held key.
        const sendAction = vi.fn();
        const { rerender } = render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={sendAction as GameSendAction}
                />
            </InputManagerProvider>,
        );

        fireInput('game:move-right', true);
        sendAction.mockClear();

        for (let tick = 13; tick < 20; tick += 1) {
            rerender(
                <InputManagerProvider inputManager={inputManager}>
                    <ActionPlayfield
                        snapshot={{ ...makeSnapshot(), tick }}
                        localPlayerId={P1}
                        sendAction={sendAction as GameSendAction}
                    />
                </InputManagerProvider>,
            );
        }

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('stamps a later action with the tick current at dispatch time', () => {
        const sendAction = vi.fn();
        const { rerender } = render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={sendAction as GameSendAction}
                />
            </InputManagerProvider>,
        );

        rerender(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={{ ...makeSnapshot(), tick: 99 }}
                    localPlayerId={P1}
                    sendAction={sendAction as GameSendAction}
                />
            </InputManagerProvider>,
        );
        fireInput('game:move-up', true);

        expect(sendAction).toHaveBeenCalledWith(expect.objectContaining({ tick: 99 }));
    });
});

// ── In-scene selection ───────────────────────────────────────────────────────

describe('ActionPlayfield — selection', () => {
    it('sends action:select-primitive for the clicked primitive', () => {
        const { sendAction } = renderPlayfield();

        screen.getByTestId('action-primitive-primitive-sphere').click();

        expect(sendAction).toHaveBeenCalledWith({
            type: ACTION_SELECT_PRIMITIVE_ACTION,
            playerId: P1,
            tick: 12,
            payload: { entityId: 'primitive-sphere' },
        });
    });

    it('names the clicked primitive, not the first one', () => {
        // The cone: third in the record, and not one the viewer drives.
        const { sendAction } = renderPlayfield();

        screen.getByTestId('action-primitive-primitive-cone').click();

        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ payload: { entityId: 'primitive-cone' } }),
        );
    });

    it('sends nothing when the viewer clicks the primitive it already drives', () => {
        // The mesh declines to report it, so no `action:select-primitive`
        // reaches the host to be refused and logged.
        const { sendAction } = renderPlayfield();

        screen.getByTestId('action-primitive-primitive-cube').click();

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('stamps a click made after several beats with the tick current at the click', () => {
        // The handler the meshes hold is pinned across renders so a heartbeat
        // does not rebuild the whole scene's callbacks. That is exactly the
        // shape that goes STALE: a handler closing over `snapshot.tick`
        // directly would stamp every later click with the tick from mount, and
        // at ten beats a second the staleness grows without bound.
        const sendAction = vi.fn();
        const { rerender } = render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={sendAction as GameSendAction}
                />
            </InputManagerProvider>,
        );

        rerender(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={{ ...makeSnapshot(), tick: 137 }}
                    localPlayerId={P1}
                    sendAction={sendAction as GameSendAction}
                />
            </InputManagerProvider>,
        );
        screen.getByTestId('action-primitive-primitive-sphere').click();

        expect(sendAction).toHaveBeenCalledWith(expect.objectContaining({ tick: 137 }));
    });

    it('attributes a click to the viewer current at the click', () => {
        // The third field the pinned handler reads through a ref. The engine
        // re-mounts a screen for a new match rather than swapping the seat
        // under it, so this is a defence rather than a flow the app drives —
        // but a handler frozen at the first viewer would attribute one seat's
        // click to another, and nothing else here would notice.
        const sendAction = vi.fn();
        const { rerender } = render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={sendAction as GameSendAction}
                />
            </InputManagerProvider>,
        );

        rerender(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P2}
                    sendAction={sendAction as GameSendAction}
                />
            </InputManagerProvider>,
        );
        screen.getByTestId('action-primitive-primitive-cube').click();

        expect(sendAction).toHaveBeenCalledWith(expect.objectContaining({ playerId: P2 }));
    });

    it('sends a click through the sendAction prop current at the click', () => {
        // Same staleness, the other field: the pinned handler reads the prop
        // through a ref, so a shell that hands down a new dispatcher mid-match
        // is the one that receives the action.
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={first as GameSendAction}
                />
            </InputManagerProvider>,
        );

        rerender(
            <InputManagerProvider inputManager={inputManager}>
                <ActionPlayfield
                    snapshot={makeSnapshot()}
                    localPlayerId={P1}
                    sendAction={second as GameSendAction}
                />
            </InputManagerProvider>,
        );
        screen.getByTestId('action-primitive-primitive-sphere').click();

        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
    });
});

// ── The pass-and-play seat ───────────────────────────────────────────────────

describe('ActionPlayfield — the pass-and-play seat', () => {
    /** A snapshot whose setup marks P2 as the WASD-driven local seat. */
    function twoSeatSnapshot(): PlayerSnapshot {
        return {
            ...makeSnapshot(),
            setup: {
                gameParams: {},
                playerAttributes: {
                    [P1]: { [ACTION_PRIMITIVE_ATTRIBUTE]: 'cube' },
                    [P2]: {
                        [ACTION_PRIMITIVE_ATTRIBUTE]: 'sphere',
                        [ACTION_CONTROL_ATTRIBUTE]: ACTION_WASD_CONTROL,
                    },
                },
            },
        };
    }

    it('subscribes only seat one’s cluster when the match has no second local seat', () => {
        renderPlayfield();

        expect([...subscribers.keys()].sort()).toEqual([...ACTION_MOVE_ACTION_IDS].sort());
    });

    it('subscribes BOTH clusters once a WASD seat is declared', () => {
        renderPlayfield({ snapshot: twoSeatSnapshot() });

        expect([...subscribers.keys()].sort()).toEqual([...ACTION_ALL_MOVE_ACTION_IDS].sort());
    });

    it('stamps a WASD velocity with the SECOND seat’s player id', () => {
        const { sendAction } = renderPlayfield({ snapshot: twoSeatSnapshot() });

        fireInput('game:p2-move-right', true);

        expect(sendAction).toHaveBeenCalledWith({
            type: ACTION_SET_VELOCITY_ACTION,
            playerId: P2,
            tick: 12,
            payload: { dx: 1, dy: 0 },
        });
    });

    it('still stamps an arrow velocity with the viewer’s own id', () => {
        const { sendAction } = renderPlayfield({ snapshot: twoSeatSnapshot() });

        fireInput('game:move-left', true);

        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ playerId: P1, payload: { dx: -1, dy: 0 } }),
        );
    });

    it('keeps the two seats’ held sets apart', () => {
        // One shared held set would fold the second player's key into the first
        // player's velocity — both primitives would move as one.
        const { sendAction } = renderPlayfield({ snapshot: twoSeatSnapshot() });

        fireInput('game:move-right', true);
        sendAction.mockClear();
        fireInput('game:p2-move-up', true);

        expect(sendAction).toHaveBeenCalledTimes(1);
        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ playerId: P2, payload: { dx: 0, dy: -1 } }),
        );
    });

    it('drives no second seat for a joined (non-host) viewer', () => {
        const { sendAction } = renderPlayfield({ snapshot: twoSeatSnapshot(), isHost: false });

        expect([...subscribers.keys()].sort()).toEqual([...ACTION_MOVE_ACTION_IDS].sort());
        fireInput('game:p2-move-right', true);
        expect(sendAction).not.toHaveBeenCalled();
    });

    it('names only the arrow keys in the hint while the match is solo', () => {
        // A solo match has no second seat to announce: telling one player
        // about player 2's keys is an instruction they cannot follow.
        renderPlayfield();

        const hint = screen.getByText(/arrow keys/iu);
        expect(hint.textContent).not.toMatch(/wasd/iu);
    });

    it('names BOTH clusters in the hint once a second seat is declared', () => {
        renderPlayfield({ snapshot: twoSeatSnapshot() });

        const hint = screen.getByText(/arrow keys/iu);
        expect(hint.textContent).toMatch(/wasd/iu);
        expect(hint.textContent).toMatch(/player 2/iu);
    });

    it('selects for the VIEWER when a primitive is clicked, never for the second seat', () => {
        const { sendAction } = renderPlayfield({ snapshot: twoSeatSnapshot() });

        screen.getByTestId('action-primitive-primitive-sphere').click();

        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ type: ACTION_SELECT_PRIMITIVE_ACTION, playerId: P1 }),
        );
    });
});
