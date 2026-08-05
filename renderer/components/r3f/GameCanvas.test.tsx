// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { Canvas } from '@react-three/fiber';
import { GameCanvas } from './GameCanvas';
import type { CameraPreset, OrthographicCameraConfig, PerspectiveCameraConfig } from './GameCanvas';
import { useSettingsStore } from '../../state/settingsStore';

const perfProbeSpy = vi.hoisted(() => vi.fn());

vi.mock('../shell/perf/PerfProbe', () => ({
    PerfProbe: () => {
        perfProbeSpy();
        return null;
    },
}));

// `useThree` is mocked because the real FrameRateLimiter mounts inside the
// canvas and reads the store-bound `advance` / `frameloop` / `clock` from it.
// This tree has no R3F root, so the stand-in Canvas applies the `frameloop` prop
// it is given to the stand-in root state before rendering children — R3F awaits
// `configure()` before `root.render(children)`, so a child does observe the
// prop's final value — or the two halves of the cap would be wired to each
// other only in production. What this stand-in does NOT model is the two-root
// interleaving on a runtime cap change, where the limiter re-renders on its own
// settings subscription before the canvas is reconfigured; that ordering is
// driven directly in FrameRateLimiter.test.tsx.
const fiberMock = vi.hoisted(() => {
    const rootState = {
        advance: vi.fn(),
        frameloop: 'always' as string,
        clock: { elapsedTime: 0, oldTime: 0 },
    };
    return {
        rootState,
        useThree: vi.fn((selector: (state: typeof rootState) => unknown) => selector(rootState)),
    };
});

vi.mock('@react-three/fiber', () => ({
    Canvas: vi.fn(
        ({
            children,
            frameloop,
        }: {
            readonly children?: ReactNode;
            readonly frameloop?: string;
        }) => {
            fiberMock.rootState.frameloop = frameloop ?? 'always';
            return <div data-testid="r3f-canvas">{children}</div>;
        },
    ),
    useThree: fiberMock.useThree,
}));

type ExpectedCameraPreset = Readonly<{
    instance: typeof OrthographicCamera | typeof PerspectiveCamera;
    position: readonly [number, number, number];
    lookAt: readonly [number, number, number];
}>;

// Presets carry their documented projection mode (camera-system.md preset table).
const expectedPresets = {
    isometric: { instance: OrthographicCamera, position: [10, 10, 10], lookAt: [0, 0, 0] },
    'top-down': { instance: OrthographicCamera, position: [0, 20, 0], lookAt: [0, 0, 0] },
    'side-scrolling': { instance: PerspectiveCamera, position: [0, 5, 15], lookAt: [0, 5, 0] },
    free: { instance: PerspectiveCamera, position: [0, 5, 10], lookAt: [0, 0, 0] },
} satisfies Record<CameraPreset, ExpectedCameraPreset>;

let logEmit: ReturnType<typeof vi.fn>;
let rafCallbacks: Map<number, (timestamp: number) => void>;
let nextRafHandle: number;

beforeEach(() => {
    fiberMock.rootState.frameloop = 'always';
    logEmit = vi.fn();
    vi.stubGlobal('__chimera', { logs: { emit: logEmit } });
    // The limiter drives a real rAF chain under a capped canvas, and defers its
    // wiring report by a frame. Keep both off jsdom's timer-backed rAF so
    // nothing outlives the test and the deferred report is flushable here.
    rafCallbacks = new Map();
    nextRafHandle = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => void): number => {
        const handle = nextRafHandle++;
        rafCallbacks.set(handle, callback);
        return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
        rafCallbacks.delete(handle);
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

/** Fire one frame, which is what a deferred wiring report waits for. */
function flushFrame(): void {
    const due = [...rafCallbacks.values()];
    rafCallbacks.clear();
    for (const callback of due) {
        callback(0);
    }
}

/** Error-level entries the renderer log bridge received. */
function loggedErrors(): { level: string }[] {
    return logEmit.mock.calls
        .map((call) => call[0] as { level: string })
        .filter((entry) => entry.level === 'error');
}

/** Names of the error-level entries, in emission order. */
function loggedErrorNames(): (string | undefined)[] {
    return logEmit.mock.calls
        .map((call) => call[0] as { level: string; error?: { name?: string } })
        .filter((entry) => entry.level === 'error')
        .map((entry) => entry.error?.name);
}

function setTargetFps(targetFps: 30 | 60 | 120 | 0): void {
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { display: { targetFps } } },
    } as never);
}

