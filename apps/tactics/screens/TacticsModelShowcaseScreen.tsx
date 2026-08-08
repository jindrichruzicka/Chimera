'use client';

import React, { useState } from 'react';
import { GameCanvas, type OrthographicCameraConfig } from '@chimera-engine/renderer/components/r3f';
import { useModelInstance, type UseModelInstanceState } from '@chimera-engine/renderer/assets';

import { tacticsModelRefs } from '../asset-manifest.js';
import {
    TacticsModelShowcase,
    type TacticsModelShowcaseInstance,
    type TacticsModelShowcaseReport,
} from '../scene/TacticsModelShowcase.js';

/**
 * The model-seam test screen (§4.10), reachable only at `/model-showcase/`.
 *
 * **This is the canonical statement of why the screen is isolated; other files
 * on this route point here rather than restating it.** The seam's runtime
 * proof needs two magenta test quads on screen. Anywhere inside the playfield
 * they would be extra geometry in every board pixel-count and board-click
 * spec's frame, so they live here instead, where they are the only thing
 * rendered and no gameplay test can see them. Nothing in the app links to this
 * route: the model-instances e2e navigates to it directly, and the packaged
 * build refuses it (`showcaseRouteGate.ts`, which owns that half).
 *
 * It is a plain screen component, NOT a `GameScreenRegistry` entry: registry
 * screens are selected by scene/snapshot and need a running match, and this
 * needs neither. Its asset session is opened by the route
 * (`<GameAssetSession>`), which is what makes `useModelInstance` resolve here
 * with no `GameShell` above it.
 *
 * The ref is resolved HERE rather than inside the scene component because the
 * renderer barrels are legal on `screens/` and forbidden on `scene/`
 * (Invariant #96). Two calls, one per mounted quad: that is what gives each
 * mount its own `SkeletonUtils` clone, which is the seam's whole claim.
 */
export function TacticsModelShowcaseScreen(): React.ReactElement {
    const [reportA, setReportA] = useState<TacticsModelShowcaseReport | null>(null);
    const [reportB, setReportB] = useState<TacticsModelShowcaseReport | null>(null);
    const modelA = useModelInstance(tacticsModelRefs.showcaseRig);
    const modelB = useModelInstance(tacticsModelRefs.showcaseRig);

    return (
        <div data-testid="tactics-model-showcase" style={screenStyle}>
            {/* No lights: showcase-rig.glb declares KHR_materials_unlit, which
                GLTFLoader maps to MeshBasicMaterial — nothing in this scene is
                lit, so a light could not change a pixel. */}
            <GameCanvas camera={SHOWCASE_CAMERA}>
                <TacticsModelShowcase
                    instanceA={toShowcaseInstance(modelA)}
                    instanceB={toShowcaseInstance(modelB)}
                    onReportA={setReportA}
                    onReportB={setReportB}
                />
            </GameCanvas>
            {/* Positioned, and after the canvas — camera-system.md §4.22
                "Canvas-fit rules". */}
            <TacticsModelShowcaseStatus reportA={reportA} reportB={reportB} />
        </div>
    );
}

/**
 * Flatten one hook result to what the scene component takes.
 *
 * `loading` is dropped rather than forwarded: a null root already means "not
 * mountable yet", and the scene has nothing to draw differently for a load in
 * flight versus one that failed — the error name is what it reports.
 */
function toShowcaseInstance(state: UseModelInstanceState): TacticsModelShowcaseInstance {
    return {
        root: state.instance?.root ?? null,
        errorName: state.error?.name ?? '',
    };
}

/**
 * The screen sizes ITSELF to the viewport, and must: this route has no
 * `GameShell` above it, and nothing in the chain up to `<html>` has a height.
 * Inheriting a percentage height there resolves to ZERO, and a zero-box
 * `<Canvas>` never mounts its children at all — R3F's `CanvasImpl` creates its
 * root and renders children only under its `containerRect.width > 0 &&
 * containerRect.height > 0` guard, re-measurable with one grep after an r3f
 * upgrade — so the models would silently never load rather than fail.
 * `position: relative` anchors the absolutely-positioned status element.
 */
const screenStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100vh',
};

/**
 * The screen's own camera — it shares nothing with the board's (§4.22), which
 * looks down -Y at the XZ board plane. The quads are authored upright in the
 * XY plane facing +Z (x ±0.45, y 0→1.4 in `showcase-rig.glb`), so this looks
 * straight down -Z at them and needs no corrective rotation. The frustum is
 * sized to hold both quads plus the posed one's sideways swing, and centred on
 * the quads' mid-height. Module-level so GameCanvas's reference-compared memo
 * keeps one camera per mount.
 */
const SHOWCASE_CAMERA = {
    mode: 'orthographic',
    position: [0, 0.7, 6],
    lookAt: [0, 0.7, 0],
    up: [0, 1, 0],
    frustum: { left: -2.4, right: 2.4, top: 1.5, bottom: -1.5, near: 0.1, far: 100 },
} as const satisfies OrthographicCameraConfig;

// No visible content — the element exists only to carry data attributes, so
// it needs no size; pointer-events stays off so it can never occlude the canvas.
const showcaseStatusStyle: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
};

/**
 * DOM observability for the in-canvas model showcase: the canvas can show
 * pixels, but only the scene graph can say the two clones are distinct roots
 * and independently posed — this element carries those facts as data
 * attributes for the model-instances e2e spec. Empty attribute values mean
 * "not reported yet"; an error name means the load or clone failed.
 */
function TacticsModelShowcaseStatus({
    reportA,
    reportB,
}: {
    readonly reportA: TacticsModelShowcaseReport | null;
    readonly reportB: TacticsModelShowcaseReport | null;
}): React.ReactElement {
    const loadedCount = [reportA, reportB].filter(
        (report) => report !== null && report.errorName === '',
    ).length;
    // First NON-EMPTY error, from either instance: `reportA?.errorName ?? …`
    // would let A's clean '' mask B's failure and turn a named error into an
    // undiagnosed timeout downstream.
    const errorName =
        [reportA?.errorName, reportB?.errorName].find(
            (name) => name !== undefined && name !== '',
        ) ?? '';
    const rootsDistinct =
        reportA !== null && reportB !== null && reportA.errorName === '' && reportB.errorName === ''
            ? String(reportA.rootUuid !== reportB.rootUuid)
            : '';
    return (
        <div
            data-testid="tactics-model-showcase-status"
            data-models-settled={String(reportA !== null && reportB !== null)}
            data-models-loaded={String(loadedCount)}
            data-model-roots-distinct={rootsDistinct}
            data-model-pose-a={reportA === null ? '' : reportA.topBonePoseZ.toFixed(3)}
            data-model-pose-b={reportB === null ? '' : reportB.topBonePoseZ.toFixed(3)}
            data-model-error={errorName}
            style={showcaseStatusStyle}
        />
    );
}

export default TacticsModelShowcaseScreen;
