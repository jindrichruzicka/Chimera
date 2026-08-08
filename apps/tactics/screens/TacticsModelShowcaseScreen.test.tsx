// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { useModelInstance } from '@chimera-engine/renderer/assets';
import type { ModelInstance } from '@chimera-engine/renderer/assets';

import { tacticsModelRefs } from '../asset-manifest.js';
import { TacticsModelShowcaseScreen } from './TacticsModelShowcaseScreen';

const gameCanvasCalls = vi.hoisted((): { readonly camera: unknown }[] => []);

// The screen owns the ref resolution: the hook calls live here and the outcome
// is handed to the R3F component as props, which is why that component's own
// suite needs no asset provider.
vi.mock('@chimera-engine/renderer/assets', () => ({
    useModelInstance: vi.fn(),
}));

const useModelInstanceMock = vi.mocked(useModelInstance);

function stubInstance(uuid: string): ModelInstance {
    return { root: { uuid }, clips: [] } as unknown as ModelInstance;
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
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    gameCanvasCalls.length = 0;
    showcaseInstanceProps.length = 0;
    showcaseMockReports.resetToClean();
});

describe('TacticsModelShowcaseScreen — model resolution', () => {
    it('resolves the single showcase ref TWICE per render, one call per mounted instance', () => {
        // Two calls PER RENDER, not two in total: the reports land in screen
        // state, so the screen renders again after mount. One call whose result
        // was reused for both quads would hand the SAME root to A and B,
        // collapsing the two uuids the e2e compares — and that mutant shows up
        // here as one call per render rather than two.
        render(<TacticsModelShowcaseScreen />);

        const renderCount = showcaseInstanceProps.length;
        expect(renderCount).toBeGreaterThanOrEqual(1);
        expect(useModelInstanceMock).toHaveBeenCalledTimes(renderCount * 2);
        for (const call of useModelInstanceMock.mock.calls) {
            expect(call[0]).toBe(tacticsModelRefs.showcaseRig);
        }
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

    it('frames both quads with an explicit world-unit orthographic frustum', () => {
        // The quads are authored in the XY plane facing +Z, spanning x ±0.45
        // and y 0→1.4 (showcase-rig.glb). This is the screen's own camera —
        // it shares nothing with the board's, which looks down -Y.
        render(<TacticsModelShowcaseScreen />);

        expect(gameCanvasCalls[0]?.camera).toEqual({
            mode: 'orthographic',
            position: [0, 0.7, 6],
            lookAt: [0, 0.7, 0],
            up: [0, 1, 0],
            frustum: { left: -2.4, right: 2.4, top: 1.5, bottom: -1.5, near: 0.1, far: 100 },
        });
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

    it('renders the status element positioned and AFTER the GameCanvas', () => {
        // Positioned and after the canvas, both — camera-system.md §4.22
        // "Canvas-fit rules".
        render(<TacticsModelShowcaseScreen />);

        const screenRoot = screen.getByTestId('tactics-model-showcase');
        const order = [...screenRoot.children].map((child) => child.getAttribute('data-testid'));

        expect(order).toEqual(['tactics-showcase-r3f-canvas', 'tactics-model-showcase-status']);
        expect(screen.getByTestId('tactics-model-showcase-status')).toHaveStyle({
            position: 'absolute',
        });
    });
});
