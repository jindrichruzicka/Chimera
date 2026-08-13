// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { useAnimationSheet, useModelInstance } from '@chimera-engine/renderer/assets';
import type { ModelInstance } from '@chimera-engine/renderer/assets';

import {
    tacticsModelRefs,
    tacticsShowcaseLeanClip,
    tacticsShowcaseWaveClip,
} from '../asset-manifest.js';
import { TacticsModelShowcaseScreen } from './TacticsModelShowcaseScreen';

const gameCanvasCalls = vi.hoisted((): { readonly camera: unknown }[] => []);

// The screen owns the ref resolution AND the sheet parse: both hook calls live
// here and their outcomes are handed to the R3F components as props, which is
// why those components' own suites need no asset provider. The sheet in
// particular MUST be resolved here — `useAnimationSheet` memoises what it
// parses, and a parse inside the canvas component would hand `useClipPlayer` a
// fresh object every render and restart the clip on every frame.
vi.mock('@chimera-engine/renderer/assets', () => ({
    useModelInstance: vi.fn(),
    useAnimationSheet: vi.fn(),
}));

const useModelInstanceMock = vi.mocked(useModelInstance);
const useAnimationSheetMock = vi.mocked(useAnimationSheet);

/** What the screen handed the clip-player component on each render. */
const animatedShowcaseProps = vi.hoisted((): Record<string, unknown>[] => []);

vi.mock('../components/TacticsAnimatedShowcase.js', () => ({
    // Same reason as the scene component below: it renders `<primitive>` and
    // calls `useFrame`, neither of which exists outside an R3F reconciler. Its
    // own suite drives it through `@react-three/test-renderer`.
    TacticsAnimatedShowcase: (props: Record<string, unknown>) => {
        animatedShowcaseProps.push(props);
        return <div data-testid="tactics-animated-showcase-mock" />;
    },
}));

function stubInstance(uuid: string): ModelInstance {
    return { root: { uuid }, clips: [] } as unknown as ModelInstance;
}

/**
 * What the screen handed the clip-player component on its LAST render.
 *
 * The last one, because the interesting renders here are the ones a click
 * causes: an assertion against `[0]` would read the mount and call a toggle
 * that changed nothing a pass.
 */
function latestAnimatedProps(): Record<string, unknown> {
    const props = animatedShowcaseProps[animatedShowcaseProps.length - 1];
    expect(props, 'the clip-player component never rendered').toBeDefined();
    return props!;
}

// Mocks ONLY GameCanvas: the engine mounts PerfProbe and FrameRateLimiter
// itself, so a re-added import of either resolves `undefined` and reds every
// render test here (the double-mount mutant).
vi.mock('@chimera-engine/renderer/components/r3f', () => ({
    GameCanvas: ({
        camera,
        children,
    }: {
        readonly camera: unknown;
        readonly children: React.ReactNode;
    }) => {
        gameCanvasCalls.push({ camera });
        return <div data-testid="tactics-showcase-r3f-canvas">{children}</div>;
    },
}));

// Mutable per-test fixture for the showcase mock's reports: a test overwrites
// `a`/`b` before render to drive the status element through its error paths.
const showcaseMockReports = vi.hoisted(() => ({
    a: { rootUuid: 'uuid-a', topBonePoseZ: Math.PI / 2, errorName: '' },
    b: { rootUuid: 'uuid-b', topBonePoseZ: 0, errorName: '' },
    reportBEnabled: true,
    resetToClean(): void {
        showcaseMockReports.a = { rootUuid: 'uuid-a', topBonePoseZ: Math.PI / 2, errorName: '' };
        showcaseMockReports.b = { rootUuid: 'uuid-b', topBonePoseZ: 0, errorName: '' };
        showcaseMockReports.reportBEnabled = true;
    },
}));

/** What the screen handed the scene component on the last render. */
const showcaseInstanceProps = vi.hoisted(
    (): { readonly instanceA: unknown; readonly instanceB: unknown }[] => [],
);

