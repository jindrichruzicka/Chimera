// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShellState, setShellDraft } from '@chimera-engine/renderer/game';

import { ACTION_PRIMITIVE_SEEDS } from '../simulation/constants.js';
import { actionShellAudioRefs } from '../shell-asset-manifest.js';
import { ACTION_SHELL_CAMERA_HOME, actionShellCameraView } from './actionShellCamera.js';
import { ActionShellBackground } from './ActionShellBackground';

// ── The engine seams this background stands on ───────────────────────────────
//
// Only `GameCanvas` is exported from the r3f mock: the engine mounts
// `FrameRateLimiter` itself, so if this component ever reaches for one the
// import resolves `undefined` and every render here crashes red.
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
            <div data-testid="action-shell-canvas">
                {React.Children.toArray(children).filter(
                    (child) => React.isValidElement(child) && typeof child.type !== 'string',
                )}
            </div>
        );
    },
}));

const playSelect = vi.hoisted(() => vi.fn());
const soundRefs = vi.hoisted((): unknown[] => []);

vi.mock('@chimera-engine/renderer/audio', () => ({
    useSound: (ref: unknown) => {
        soundRefs.push(ref);
        return playSelect;
    },
}));

const rigProps = vi.hoisted((): { readonly focusX: number }[] => []);

vi.mock('./ActionShellCameraRig.js', () => ({
    ActionShellCameraRig: ({ focusX }: { readonly focusX: number }) => {
        rigProps.push({ focusX });
        return null;
    },
}));

vi.mock('../components/ActionGroundPlane.js', () => ({
    ActionGroundPlane: ({
        ground,
    }: {
        readonly ground: { readonly widthCells: number; readonly depthCells: number };
    }) => (
        <div
            data-testid="action-shell-ground"
            data-width={String(ground.widthCells)}
            data-depth={String(ground.depthCells)}
        />
    ),
}));

vi.mock('../components/ActionPrimitiveMesh.js', () => ({
    ActionPrimitiveMesh: ({
        primitive,
        isControlled,
        onSelect,
    }: {
        readonly primitive: { readonly id: string; readonly shape: string };
        readonly isControlled: boolean;
        readonly onSelect: (entityId: string) => void;
    }) => (
        <button
            type="button"
            data-testid={`action-shell-primitive-${primitive.shape}`}
            data-controlled={String(isControlled)}
            onClick={() => {
                onSelect(primitive.id);
            }}
        >
            {primitive.shape}
        </button>
    ),
}));

vi.mock('../components/ActionSelectionRing.js', () => ({
    ActionSelectionRing: ({
        at,
        seat,
    }: {
        readonly at: readonly [number, number, number];
        readonly seat: string;
    }) => <div data-testid={`action-shell-ring-${seat}`} data-at={at.join(',')} />,
}));

/** Clear both draft fields this component reads, so each case starts empty. */
function resetDraft(): void {
    setShellDraft({ hostAttributes: {}, localSeats: [] });
}

beforeEach(() => {
    gameCanvasCalls.length = 0;
    rigProps.length = 0;
    soundRefs.length = 0;
    resetDraft();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetDraft();
});

/** Arena X of the seeded primitive of `shape` — where the dolly should aim. */
function seedX(shape: string): number {
    const seed = ACTION_PRIMITIVE_SEEDS.find((candidate) => candidate.shape === shape);
    if (seed === undefined) throw new Error(`no seed for ${shape}`);
    return seed.x;
}

describe('ActionShellBackground — the scene', () => {
    it('mounts exactly one OVERLAY-role canvas', () => {
        // `main` would take the perf probe from the match canvas and claim the
        // main-canvas registration on a menu route.
        render(<ActionShellBackground />);

        expect(gameCanvasCalls).toHaveLength(1);
        expect(gameCanvasCalls[0]?.role).toBe('overlay');
    });

    it('constructs the canvas at the HOME view, so the first frame is already framed', () => {
        // The rig re-places the camera from its first frame onward, so a
        // mis-authored config here does not stay wrong for long — it stays
        // wrong for the frames before the loop runs, which is exactly the snap
        // the constant exists to avoid. The rig's own tests cannot cover it:
        // they mount the rig directly and never see this object.
        render(<ActionShellBackground />);

        const home = actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 0);
        expect(gameCanvasCalls[0]?.camera).toEqual({
            mode: 'perspective',
            position: home.position,
            lookAt: home.lookAt,
            fov: 45,
        });
    });

    it('hands the canvas the SAME camera object on a re-render', () => {
        // `GameCanvas` memoises the camera instance on this object's identity; a
        // fresh literal per render would rebuild the camera on every ring move.
        const { rerender } = render(<ActionShellBackground />);
        rerender(<ActionShellBackground />);

        expect(gameCanvasCalls).toHaveLength(2);
        expect(gameCanvasCalls[0]?.camera).toBe(gameCanvasCalls[1]?.camera);
    });

    it('mounts the ground plane and one primitive per seed', () => {
        render(<ActionShellBackground />);

        expect(screen.getByTestId('action-shell-ground')).toBeInTheDocument();
        for (const seed of ACTION_PRIMITIVE_SEEDS) {
            expect(
                screen.getByTestId(`action-shell-primitive-${seed.shape}`),
                seed.shape,
            ).toBeInTheDocument();
        }
    });

    it('gives the host element a stable test id', () => {
        render(<ActionShellBackground />);

        expect(screen.getByTestId('action-shell-background')).toBeInTheDocument();
    });
});