describe('GameCanvas', () => {
    it.each(Object.entries(expectedPresets))(
        'renders %s and initializes the preset camera in its documented mode',
        (cameraPreset, expected) => {
            render(
                <GameCanvas camera={cameraPreset as CameraPreset}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera();

            expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
            expect(camera).toBeInstanceOf(expected.instance);
            expect(camera.position.toArray()).toEqual(expected.position);
            expect(camera.up.toArray()).toEqual([0, 1, 0]);
            expectVectorToBeClose(
                cameraDirection(camera),
                expectedDirection(expected.position, expected.lookAt),
            );
        },
    );

    it.each(['isometric', 'top-down'] as const)(
        'marks the %s preset camera manual with the default world-unit frustum',
        (cameraPreset) => {
            render(
                <GameCanvas camera={cameraPreset}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera() as OrthographicCamera & { manual?: boolean };

            // An author/preset frustum must survive canvas resizes: without
            // `manual`, R3F rewrites ortho frusta to pixel half-extents.
            expect(camera.manual).toBe(true);
            expect(camera.left).toBe(-10);
            expect(camera.right).toBe(10);
            expect(camera.top).toBe(10);
            expect(camera.bottom).toBe(-10);
            expect(camera.near).toBe(0.1);
            expect(camera.far).toBe(1000);
        },
    );

    it.each(['side-scrolling', 'free'] as const)(
        'leaves the %s preset camera non-manual so R3F keeps the aspect responsive',
        (cameraPreset) => {
            render(
                <GameCanvas camera={cameraPreset}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera() as PerspectiveCamera & { manual?: boolean };

            expect(camera.manual).toBeUndefined();
            expect(camera.fov).toBe(50);
            expect(camera.near).toBe(0.1);
            expect(camera.far).toBe(1000);
        },
    );

    it('forwards className to the Canvas and leaves it undefined when absent', () => {
        const { rerender } = render(
            <GameCanvas camera="free" className="game-surface">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasProps().className).toBe('game-surface');

        rerender(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        // The forwarded value stays `undefined` — no default or override class
        // is synthesized for the r3f wrapper <div> when the game passes
        // nothing. (The key itself is still emitted; `@types/react` accepts
        // `string | undefined`, which is why className needs no conditional
        // spread.)
        expect(latestCanvasProps().className).toBeUndefined();
    });

    it('forwards onPointerMissed and the canvas invokes the game handler', () => {
        const onPointerMissed = vi.fn();

        render(
            <GameCanvas camera="free" onPointerMissed={onPointerMissed}>
                <mesh />
            </GameCanvas>,
        );

        const forwarded = latestCanvasProps().onPointerMissed;
        if (typeof forwarded !== 'function') {
            throw new Error('Expected GameCanvas to forward onPointerMissed to Canvas');
        }
        const missEvent = new MouseEvent('click');
        forwarded(missEvent);

        expect(onPointerMissed).toHaveBeenCalledTimes(1);
        expect(onPointerMissed).toHaveBeenCalledWith(missEvent);
    });

    it('leaves onPointerMissed undefined when the game passes none', () => {
        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasProps().onPointerMissed).toBeUndefined();
    });

    it('rejects r3f CanvasProps pass-through keys at the type level', () => {
        // GameCanvasProps is curated by construction — no CanvasProps
        // rest-spread — so every r3f key below is an excess property at a
        // literal call site. The @ts-expect-error lines ARE the assertions:
        // typecheck fails the moment any key becomes accepted. One pin per key
        // so widening by a single key kills a named line.
        void (
            <GameCanvas
                camera="free"
                // @ts-expect-error: gl is not a curated GameCanvas prop
                gl={{ antialias: true }}
            >
                <mesh />
            </GameCanvas>
        );
        void (
            <GameCanvas
                camera="free"
                // @ts-expect-error: dpr is not a curated GameCanvas prop
                dpr={2}
            >
                <mesh />
            </GameCanvas>
        );
        void (
            <GameCanvas
                camera="free"
                // @ts-expect-error: shadows is not a curated GameCanvas prop
                shadows
            >
                <mesh />
            </GameCanvas>
        );
        void (
            <GameCanvas
                camera="free"
                // @ts-expect-error: style is withheld — className + module CSS only
                style={{ width: '100%' }}
            >
                <mesh />
            </GameCanvas>
        );
        void (
            <GameCanvas
                camera="free"
                // @ts-expect-error: frameloop is engine-owned and non-overridable
                frameloop="demand"
            >
                <mesh />
            </GameCanvas>
        );
        void (
            <GameCanvas
                // @ts-expect-error: camera takes a GameCanvasCamera, not a THREE instance
                camera={new PerspectiveCamera()}
            >
                <mesh />
            </GameCanvas>
        );
    });

    it('mounts one PerfProbe inside the R3F canvas root', () => {
        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        expect(perfProbeSpy).toHaveBeenCalledTimes(1);
    });

    it('mounts a PerfProbe under an explicit role="main"', () => {
        render(
            <GameCanvas camera="free" role="main">
                <mesh />
            </GameCanvas>,
        );

        expect(perfProbeSpy).toHaveBeenCalledTimes(1);
    });

    it('mounts no PerfProbe but keeps the limiter and children under role="overlay"', () => {
        setTargetFps(60);

        render(
            <GameCanvas camera="free" role="overlay">
                <mesh />
            </GameCanvas>,
        );

        expect(perfProbeSpy).not.toHaveBeenCalled();
        // Root-state reads prove the limiter mounted (see the limiter test
        // for why that inference holds).
        expect(fiberMock.useThree).toHaveBeenCalled();
        expect(fiberMock.rootState.advance).toHaveBeenCalled();
        expect(screen.getByTestId('r3f-canvas').querySelector('mesh')).not.toBeNull();
    });

    it.each([30, 60, 120] as const)(
        'paces an overlay canvas with frameloop never at a %i fps cap',
        (targetFps) => {
            setTargetFps(targetFps);

            render(
                <GameCanvas camera="free" role="overlay">
                    <mesh />
                </GameCanvas>,
            );

            expect(latestCanvasFrameloop()).toBe('never');
        },
    );

    it('reports two concurrently-mounted mains exactly once, by name', () => {
        render(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
                <GameCanvas camera="free" role="main">
                    <mesh />
                </GameCanvas>
            </>,
        );
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMainGameCanvasError']);
    });

    it('never reports a main plus an overlay', () => {
        render(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
                <GameCanvas camera="free" role="overlay">
                    <mesh />
                </GameCanvas>
            </>,
        );
        flushFrame();

        expect(loggedErrors()).toHaveLength(0);
    });

    it('never reports a StrictMode-root remount of a single main', () => {
        render(
            <React.StrictMode>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
            </React.StrictMode>,
        );
        flushFrame();

        expect(loggedErrors()).toHaveLength(0);
    });

    it('cancels the pending report when one of two mains unmounts before it fires', () => {
        const { rerender } = render(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
            </>,
        );

        rerender(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
            </>,
        );
        flushFrame();

        expect(loggedErrors()).toHaveLength(0);
    });

    it('releases the slot of a main flipped to overlay before the report fires', () => {
        const { rerender } = render(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
            </>,
        );

        rerender(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
                <GameCanvas camera="free" role="overlay">
                    <mesh />
                </GameCanvas>
            </>,
        );
        flushFrame();

        expect(loggedErrors()).toHaveLength(0);
    });

    it('counts an overlay flipped to main beside an existing main', () => {
        const { rerender } = render(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
                <GameCanvas camera="free" role="overlay">
                    <mesh />
                </GameCanvas>
            </>,
        );

        rerender(
            <>
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>
                <GameCanvas camera="free" role="main">
                    <mesh />
                </GameCanvas>
            </>,
        );
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMainGameCanvasError']);
    });

    it('frees the main slot on unmount so a later main mounts cleanly', () => {
        const first = render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );
        first.unmount();

        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );
        flushFrame();

        expect(loggedErrors()).toHaveLength(0);
    });

    it('mounts the FrameRateLimiter and the capped prop reaches it', () => {
        setTargetFps(60);

        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        // PerfProbe is mocked out, so the limiter is the only child that reads
        // the R3F root state — dropping it from GameCanvas leaves this at zero.
        expect(fiberMock.useThree).toHaveBeenCalled();
        // Both halves connected: the prop put the canvas on 'never' and the
        // driver took over, presenting the eager first frame.
        expect(fiberMock.rootState.advance).toHaveBeenCalled();
    });

    it('leaves the FrameRateLimiter idle when the uncapped prop reaches it', () => {
        setTargetFps(0);

        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        expect(fiberMock.useThree).toHaveBeenCalled();
        expect(fiberMock.rootState.advance).not.toHaveBeenCalled();
    });

    it.each([0, 30, 60, 120] as const)(
        'never reports a frameloop-wiring error at %i fps',
        (targetFps) => {
            setTargetFps(targetFps);

            render(
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>,
            );
            flushFrame();

            expect(loggedErrors()).toHaveLength(0);
        },
    );

    it.each([30, 60, 120] as const)('passes frameloop never at a %i fps cap', (targetFps) => {
        setTargetFps(targetFps);

        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        // The PROP, not an internal setFrameloop call: CanvasImpl re-applies
        // `frameloop` on every Canvas render, clobbering any internally-set
        // value.
        expect(latestCanvasFrameloop()).toBe('never');
    });

    it('passes frameloop always at targetFps 0 so the uncapped path is untouched', () => {
        setTargetFps(0);

        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasFrameloop()).toBe('always');
    });

    it('passes frameloop always when settings are not yet hydrated', () => {
        render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasFrameloop()).toBe('always');
    });

    it.each([
        [120, 0, 'never', 'always'],
        [0, 30, 'always', 'never'],
    ] as const)('flips the prop from %i to %i fps on re-render', (from, to, before, after) => {
        setTargetFps(from);
        const { rerender } = render(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );
        expect(latestCanvasFrameloop()).toBe(before);

        setTargetFps(to);
        rerender(
            <GameCanvas camera="free">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasFrameloop()).toBe(after);
        // A runtime cap change on a wired canvas must not read as a mis-wiring.
        flushFrame();
        expect(loggedErrors()).toHaveLength(0);
    });

    it.each([
        [120, 0, 'never', 'always'],
        [0, 30, 'always', 'never'],
    ] as const)(
        'flips the prop from %i to %i fps on a store change alone',
        (from, to, before, after) => {
            setTargetFps(from);
            render(
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>,
            );
            expect(latestCanvasFrameloop()).toBe(before);

            // `settingsStore` changes with no re-render from above, so the prop
            // must follow the store on its own or the cap silently stops
            // matching the setting.
            act(() => {
                setTargetFps(to);
            });

            expect(latestCanvasFrameloop()).toBe(after);
            flushFrame();
            expect(loggedErrors()).toHaveLength(0);
        },
    );

    it('builds a perspective camera from an explicit config', () => {
        const config: PerspectiveCameraConfig = {
            mode: 'perspective',
            position: [5, 8, 3],
            lookAt: [1, 2, 3],
            fov: 75,
            near: 0.5,
            far: 500,
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as PerspectiveCamera & { manual?: boolean };

        expect(camera).toBeInstanceOf(PerspectiveCamera);
        expect(camera.fov).toBe(75);
        expect(camera.near).toBe(0.5);
        expect(camera.far).toBe(500);
        expect(camera.manual).toBeUndefined();
        expect(camera.position.toArray()).toEqual([5, 8, 3]);
        expectVectorToBeClose(cameraDirection(camera), expectedDirection([5, 8, 3], [1, 2, 3]));
    });

    it('pins the aspect ratio and marks the camera manual when aspect is set', () => {
        const config: PerspectiveCameraConfig = {
            mode: 'perspective',
            position: [0, 5, 10],
            lookAt: [0, 0, 0],
            aspect: 1.5,
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as PerspectiveCamera & { manual?: boolean };

        expect(camera.aspect).toBe(1.5);
        expect(camera.manual).toBe(true);
    });

    it('builds a manual orthographic camera from an explicit frustum', () => {
        const config: OrthographicCameraConfig = {
            mode: 'orthographic',
            position: [0, 20, 0],
            lookAt: [0, 0, 0],
            frustum: { left: -20, right: 20, top: 15, bottom: -15 },
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera & { manual?: boolean };

        expect(camera).toBeInstanceOf(OrthographicCamera);
        expect(camera.manual).toBe(true);
        expect(camera.left).toBe(-20);
        expect(camera.right).toBe(20);
        expect(camera.top).toBe(15);
        expect(camera.bottom).toBe(-15);
        // near/far fall back to the defaults when the frustum omits them.
        expect(camera.near).toBe(0.1);
        expect(camera.far).toBe(1000);
    });

    it('applies a custom up vector', () => {
        const config: OrthographicCameraConfig = {
            mode: 'orthographic',
            position: [1, 12, 0],
            lookAt: [1, 0, 0],
            up: [0, 0, 1],
            frustum: { left: -3.75, right: 3.75, top: 2.5, bottom: -2.5, near: 0.1, far: 100 },
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasCamera().up.toArray()).toEqual([0, 0, 1]);
    });

    it('reproduces the tactics board camera matrices exactly', () => {
        // The tactics e2e page object mirrors this projection for pixel-space
        // clicks, so the declarative config must yield the same matrices as the
        // imperative sequence the board used to run. `up` before `lookAt` is
        // load-bearing: this view direction (0,-1,0) is degenerate against the
        // default up vector.
        const config: OrthographicCameraConfig = {
            mode: 'orthographic',
            position: [1, 12, 0],
            lookAt: [1, 0, 0],
            up: [0, 0, 1],
            frustum: { left: -3.75, right: 3.75, top: 2.5, bottom: -2.5, near: 0.1, far: 100 },
        };

        const reference = new OrthographicCamera(-3.75, 3.75, 2.5, -2.5, 0.1, 100);
        reference.up.set(0, 0, 1);
        reference.position.set(1, 12, 0);
        reference.lookAt(new Vector3(1, 0, 0));
        reference.updateProjectionMatrix();
        reference.updateMatrixWorld();

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera & { manual?: boolean };

        expect(camera.manual).toBe(true);
        expect(camera.projectionMatrix.toArray()).toEqual(reference.projectionMatrix.toArray());
        expect(camera.matrixWorld.toArray()).toEqual(reference.matrixWorld.toArray());
    });
});

function latestCanvasProps(): Readonly<{
    camera?: unknown;
    frameloop?: unknown;
    className?: unknown;
    onPointerMissed?: unknown;
}> {
    const lastCall = vi.mocked(Canvas).mock.calls.at(-1);
    if (!lastCall) {
        throw new Error('Expected GameCanvas to render R3F Canvas');
    }

    return lastCall[0];
}

function latestCanvasFrameloop(): unknown {
    return latestCanvasProps().frameloop;
}

function latestCanvasCamera(): PerspectiveCamera | OrthographicCamera {
    const camera = latestCanvasProps().camera;
    if (!(camera instanceof PerspectiveCamera) && !(camera instanceof OrthographicCamera)) {
        throw new Error('Expected GameCanvas to pass an initialized camera to Canvas');
    }

    return camera;
}

function cameraDirection(camera: PerspectiveCamera | OrthographicCamera): number[] {
    return roundVector(camera.getWorldDirection(new Vector3()).toArray());
}

function expectedDirection(
    position: readonly [number, number, number],
    lookAt: readonly [number, number, number],
): number[] {
    return roundVector(
        new Vector3(...lookAt)
            .sub(new Vector3(...position))
            .normalize()
            .toArray(),
    );
}

function roundVector(vector: readonly number[]): number[] {
    return vector.map((value) => Number(value.toFixed(6)));
}

function expectVectorToBeClose(actual: readonly number[], expected: readonly number[]): void {
    expect(actual).toHaveLength(expected.length);

    actual.forEach((value, index) => {
        expect(value).toBeCloseTo(expected[index] ?? 0, 3);
    });
}