vi.mock('../components/TacticsModelShowcase.js', () => ({
    // The scene component renders `<primitive>`, which only an R3F reconciler
    // understands; this suite exercises the SCREEN in jsdom, and the scene
    // component has its own co-located test plus the model-instances e2e.
    TacticsModelShowcase: ({
        instanceA,
        instanceB,
        onReportA,
        onReportB,
    }: {
        readonly instanceA: unknown;
        readonly instanceB: unknown;
        readonly onReportA: (report: {
            rootUuid: string;
            topBonePoseZ: number;
            errorName: string;
        }) => void;
        readonly onReportB: (report: {
            rootUuid: string;
            topBonePoseZ: number;
            errorName: string;
        }) => void;
    }) => {
        showcaseInstanceProps.push({ instanceA, instanceB });
        React.useEffect(() => {
            onReportA(showcaseMockReports.a);
            if (showcaseMockReports.reportBEnabled) {
                onReportB(showcaseMockReports.b);
            }
        }, [onReportA, onReportB]);
        return <div data-testid="tactics-model-showcase-mock" />;
    },
}));

beforeEach(() => {
    useModelInstanceMock.mockReturnValue({ instance: null, loading: true, error: null });
    useAnimationSheetMock.mockReturnValue(null);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    gameCanvasCalls.length = 0;
    showcaseInstanceProps.length = 0;
    animatedShowcaseProps.length = 0;
    showcaseMockReports.resetToClean();
});

