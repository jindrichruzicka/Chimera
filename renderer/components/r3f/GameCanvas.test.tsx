// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { Canvas } from '@react-three/fiber';
import { GameCanvas } from './GameCanvas';
import type {
    CameraFit,
    CameraPreset,
    OrthographicCameraConfig,
    PerspectiveCameraConfig,
} from './GameCanvas';
import { useSettingsStore } from '../../state/settingsStore';
import { useGameStore } from '../../state/gameStore';
import { useInteractionContext } from './InteractionBlocker';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import type { SceneId } from '@chimera-engine/simulation/foundation/engine-contract.js';

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
        // The size R3F measures on the 100%/100% inner div inside its wrapper —
        // so, the box GameCanvas pins for a letterbox — and the camera it puts
        // on root state, which is the instance handed to the `camera` prop.
        size: { width: 0, height: 0 },
        camera: null as unknown,
    };
    // Stands in for a camera a game installs from inside the canvas (a
    // `makeDefault` control): R3F then reports THAT on root state, not the
    // instance handed to the `camera` prop.
    const installedCamera: { current: unknown } = { current: null };

    return {
        rootState,
        installedCamera,
        useThree: vi.fn((selector: (state: typeof rootState) => unknown) => selector(rootState)),
    };
});

vi.mock('@react-three/fiber', () => ({
    Canvas: vi.fn(
        ({
            children,
            frameloop,
            camera,
        }: {
            readonly children?: ReactNode;
            readonly frameloop?: string;
            readonly camera?: unknown;
        }) => {
            fiberMock.rootState.frameloop = frameloop ?? 'always';
            fiberMock.rootState.camera = fiberMock.installedCamera.current ?? camera;
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

/**
 * Drives the fit policy's only environmental input: the measured size of the
 * engine-owned fit frame. jsdom computes no layout, so every `getBoundingClientRect`
 * in the tree reports this box — the frame is the only element GameCanvas measures.
 */
let containerBox: { width: number; height: number };

/** Stand-in ResizeObserver: jsdom has none, and the resize path needs driving. */
class ResizeObserverStub {
    public static instances: ResizeObserverStub[] = [];

    public constructor(private readonly callback: () => void) {
        ResizeObserverStub.instances.push(this);
    }

    /** Elements this observer was subscribed to, in `observe()` order. */
    public readonly observed: Element[] = [];
    public disconnectCalls = 0;

    public observe(target: Element): void {
        this.observed.push(target);
    }

    public disconnect(): void {
        this.disconnectCalls += 1;
    }

    /** Report a container resize to the observer's owner. */
    public fire(): void {
        this.callback();
    }
}

let logEmit: ReturnType<typeof vi.fn>;
let rafCallbacks: Map<number, (timestamp: number) => void>;
let nextRafHandle: number;

beforeEach(() => {
    fiberMock.rootState.frameloop = 'always';
    fiberMock.rootState.size = { width: 0, height: 0 };
    fiberMock.rootState.camera = null;
    fiberMock.installedCamera.current = null;
    // Zero by default: an unmeasured frame has nothing to fit, so a test that
    // sets no box exercises r3f's own 100%/100% sizing.
    containerBox = { width: 0, height: 0 };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: containerBox.width,
        height: containerBox.height,
        right: containerBox.width,
        bottom: containerBox.height,
        toJSON: () => ({}),
    }));
    ResizeObserverStub.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
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
            // 20 x 12.5 world units — aspect 1.6. A square preset frustum was
            // stretched on every display that exists; 16:10 is a shape real
            // monitors have, and the default `letterbox` fit renders it at
            // exactly that shape on the ones that do not.
            expect(camera.left).toBe(-10);
            expect(camera.right).toBe(10);
            expect(camera.top).toBe(6.25);
            expect(camera.bottom).toBe(-6.25);
            expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBe(1.6);
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

/** A 3:2 board camera, off-centre like the tactics board's. */
const BOARD_FRUSTUM = { left: -2.75, right: 4.75, top: 2.5, bottom: -2.5 } as const;

function boardCamera(fit?: CameraFit): OrthographicCameraConfig {
    return {
        mode: 'orthographic',
        position: [1, 12, 0],
        lookAt: [1, 0, 0],
        up: [0, 0, 1],
        frustum: BOARD_FRUSTUM,
        ...(fit === undefined ? {} : { fit }),
    };
}

/** The same viewpoint at a 2:1 frustum — a DIFFERENT aspect, same container. */
const WIDE_BOARD_CAMERA: OrthographicCameraConfig = {
    mode: 'orthographic',
    position: [1, 12, 0],
    lookAt: [1, 0, 0],
    up: [0, 0, 1],
    frustum: { left: -4, right: 6, top: 2.5, bottom: -2.5 },
};

const BOARD_CAMERA = boardCamera();
const STRETCHED_BOARD_CAMERA = boardCamera('stretch');
const EXPANDING_BOARD_CAMERA = boardCamera('expand');

/** A second `expand` camera with DIFFERENT authored bounds, same viewpoint. */
const EXPANDING_WIDE_CAMERA: OrthographicCameraConfig = {
    mode: 'orthographic',
    position: [1, 12, 0],
    lookAt: [1, 0, 0],
    up: [0, 0, 1],
    frustum: { left: -4, right: 6, top: 2.5, bottom: -2.5 },
    fit: 'expand',
};

/**
 * Reads the canvas tree from a layout effect mounted inside the `<Canvas>`.
 *
 * A child's layout effect runs after that of a SIBLING rendered before it, so
 * this separates work `ExpandCameraToCanvas` does before the browser paints
 * from work it would defer to a passive effect.
 */
function LayoutPhaseProbe({ onLayout }: { readonly onLayout: () => void }): null {
    const layout = React.useRef(onLayout);
    layout.current = onLayout;

    React.useLayoutEffect(() => {
        layout.current();
    }, []);

    return null;
}

describe('GameCanvas camera fit policy', () => {
    it('pillarboxes a canvas wider than the camera and paints the remainder', () => {
        containerBox = { width: 1920, height: 1080 };

        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );

        expect(fittedCanvasBox()).toEqual({ width: 1728, height: 1080 });
        // Out of flow with auto margins on both axes: nothing the frame's layout
        // does can re-size the canvas, and the remainder is split evenly. The
        // whole key set is pinned — an extra key is a layout decision nobody
        // wrote down.
        expect(latestCanvasStyle()).toMatchObject({
            position: 'absolute',
            inset: 0,
            margin: 'auto',
        });
        expect(Object.keys(latestCanvasStyle() ?? {}).sort()).toEqual([
            'height',
            'inset',
            'margin',
            'position',
            'width',
        ]);
        expect(fitFrame().style.backgroundColor).toBe('var(--ch-color-scrim)');
    });

    it.each([
        // Pillarbox: the fitted WIDTH is height x aspect and lands fractional.
        ['width', { width: 3000, height: 999 }, 'isometric', { width: 1598.4, height: 999 }, 1.6],
        // Letterbox: 1000 / 1.5 does not terminate.
        [
            'height',
            { width: 1000, height: 1000 },
            BOARD_CAMERA,
            { width: 1000, height: 2000 / 3 },
            1.5,
        ],
    ] as const)(
        'pins a fractional fitted %s unrounded',
        (_axis, measured, camera, expected, aspect) => {
            // A device-pixel-ratio-scaled `getBoundingClientRect` is routinely
            // fractional. Rounding the emitted size to whole pixels would put the
            // canvas off the camera's aspect — the stretch this policy removes.
            containerBox = { ...measured };

            render(
                <GameCanvas camera={camera}>
                    <mesh />
                </GameCanvas>,
            );

            const fitted = fittedCanvasBox();

            expect(fitted).toEqual(expected);
            expect((fitted?.width ?? 0) / (fitted?.height ?? 1)).toBe(aspect);
        },
    );

    it('letterboxes a canvas taller than the camera on the other axis', () => {
        containerBox = { width: 1000, height: 1000 };

        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );

        expect(fittedCanvasBox()).toEqual({ width: 1000, height: 625 });
        expect(fitFrame().style.backgroundColor).toBe('var(--ch-color-scrim)');
    });

    it.each([
        // Letterboxed and not: the scrim is the ONLY key that differs.
        ['a letterboxed frame', { width: 1920, height: 1080 }, ['background-color']],
        ['an exactly-matching frame', { width: 1600, height: 1000 }, []],
    ] as const)(
        'carries r3f wrapper geometry on %s that swallows no pointer events',
        (_label, measured, extraKeys) => {
            containerBox = { ...measured };

            render(
                <GameCanvas camera="isometric" className="game-surface">
                    <mesh />
                </GameCanvas>,
            );

            const frame = fitFrame();

            // `position: relative` is the containing block the fitted canvas is
            // centred in; the 100%/100% fill is what makes the frame stand in
            // for r3f's own wrapper, and losing either dimension collapses the
            // box r3f refuses to mount a scene into.
            expect(frame.style.position).toBe('relative');
            expect(frame.style.width).toBe('100%');
            expect(frame.style.height).toBe('100%');
            // A click on a bar is not absorbed by the engine box; r3f keeps its
            // own wrapper hit-testable.
            expect(frame.style.pointerEvents).toBe('none');
            // The frame is engine-internal: the game's chrome class goes to the
            // r3f wrapper alone, or a border would be drawn around the bars.
            expect(latestCanvasProps().className).toBe('game-surface');
            expect(frame.className).toBe('');
            // Exhaustive — the frame adds no layout mode of its own, which is
            // what leaves an unfitted r3f wrapper to resolve its own size.
            expect(declaredStyleKeys(frame)).toEqual(
                ['height', 'pointer-events', 'position', 'width', ...extraKeys].sort(),
            );
        },
    );

    it('letterboxes a role="overlay" canvas on the same terms as a main one', () => {
        // The policy is role-independent, like the frame-rate cap: a HUD overlay
        // canvas whose wrapper aspect diverges gets bars and a scrim too.
        containerBox = { width: 1920, height: 1080 };

        render(
            <GameCanvas camera="isometric" role="overlay">
                <mesh />
            </GameCanvas>,
        );

        expect(fittedCanvasBox()).toEqual({ width: 1728, height: 1080 });
        expect(fitFrame().style.backgroundColor).toBe('var(--ch-color-scrim)');
    });

    it('leaves the authored frustum untouched while letterboxing', () => {
        containerBox = { width: 1920, height: 1080 };
        // A non-zero canvas size, or a wrongly-mounted expand effect would
        // short-circuit on its own zero guard instead of rewriting the frustum.
        fiberMock.rootState.size = { width: 1920, height: 1080 };

        render(
            <GameCanvas camera={BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        // The letterbox is a DOM box, not a projection edit: the camera still
        // renders exactly the world the game authored.
        expect(frustumOf(latestCanvasCamera() as OrthographicCamera)).toEqual(BOARD_FRUSTUM);
    });

    it('subscribes the fit frame to the resize observer and drops it on unmount', () => {
        containerBox = { width: 1920, height: 1080 };
        const { unmount } = render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );
        const frame = fitFrame();

        expect(ResizeObserverStub.instances).toHaveLength(1);
        expect(ResizeObserverStub.instances[0]?.observed).toEqual([frame]);

        unmount();

        // Every mount subscribes, so every unmount must unsubscribe — StrictMode
        // mounts each canvas twice.
        expect(ResizeObserverStub.instances[0]?.disconnectCalls).toBe(1);
    });

    it('pins the fitted size before the browser paints', () => {
        // `flushSync` runs everything React does before it yields to the
        // browser: the commit, every layout effect, and any re-render those
        // schedule. A fit deferred to a passive effect is still unapplied when
        // it returns — which on screen is one painted frame of stretched canvas.
        containerBox = { width: 1920, height: 1080 };
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        let beforePaint: { readonly width: number; readonly height: number } | null = null;

        act(() => {
            flushSync(() => {
                root.render(
                    <GameCanvas camera="isometric">
                        <mesh />
                    </GameCanvas>,
                );
            });
            beforePaint = fittedCanvasBox();
        });
        act(() => {
            root.unmount();
        });
        host.remove();

        expect(beforePaint).toEqual({ width: 1728, height: 1080 });
    });

    it('keeps one camera instance across a re-render with the same config', () => {
        // The memo is reference-compared, and `ExpandCameraToCanvas` hangs its
        // dependency list off that identity. Rebuilding the camera every render
        // is the failure §4.22's stability note documents.
        containerBox = { width: 1920, height: 1080 };
        const { rerender } = render(
            <GameCanvas camera={BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );
        const first = latestCanvasCamera();

        rerender(
            <GameCanvas camera={BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasCamera()).toBe(first);
    });

    it('builds a new camera when the config changes', () => {
        // The converse: a memo that never re-runs keeps the first camera's
        // position, lookAt, up, mode and frustum for the life of the mount.
        containerBox = { width: 1920, height: 1080 };
        const { rerender } = render(
            <GameCanvas camera={BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );
        const first = latestCanvasCamera();

        rerender(
            <GameCanvas camera={WIDE_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasCamera()).not.toBe(first);
        expect(frustumOf(latestCanvasCamera() as OrthographicCamera)).toEqual(
            WIDE_BOARD_CAMERA.frustum,
        );
    });

    it('fits without a ResizeObserver, for an environment that has none', () => {
        // A scaffolded game's own jsdom component tests reach GameCanvas with no
        // ResizeObserver defined. The layout-effect measurement still runs, so a
        // canvas that never resizes is fitted anyway.
        containerBox = { width: 1920, height: 1080 };
        vi.stubGlobal('ResizeObserver', undefined);

        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );

        expect(fittedCanvasBox()).toEqual({ width: 1728, height: 1080 });
    });

    it('keeps the fitted box when the frame it collapsed reports zero', () => {
        // A pinned canvas is out of flow, so it lends the frame no height. If a
        // game sizes its wrapper by content, the frame the fit collapses is the
        // one being measured — clearing the box on that reading would un-pin the
        // canvas, restore the height, and oscillate on every notification.
        containerBox = { width: 1920, height: 1080 };
        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );
        const rendersBefore = vi.mocked(Canvas).mock.calls.length;

        containerBox = { width: 1920, height: 0 };
        fireResizeObservers();

        expect(fittedCanvasBox()).toEqual({ width: 1728, height: 1080 });
        expect(vi.mocked(Canvas).mock.calls.length).toBe(rendersBefore);
    });

    it('re-renders nothing when a resize notification reports the same box', () => {
        // Browsers deliver a notification on `observe()` and again on any resize
        // that fits to the same box. Handing back a fresh state object each time
        // would re-render GameCanvas — and with it the game's whole scene
        // subtree — for a box that did not move.
        containerBox = { width: 1920, height: 1080 };
        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );
        const rendersBefore = vi.mocked(Canvas).mock.calls.length;

        fireResizeObservers();

        expect(vi.mocked(Canvas).mock.calls.length).toBe(rendersBefore);
    });

    it('re-fits when the container is resized', () => {
        containerBox = { width: 1920, height: 1080 };
        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );
        expect(fittedCanvasBox()).toEqual({ width: 1728, height: 1080 });

        containerBox = { width: 1000, height: 1000 };
        fireResizeObservers();

        expect(fittedCanvasBox()).toEqual({ width: 1000, height: 625 });
    });

    it.each([
        // A taller container fits by width, so both boxes share a width — only a
        // comparison that also reads the height replaces the stale one.
        [
            'width',
            { width: 1000, height: 1000 },
            WIDE_BOARD_CAMERA,
            { width: 1000, height: 625 },
            { width: 1000, height: 500 },
        ],
        // A wider container fits by height, so both boxes share a height.
        [
            'height',
            { width: 1920, height: 1080 },
            BOARD_CAMERA,
            { width: 1728, height: 1080 },
            { width: 1620, height: 1080 },
        ],
    ] as const)(
        're-fits to a new camera aspect at an unchanged container size when the two boxes share a %s',
        (_axis, container, nextCamera, before, after) => {
            containerBox = { ...container };
            const { rerender } = render(
                <GameCanvas camera="isometric">
                    <mesh />
                </GameCanvas>,
            );
            expect(fittedCanvasBox()).toEqual(before);

            rerender(
                <GameCanvas camera={nextCamera}>
                    <mesh />
                </GameCanvas>,
            );

            expect(fittedCanvasBox()).toEqual(after);
        },
    );

    it('drops the fitted box and the scrim when the camera switches to fit stretch', () => {
        containerBox = { width: 1920, height: 1080 };
        const { rerender } = render(
            <GameCanvas camera={BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );
        expect(latestCanvasStyle()).toBeDefined();

        rerender(
            <GameCanvas camera={STRETCHED_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasStyle()).toBeUndefined();
        expect(fitFrame().style.backgroundColor).toBe('');
    });

    it.each([
        ['zero on both axes', { width: 0, height: 0 }],
        ['zero height alone', { width: 1920, height: 0 }],
        ['zero width alone', { width: 0, height: 1080 }],
    ])('applies no fitted size while the frame measures %s', (_label, measured) => {
        // r3f's own 100%/100% sizing stays in place rather than the canvas being
        // pinned to 0, which would stop it mounting its children at all.
        containerBox = measured;

        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasStyle()).toBeUndefined();
        expect(fitFrame().style.backgroundColor).toBe('');
    });

    it('applies no fitted size and no scrim when the frame already has the camera aspect', () => {
        // 1.6 exactly: there are no bars to paint, so the engine pins no size
        // and paints no scrim behind the canvas.
        containerBox = { width: 1600, height: 1000 };

        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );

        expect(latestCanvasStyle()).toBeUndefined();
        expect(fitFrame().style.backgroundColor).toBe('');
    });

    it('grows the frustum short axis to the canvas aspect under fit expand, with no bars', () => {
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };

        render(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera;
        const grownHalfWidth = 2.5 * (1920 / 1080);

        expect(latestCanvasStyle()).toBeUndefined();
        expect(fitFrame().style.backgroundColor).toBe('');
        // 3:2 authored against a 16:9 canvas: the tall axis is the short one, so
        // the frustum widens about its centre (1, 0) and the authored bounds stay
        // fully inside it.
        expect(frustumOf(camera)).toEqual({
            left: 1 - grownHalfWidth,
            right: 1 + grownHalfWidth,
            top: 2.5,
            bottom: -2.5,
        });
        expect(camera.left).toBeLessThan(BOARD_FRUSTUM.left);
        expect(camera.right).toBeGreaterThan(BOARD_FRUSTUM.right);
        // Three renders from the projection MATRIX, never from these fields: an
        // expand that computes the right numbers and rebuilds no matrix is an
        // expand nobody can see.
        expectOrthographicProjection(camera, {
            left: 1 - grownHalfWidth,
            right: 1 + grownHalfWidth,
            top: 2.5,
            bottom: -2.5,
        });
    });

    it.each([
        ['width alone', { width: 1200, height: 1080 }],
        ['height alone', { width: 1920, height: 720 }],
    ])('re-expands when the canvas changes %s', (_label, resized) => {
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };
        const { rerender } = render(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        // One axis at a time — dragging a single window edge is the common case,
        // and a two-axis resize lets either dependency mask the other's absence.
        fiberMock.rootState.size = resized;
        rerender(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera;

        expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(
            resized.width / resized.height,
            10,
        );
    });

    it('expands a newly swapped camera at an unchanged canvas size', () => {
        // A game switching framing mid-scene gets a brand-new camera instance
        // from the config memo; nothing else changes, so only a dependency on
        // the config (or the camera it produces) re-expands it.
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };
        const { rerender } = render(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        rerender(
            <GameCanvas camera={EXPANDING_WIDE_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera;
        const grownHalfHeight = 5 / (1920 / 1080);

        // The new bounds are 2:1 against a 16:9 canvas, so the SHORT axis is now
        // the vertical one and the grow runs the other way. A stale effect would
        // leave the new camera at its authored 2.5 half-height.
        expect(frustumOf(camera)).toEqual({
            left: -4,
            right: 6,
            top: grownHalfHeight,
            bottom: -grownHalfHeight,
        });
        expect(camera.top).toBeGreaterThan(EXPANDING_WIDE_CAMERA.frustum.top);
    });

    it.each([
        ['on mount', false],
        ['when root state swaps it at an unchanged canvas size', true],
    ])('expands the camera r3f reports, %s', (_label, swapAfterMount) => {
        // `expand` writes the camera R3F has on root state, matched by class —
        // which is the instance GameCanvas built until a game installs its own
        // from inside the canvas, and that one afterwards.
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };
        const installed = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
        if (!swapAfterMount) {
            fiberMock.installedCamera.current = installed;
        }
        const { rerender } = render(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        if (swapAfterMount) {
            fiberMock.installedCamera.current = installed;
            rerender(
                <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                    <mesh />
                </GameCanvas>,
            );
        }

        const grownHalfWidth = 2.5 * (1920 / 1080);

        expect(frustumOf(installed)).toEqual({
            left: 1 - grownHalfWidth,
            right: 1 + grownHalfWidth,
            top: 2.5,
            bottom: -2.5,
        });
    });

    it('expands the camera before the browser paints', () => {
        // `ExpandCameraToCanvas` renders before `children`, so a child's LAYOUT
        // effect runs after its own: seeing the grown frustum there proves the
        // expand is not deferred to a passive effect, which would paint one
        // stretched frame first.
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };
        let atLayoutEffect: unknown = 'never ran';

        render(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <LayoutPhaseProbe
                    onLayout={() => {
                        atLayoutEffect = frustumOf(latestCanvasCamera() as OrthographicCamera);
                    }}
                />
            </GameCanvas>,
        );

        const grownHalfWidth = 2.5 * (1920 / 1080);
        expect(atLayoutEffect).toEqual({
            left: 1 - grownHalfWidth,
            right: 1 + grownHalfWidth,
            top: 2.5,
            bottom: -2.5,
        });
    });

    it('recomputes an expanded frustum from the authored bounds on every resize', () => {
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };
        const { rerender } = render(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        // Back to a 3:2 canvas: growing from the ALREADY-grown frustum would
        // leave the widened bounds in place instead of restoring the authored ones.
        fiberMock.rootState.size = { width: 900, height: 600 };
        rerender(
            <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera;

        expect(frustumOf(camera)).toEqual(BOARD_FRUSTUM);
        expectOrthographicProjection(camera, BOARD_FRUSTUM);
    });

    it.each([
        ['zero on both axes', { width: 0, height: 0 }],
        ['zero height alone', { width: 1920, height: 0 }],
        ['zero width alone', { width: 0, height: 1080 }],
    ])(
        'leaves the frustum untouched under fit expand while the canvas measures %s',
        (_label, size) => {
            containerBox = { width: 1920, height: 1080 };
            fiberMock.rootState.size = size;

            render(
                <GameCanvas camera={EXPANDING_BOARD_CAMERA}>
                    <mesh />
                </GameCanvas>,
            );

            // 0/0 is NaN and 1920/0 is Infinity; either one is a frustum that
            // renders nothing.
            expect(frustumOf(latestCanvasCamera() as OrthographicCamera)).toEqual(BOARD_FRUSTUM);
        },
    );

    it('leaves the frustum untouched and adds no bars under fit stretch', () => {
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };

        render(
            <GameCanvas camera={STRETCHED_BOARD_CAMERA}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera & { manual?: boolean };

        expect(camera.manual).toBe(true);
        expect(frustumOf(camera)).toEqual(BOARD_FRUSTUM);
        expect(latestCanvasStyle()).toBeUndefined();
        expect(fitFrame().style.backgroundColor).toBe('');
    });

    it('pillarboxes a perspective camera whose aspect is pinned', () => {
        containerBox = { width: 1920, height: 1080 };
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

        expect(camera.manual).toBe(true);
        expect(camera.aspect).toBe(1.5);
        expect(fittedCanvasBox()).toEqual({ width: 1620, height: 1080 });
    });

    it('takes the canvas aspect on a pinned perspective camera under fit expand', () => {
        containerBox = { width: 1920, height: 1080 };
        fiberMock.rootState.size = { width: 1920, height: 1080 };
        // A non-default fov: the canvas is wider than the pinned aspect, so the
        // AUTHORED fov must come through untouched rather than the default.
        const config: PerspectiveCameraConfig = {
            mode: 'perspective',
            position: [0, 5, 10],
            lookAt: [0, 0, 0],
            aspect: 1.5,
            fov: 75,
            fit: 'expand',
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as PerspectiveCamera;

        expect(camera.aspect).toBeCloseTo(1920 / 1080, 10);
        expect(camera.fov).toBe(75);
        expect(latestCanvasStyle()).toBeUndefined();
        // Again the matrix, not the fields three derives it from.
        expectPerspectiveProjection(camera, { fov: 75, aspect: 1920 / 1080 });
    });

    it('widens the fov of a pinned perspective camera on a canvas taller than its aspect', () => {
        // The other fork: below the pinned aspect the canvas aspect alone would
        // shrink the horizontal extent, so the vertical fov grows until the
        // authored one is back. Only this direction reads the PINNED aspect.
        containerBox = { width: 1000, height: 1000 };
        fiberMock.rootState.size = { width: 1000, height: 1000 };
        const config: PerspectiveCameraConfig = {
            mode: 'perspective',
            position: [0, 5, 10],
            lookAt: [0, 0, 0],
            aspect: 1.5,
            fov: 75,
            fit: 'expand',
        };

        render(
            <GameCanvas camera={config}>
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as PerspectiveCamera;
        // The authored horizontal half-extent at unit depth, re-expressed as a
        // vertical fov on a square canvas.
        const expectedFov = (Math.atan(Math.tan((75 * Math.PI) / 360) * 1.5) * 360) / Math.PI;

        expect(camera.aspect).toBe(1);
        expect(camera.fov).toBeGreaterThan(75);
        expect(camera.fov).toBeCloseTo(expectedFov, 10);
        expectPerspectiveProjection(camera, { fov: camera.fov, aspect: 1 });
    });

    it.each(['letterbox', 'expand', 'stretch'] as const)(
        'leaves an unpinned perspective camera non-manual and unfitted under fit %s',
        (fit) => {
            containerBox = { width: 1920, height: 1080 };
            fiberMock.rootState.size = { width: 1920, height: 1080 };
            const config: PerspectiveCameraConfig = {
                mode: 'perspective',
                position: [0, 5, 10],
                lookAt: [0, 0, 0],
                fit,
            };

            render(
                <GameCanvas camera={config}>
                    <mesh />
                </GameCanvas>,
            );

            const camera = latestCanvasCamera() as PerspectiveCamera & { manual?: boolean };

            // No pinned aspect, so no divergence for the policy to resolve: R3F
            // keeps the aspect correct itself, and `fit` must not take that away.
            expect(camera.manual).toBeUndefined();
            expect(camera.aspect).toBe(1);
            expect(latestCanvasStyle()).toBeUndefined();
            expect(fitFrame().style.backgroundColor).toBe('');
        },
    );

    it('spans the frustum across the fitted rect, which is the NDC denominator r3f will use', () => {
        // R3F reads pointer NDC as `state.pointer.set(event.offsetX /
        // state.size.width * 2 - 1, ...)` — @react-three/fiber 9.6.1. It
        // measures `state.size` on a 100%/100% inner div inside the wrapper this
        // component sizes, and sizes the canvas element from it, so the fitted
        // rect asserted below IS that denominator. What this test then computes
        // is three's own unprojection through it — the assertion that belongs to
        // this branch is the rect; the arithmetic is what makes the rect the
        // right one to have pinned, and the counter-assertion at the end is what
        // a gl.setViewport letterbox (state.size = the full frame) would give.
        containerBox = { width: 1920, height: 1080 };
        render(
            <GameCanvas camera="isometric">
                <mesh />
            </GameCanvas>,
        );

        const camera = latestCanvasCamera() as OrthographicCamera;
        const fitted = fittedCanvasBox();
        if (fitted === null) {
            throw new Error('Expected GameCanvas to pillarbox a 16:9 frame at camera aspect 1.6');
        }
        expect(fitted).toEqual({ width: 1728, height: 1080 });

        // A click 90% of the way across the visible FRAME, vertically centred.
        const frameX = 1728;
        const barWidth = (containerBox.width - fitted.width) / 2;
        const offsetX = frameX - barWidth;
        const world = new Vector3(
            (offsetX / fitted.width) * 2 - 1,
            -(540 / fitted.height) * 2 + 1,
            0,
        ).unproject(camera);
        const local = camera.worldToLocal(world.clone());

        // The visible canvas spans exactly the frustum, so the click lands on the
        // frustum point under it.
        expect(local.x).toBeCloseTo(
            camera.left + (offsetX / fitted.width) * (camera.right - camera.left),
            6,
        );
        expect(local.y).toBeCloseTo(0, 6);
        // Same click resolved against the full frame — what a GL-viewport
        // letterbox leaves behind — lands on a different world point.
        const framed = new Vector3(
            (frameX / containerBox.width) * 2 - 1,
            -(540 / containerBox.height) * 2 + 1,
            0,
        ).unproject(camera);
        expect(camera.worldToLocal(framed.clone()).x).not.toBeCloseTo(local.x, 3);
    });
});

describe('GameCanvas pointer-interaction gating (§4.23)', () => {
    // The real `gameStore` singleton, not a mock: what these tests measure is
    // that the provider GameCanvas mounts is wired to the store the IPC client
    // writes, which a mocked selector would assert nothing about.
    afterEach(() => {
        useGameStore.getState().reset();
    });

    it.each(['main', 'overlay'] as const)(
        'reaches a %s canvas child with the interaction context',
        (role) => {
            // Before GameCanvas mounted the provider this threw — useInteractionContext
            // has a null default and refuses to guess (Invariant #83) — so
            // `useGameInteraction` was unusable in every game, with or without one.
            render(
                <GameCanvas camera="isometric" role={role}>
                    <InteractionProbe />
                </GameCanvas>,
            );

            expect(screen.getByTestId('interaction-probe')).toHaveTextContent('false');
        },
    );

    it('blocks while a scene transition is in flight and unblocks once it clears', () => {
        render(
            <GameCanvas camera="isometric">
                <InteractionProbe />
            </GameCanvas>,
        );
        expect(screen.getByTestId('interaction-probe')).toHaveTextContent('false');

        // Three snapshots, not two: the unblocked read above is the store's
        // INITIAL state, which a provider that never subscribed would report just
        // as well. The transition back to `false` is what proves the subscription
        // is live in both directions rather than latched on first render.
        act(() => {
            useGameStore.getState().applySnapshot(snapshotWithTransition(activeTransition()));
        });
        expect(screen.getByTestId('interaction-probe')).toHaveTextContent('true');

        act(() => {
            useGameStore.getState().applySnapshot(snapshotWithTransition(null));
        });
        expect(screen.getByTestId('interaction-probe')).toHaveTextContent('false');
    });
});

/** Reads the context a canvas child sees, so a missing provider throws here. */
function InteractionProbe(): React.ReactElement {
    const { isBlocked } = useInteractionContext();
    return <div data-testid="interaction-probe">{String(isBlocked)}</div>;
}

/**
 * A `PlayerSnapshot` carrying just the three fields this path reads:
 * `applySnapshot` takes `tick` and `undoMeta`, and the blocker's selector takes
 * `sceneTransition`. The rest of the contract is irrelevant here, so the partial
 * is widened ONCE at the return rather than per field — and the parameter is
 * typed off `PlayerSnapshot` rather than as a local shape, which is what keeps
 * the field name and the `SceneTransitionState` contract checked. An `as never`
 * here would compile against a transition object that no longer exists.
 */
function snapshotWithTransition(
    sceneTransition: PlayerSnapshot['sceneTransition'],
): PlayerSnapshot {
    return {
        tick: 1,
        sceneTransition,
        undoMeta: { canUndo: false, canRedo: false },
    } as unknown as PlayerSnapshot;
}

/** An in-flight transition — the shape `sceneTransition` actually carries. */
function activeTransition(): NonNullable<PlayerSnapshot['sceneTransition']> {
    return {
        toSceneId: 'scene-b' as SceneId,
        phase: 'preparing',
        startedAtTick: 1,
        params: {},
        playersReady: [],
    };
}

/** The inline-style property names set on `element`, sorted. */
function declaredStyleKeys(element: HTMLElement): string[] {
    return [...element.style].sort();
}

/** Deliver a container resize to every observer GameCanvas subscribed. */
function fireResizeObservers(): void {
    act(() => {
        for (const observer of ResizeObserverStub.instances) {
            observer.fire();
        }
    });
}

/** The projection matrix three would build for `bounds`, element for element. */
function expectOrthographicProjection(
    camera: OrthographicCamera,
    bounds: Readonly<{ left: number; right: number; top: number; bottom: number }>,
): void {
    const reference = new OrthographicCamera(
        bounds.left,
        bounds.right,
        bounds.top,
        bounds.bottom,
        camera.near,
        camera.far,
    );
    reference.updateProjectionMatrix();

    expect(camera.projectionMatrix.toArray()).toEqual(reference.projectionMatrix.toArray());
}

function expectPerspectiveProjection(
    camera: PerspectiveCamera,
    lens: Readonly<{ fov: number; aspect: number }>,
): void {
    const reference = new PerspectiveCamera(lens.fov, lens.aspect, camera.near, camera.far);
    reference.updateProjectionMatrix();

    expect(camera.projectionMatrix.toArray()).toEqual(reference.projectionMatrix.toArray());
}

function fitFrame(): HTMLElement {
    const frame = screen.getByTestId('r3f-canvas').parentElement;
    if (frame === null) {
        throw new Error('Expected GameCanvas to wrap the r3f Canvas in an engine fit frame');
    }

    return frame;
}

function frustumOf(camera: OrthographicCamera): Readonly<Record<string, number>> {
    return { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom };
}

function latestCanvasStyle(): Readonly<Record<string, unknown>> | undefined {
    return latestCanvasProps().style as Readonly<Record<string, unknown>> | undefined;
}

/**
 * The fitted canvas rect in pixels, or `null` when GameCanvas applied no fitted
 * size at all. Parsing back from the style asserts the UNIT as well as the
 * number — a bare number would be ignored by the browser.
 */
function fittedCanvasBox(): { readonly width: number; readonly height: number } | null {
    const style = latestCanvasStyle();
    if (style === undefined) {
        return null;
    }

    return { width: parsePixels(style['width']), height: parsePixels(style['height']) };
}

function parsePixels(value: unknown): number {
    if (typeof value !== 'string' || !value.endsWith('px')) {
        throw new Error(`Expected a px length on the fitted canvas, got ${String(value)}`);
    }

    return Number(value.slice(0, -'px'.length));
}

function latestCanvasProps(): Readonly<{
    camera?: unknown;
    frameloop?: unknown;
    className?: unknown;
    style?: unknown;
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