describe('ActionShellBackground — the rings', () => {
    it('rings the default pick when the draft names none', () => {
        render(<ActionShellBackground />);

        expect(screen.getByTestId('action-shell-ring-host')).toHaveAttribute(
            'data-at',
            `${String(seedX('cube'))},0.5,0`,
        );
        expect(screen.queryByTestId('action-shell-ring-second')).not.toBeInTheDocument();
    });

    it('moves the host ring onto the shape the draft names', () => {
        setShellDraft({ hostAttributes: { primitive: 'cone' } });

        render(<ActionShellBackground />);

        expect(screen.getByTestId('action-shell-ring-host')).toHaveAttribute(
            'data-at',
            `${String(seedX('cone'))},0.5,0`,
        );
    });

    it('marks only the host’s own primitive as controlled', () => {
        setShellDraft({ hostAttributes: { primitive: 'sphere' } });

        render(<ActionShellBackground />);

        expect(screen.getByTestId('action-shell-primitive-sphere')).toHaveAttribute(
            'data-controlled',
            'true',
        );
        expect(screen.getByTestId('action-shell-primitive-cube')).toHaveAttribute(
            'data-controlled',
            'false',
        );
    });

    it('draws the SECOND ring once the draft opens a local seat', () => {
        setShellDraft({
            hostAttributes: { primitive: 'cube' },
            localSeats: [{ attributes: { primitive: 'cone', control: 'wasd' } }],
        });

        render(<ActionShellBackground />);

        expect(screen.getByTestId('action-shell-ring-second')).toHaveAttribute(
            'data-at',
            `${String(seedX('cone'))},0.5,0`,
        );
    });

    it('re-renders the ring when the draft changes AFTER mount', () => {
        // The page writes the draft from its own route while this background
        // stays mounted; a background that read the draft once would keep
        // showing the pick the player made before the hop.
        render(<ActionShellBackground />);

        act(() => {
            setShellDraft({ hostAttributes: { primitive: 'cone' } });
        });

        expect(screen.getByTestId('action-shell-ring-host')).toHaveAttribute(
            'data-at',
            `${String(seedX('cone'))},0.5,0`,
        );
    });
});

describe('ActionShellBackground — the click', () => {
    it('moves the HOST pick and sounds the blip', () => {
        render(<ActionShellBackground />);

        screen.getByTestId('action-shell-primitive-cone').click();

        expect(getShellState().draft.hostAttributes?.['primitive']).toBe('cone');
        expect(playSelect).toHaveBeenCalledTimes(1);
    });

    it('attributes the click to the host seat, never to the second one', () => {
        setShellDraft({
            hostAttributes: { primitive: 'cube' },
            localSeats: [{ attributes: { primitive: 'sphere', control: 'wasd' } }],
        });
        render(<ActionShellBackground />);

        screen.getByTestId('action-shell-primitive-cone').click();

        expect(getShellState().draft.hostAttributes?.['primitive']).toBe('cone');
        expect(getShellState().draft.localSeats?.[0]?.attributes?.['primitive']).toBe('sphere');
    });

    it('writes nothing and sounds nothing when the click changes no pick', () => {
        // A blip on a click that moved no ring reads as a bug: the player hears
        // a confirmation for something that did not happen.
        render(<ActionShellBackground />);

        screen.getByTestId('action-shell-primitive-cube').click();

        expect(playSelect).not.toHaveBeenCalled();
    });

    it('refuses the primitive the SECOND seat holds', () => {
        setShellDraft({
            hostAttributes: { primitive: 'cube' },
            localSeats: [{ attributes: { primitive: 'cone', control: 'wasd' } }],
        });
        render(<ActionShellBackground />);

        screen.getByTestId('action-shell-primitive-cone').click();

        expect(getShellState().draft.hostAttributes?.['primitive']).toBe('cube');
        expect(playSelect).not.toHaveBeenCalled();
    });

    it('reads the draft at CLICK time, not at the render that built the handler', () => {
        // The second seat's pick comes from the page's own WASD keys while this
        // background is mounted. A captured draft would let a click take a shape
        // the other seat had just claimed.
        render(<ActionShellBackground />);

        setShellDraft({ localSeats: [{ attributes: { primitive: 'cone', control: 'wasd' } }] });
        screen.getByTestId('action-shell-primitive-cone').click();

        expect(getShellState().draft.hostAttributes?.['primitive']).not.toBe('cone');
    });

    it('plays the blip declared in the shell audio manifest', () => {
        render(<ActionShellBackground />);

        expect(soundRefs).toContain(actionShellAudioRefs.select);
    });
});

describe('ActionShellBackground — the camera rig', () => {
    it('aims the dolly at the DRAFTED primitive’s cell', () => {
        setShellDraft({ hostAttributes: { primitive: 'cone' } });

        render(<ActionShellBackground />);

        expect(rigProps.at(-1)?.focusX).toBe(seedX('cone'));
    });

    it('re-aims the dolly when the pick moves', () => {
        render(<ActionShellBackground />);
        expect(rigProps.at(-1)?.focusX).toBe(seedX('cube'));

        act(() => {
            setShellDraft({ hostAttributes: { primitive: 'sphere' } });
        });

        expect(rigProps.at(-1)?.focusX).toBe(seedX('sphere'));
    });
});