describe('TacticsModelShowcaseScreen — model resolution', () => {
    it('resolves each showcase ref TWICE per render, one call per mounted instance', () => {
        // Two calls per ref PER RENDER, not two in total: the reports land in
        // screen state, so the screen renders again after mount. One call whose
        // result was reused for both quads of a pair would hand the SAME root to
        // both, collapsing the two uuids the e2e compares — and that mutant
        // shows up here as one call per ref per render rather than two.
        //
        // Both pairs matter, and for different reasons: the seam pair proves
        // per-mount cloning, and the animated pair is what keeps the two mixer
        // drivers off one root (Rule ONE-MIXER-PER-ROOT).
        render(<TacticsModelShowcaseScreen />);

        const renderCount = showcaseInstanceProps.length;
        expect(renderCount).toBeGreaterThanOrEqual(1);
        expect(useModelInstanceMock).toHaveBeenCalledTimes(renderCount * 4);

        const perRef = new Map<unknown, number>();
        for (const call of useModelInstanceMock.mock.calls) {
            perRef.set(call[0], (perRef.get(call[0]) ?? 0) + 1);
        }
        expect(Object.fromEntries(perRef)).toEqual({
            [tacticsModelRefs.showcaseRig]: renderCount * 2,
            [tacticsModelRefs.showcaseRigAnimated]: renderCount * 2,
        });
    });

    it('parses the sheet once per render, for the ANIMATED ref only', () => {
        // The unanimated rig carries no sheet, so a parse against its ref would
        // be a memo keyed on `undefined` — silently null, and indistinguishable
        // from a sheet the manifest forgot.
        render(<TacticsModelShowcaseScreen />);

        const renderCount = showcaseInstanceProps.length;
        expect(useAnimationSheetMock).toHaveBeenCalledTimes(renderCount);
        for (const call of useAnimationSheetMock.mock.calls) {
            expect(call[0]).toBe(tacticsModelRefs.showcaseRigAnimated);
        }
    });

    it('hands the clip-player component its two instances, the sheet and the clip name', () => {
        const sheet = { clips: { wave: { durationSeconds: 1 } } };
        useModelInstanceMock
            .mockReturnValueOnce({ instance: stubInstance('uuid-a'), loading: false, error: null })
            .mockReturnValueOnce({ instance: stubInstance('uuid-b'), loading: false, error: null })
            .mockReturnValueOnce({
                instance: stubInstance('uuid-played'),
                loading: false,
                error: null,
            })
            .mockReturnValueOnce({
                instance: stubInstance('uuid-control'),
                loading: false,
                error: null,
            });
        useAnimationSheetMock.mockReturnValue({ sheet, warnings: [] });

        render(<TacticsModelShowcaseScreen />);

        expect(animatedShowcaseProps[0]).toMatchObject({
            playedInstance: { root: { uuid: 'uuid-played' } },
            controlInstance: { root: { uuid: 'uuid-control' } },
            // The SHEET, not the parsed wrapper: the wrapper carries `warnings`
            // beside it and is not a clip-sheet source.
            sheet,
            clip: tacticsShowcaseWaveClip.name,
        });
    });

    it('starts on the wave clip and swaps to lean and back as the toggle is pressed', () => {
        // The toggle is the only thing on this route that changes a clip while
        // one is playing, and a clip CHANGE is the whole subject of the blend
        // e2e: the transition is what `useClipPlayer` blends, and it happens on
        // the commit that changes this prop.
        render(<TacticsModelShowcaseScreen />);

        expect(latestAnimatedProps()['clip']).toBe(tacticsShowcaseWaveClip.name);

        fireEvent.click(screen.getByTestId('tactics-model-showcase-clip-toggle'));
        expect(latestAnimatedProps()['clip']).toBe(tacticsShowcaseLeanClip.name);

        // And back, so a spec can run the transition in either direction — the
        // way back is the CUT, because only `lean` authors a blend length.
        fireEvent.click(screen.getByTestId('tactics-model-showcase-clip-toggle'));
        expect(latestAnimatedProps()['clip']).toBe(tacticsShowcaseWaveClip.name);
    });

    it('changes ONLY the clip across a toggle, keeping the sheet identity', () => {
        // `sheet` is a dependency of the playback effect, so a new object handed
        // down on the toggling render would restart the clip instead of blending
        // into it — with a passing blend spec and no blend on screen. Same for
        // the two instances: a re-resolved root would remount the whole player.
        const sheet = { clips: { wave: { durationSeconds: 1 } } };
        useAnimationSheetMock.mockReturnValue({ sheet, warnings: [] });
        useModelInstanceMock.mockReturnValue({
            instance: stubInstance('uuid-shared'),
            loading: false,
            error: null,
        });

        render(<TacticsModelShowcaseScreen />);
        const before = latestAnimatedProps();

        fireEvent.click(screen.getByTestId('tactics-model-showcase-clip-toggle'));
        const after = latestAnimatedProps();

        expect(after['sheet']).toBe(before['sheet']);
        expect(after['playedInstance']).toBe(before['playedInstance']);
        expect(after['controlInstance']).toBe(before['controlInstance']);
        expect(after['clip']).not.toBe(before['clip']);
    });

    it('publishes the declared clip on the toggle, so a spec can see the click land', () => {
        // A blend is read off a bone rotation, which says nothing about WHY it
        // moved. This attribute is what separates "the transition never started"
        // from "the transition started and did not blend".
        render(<TacticsModelShowcaseScreen />);

        const toggle = screen.getByTestId('tactics-model-showcase-clip-toggle');
        expect(toggle).toHaveAttribute('data-showcase-clip', tacticsShowcaseWaveClip.name);

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('data-showcase-clip', tacticsShowcaseLeanClip.name);
    });

    it('passes a null sheet through rather than an empty object', () => {
        // `useAnimationSheet` answers null for a ref with no metadata, and
        // `useClipPlayer` takes `ClipSheetSource | null`. An `?? {}` here would
        // play the clip UNMARKED and look identical on screen.
        render(<TacticsModelShowcaseScreen />);

        expect(animatedShowcaseProps[0]?.['sheet']).toBeNull();
    });

    it('hands each resolved root down to the scene component, A then B', () => {
        useModelInstanceMock
            .mockReturnValueOnce({ instance: stubInstance('uuid-a'), loading: false, error: null })
            .mockReturnValueOnce({ instance: stubInstance('uuid-b'), loading: false, error: null });

        render(<TacticsModelShowcaseScreen />);

        expect(showcaseInstanceProps[0]).toEqual({
            instanceA: { root: { uuid: 'uuid-a' }, errorName: '' },
            instanceB: { root: { uuid: 'uuid-b' }, errorName: '' },
        });
    });

    it('forwards a per-instance load failure as that instance errorName', () => {
        // B fails, A does not: a screen that collapsed the two error slots into
        // one would report A's clean '' for both and lose the failure the status
        // element exists to surface.
        const error = new Error('undeclared');
        error.name = 'UnknownAssetManifestEntryError';
        useModelInstanceMock
            .mockReturnValueOnce({ instance: stubInstance('uuid-a'), loading: false, error: null })
            .mockReturnValueOnce({ instance: null, loading: false, error });

        render(<TacticsModelShowcaseScreen />);

        expect(showcaseInstanceProps[0]).toEqual({
            instanceA: { root: { uuid: 'uuid-a' }, errorName: '' },
            instanceB: { root: null, errorName: 'UnknownAssetManifestEntryError' },
        });
    });

    it('reports a still-loading instance as a null root with no error', () => {
        render(<TacticsModelShowcaseScreen />);

        expect(showcaseInstanceProps[0]).toEqual({
            instanceA: { root: null, errorName: '' },
            instanceB: { root: null, errorName: '' },
        });
    });
});

describe('TacticsModelShowcaseScreen', () => {
    it('mounts the showcase inside the engine GameCanvas', () => {
        render(<TacticsModelShowcaseScreen />);

        expect(screen.getByTestId('tactics-showcase-r3f-canvas')).toContainElement(
            screen.getByTestId('tactics-model-showcase-mock'),
        );
    });

    it('hands GameCanvas one stable camera identity across re-renders', () => {
        // The showcase reports land via effect state, so the screen renders
        // again after mount; a new camera identity per render would re-realize
        // the camera (GameCanvas reference-compares its memo).
        render(<TacticsModelShowcaseScreen />);

        expect(gameCanvasCalls.length).toBeGreaterThanOrEqual(1);
        expect(new Set(gameCanvasCalls.map((call) => call.camera)).size).toBe(1);
    });

    it('frames all four quads with an explicit world-unit orthographic frustum', () => {
        // The quads are authored in the XY plane facing +Z, spanning x ±0.45
        // and y 0→1.4 (both rigs). This is the screen's own camera — it shares
        // nothing with the board's, which looks down -Y.
        render(<TacticsModelShowcaseScreen />);

        const camera = gameCanvasCalls[0]?.camera as { frustum: Record<string, number> };
        expect(camera).toEqual({
            mode: 'orthographic',
            position: [0, 0.7, 6],
            lookAt: [0, 0.7, 0],
            up: [0, 1, 0],
            frustum: { left: -3.4, right: 3.4, top: 2.125, bottom: -2.125, near: 0.1, far: 100 },
        });

        // The ASPECT is the load-bearing part, and it is not visible from the
        // four numbers above: the canvas-fit policy letterboxes against it, so
        // widening one axis alone re-frames the whole scene instead of making
        // room in it. 1.6 is what the two-quad frustum had.
        const width = camera.frustum['right']! - camera.frustum['left']!;
        const height = camera.frustum['top']! - camera.frustum['bottom']!;
        expect(width / height).toBeCloseTo(1.6, 6);
    });

    it('exposes the model-showcase reports as status data attributes (clean path)', () => {
        render(<TacticsModelShowcaseScreen />);

        const status = screen.getByTestId('tactics-model-showcase-status');
        expect(status).toHaveAttribute('data-models-settled', 'true');
        expect(status).toHaveAttribute('data-models-loaded', '2');
        expect(status).toHaveAttribute('data-model-roots-distinct', 'true');
        expect(status).toHaveAttribute('data-model-pose-a', (Math.PI / 2).toFixed(3));
        expect(status).toHaveAttribute('data-model-pose-b', (0).toFixed(3));
        expect(status).toHaveAttribute('data-model-error', '');
    });

    it("surfaces instance B's failure in the status element even when A loaded clean", () => {
        // `reportA?.errorName ?? reportB?.errorName` would let A's clean ''
        // mask B's failure — the attribute must carry the first NON-EMPTY name.
        showcaseMockReports.b = {
            rootUuid: '',
            topBonePoseZ: Number.NaN,
            errorName: 'UnknownAssetManifestEntryError',
        };

        render(<TacticsModelShowcaseScreen />);

        const status = screen.getByTestId('tactics-model-showcase-status');
        expect(status).toHaveAttribute('data-models-settled', 'true');
        expect(status).toHaveAttribute('data-models-loaded', '1');
        expect(status).toHaveAttribute('data-model-roots-distinct', '');
        expect(status).toHaveAttribute('data-model-error', 'UnknownAssetManifestEntryError');
    });

    it("surfaces instance A's failure and withholds roots-distinct even when B loaded clean", () => {
        // Mirror of the B-fails case: the A-side error guard must withhold
        // roots-distinct (comparing '' against B's uuid would publish 'true'
        // in exactly the failure state the attribute exists to diagnose).
        showcaseMockReports.a = {
            rootUuid: '',
            topBonePoseZ: Number.NaN,
            errorName: 'MalformedModelAssetError',
        };

        render(<TacticsModelShowcaseScreen />);

        const status = screen.getByTestId('tactics-model-showcase-status');
        expect(status).toHaveAttribute('data-models-settled', 'true');
        expect(status).toHaveAttribute('data-models-loaded', '1');
        expect(status).toHaveAttribute('data-model-roots-distinct', '');
        expect(status).toHaveAttribute('data-model-error', 'MalformedModelAssetError');
    });

    it('stays unsettled while only instance A has reported', () => {
        // The settled attribute must require BOTH reports: an ||-coarsened
        // guard would flip it after the first report, and the e2e reads the
        // error and loaded-count attributes the moment it flips.
        showcaseMockReports.reportBEnabled = false;

        render(<TacticsModelShowcaseScreen />);

        const status = screen.getByTestId('tactics-model-showcase-status');
        expect(status).toHaveAttribute('data-models-settled', 'false');
        expect(status).toHaveAttribute('data-models-loaded', '1');
        expect(status).toHaveAttribute('data-model-pose-b', '');
    });

    it('sizes itself to the viewport rather than inheriting a height', () => {
        // Nothing between this route and <html> has a height, so a percentage
        // height resolves to ZERO — and a zero-box <Canvas> never mounts its
        // children (R3F waits on a measured size), so the models would never
        // load and the status element would sit at settled=false forever
        // instead of reporting an error. Measured: this exact regression.
        render(<TacticsModelShowcaseScreen />);

        const root = screen.getByTestId('tactics-model-showcase');
        expect(root).toHaveStyle({ height: '100vh' });
        // Anchors the absolutely-positioned status element to this box.
        expect(root).toHaveStyle({ position: 'relative' });
    });

    it('keeps the status element non-occluding, so it can never eat a canvas pixel read', () => {
        render(<TacticsModelShowcaseScreen />);

        expect(screen.getByTestId('tactics-model-showcase-status')).toHaveStyle({
            pointerEvents: 'none',
        });
    });

    it('renders the status elements and the toggle positioned and AFTER the GameCanvas', () => {
        // Positioned and after the canvas, all three — camera-system.md §4.22
        // "Canvas-fit rules". The clip status is a second node under the same
        // rule: it is written imperatively from the frame loop, but it is still
        // a sibling of the canvas and would occlude it if it were not absolute.
        // The toggle is a third: it is the only node here with a box, so in flow
        // it would push the canvas down and shrink the frame every pixel
        // assertion on this route is read from.
        render(<TacticsModelShowcaseScreen />);

        const screenRoot = screen.getByTestId('tactics-model-showcase');
        const order = [...screenRoot.children].map((child) => child.getAttribute('data-testid'));

        expect(order).toEqual([
            'tactics-showcase-r3f-canvas',
            'tactics-model-showcase-status',
            'tactics-model-showcase-clip-status',
            'tactics-model-showcase-clip-toggle',
        ]);
        for (const testId of [
            'tactics-model-showcase-status',
            'tactics-model-showcase-clip-status',
            'tactics-model-showcase-clip-toggle',
        ]) {
            expect(screen.getByTestId(testId)).toHaveStyle({ position: 'absolute' });
        }
    });
});
