'use client';

import React, { useCallback, useRef, useState } from 'react';
import { GameCanvas, type OrthographicCameraConfig } from '@chimera-engine/renderer/components/r3f';
import {
    useAnimationSheet,
    useModelInstance,
    type UseModelInstanceState,
} from '@chimera-engine/renderer/assets';
import { Button } from '@chimera-engine/renderer/components/ui';

import {
    tacticsModelRefs,
    tacticsShowcaseLeanClip,
    tacticsShowcaseWaveClip,
} from '../asset-manifest.js';
import { TacticsAnimatedShowcase } from '../components/TacticsAnimatedShowcase.js';
import {
    TacticsModelShowcase,
    type TacticsModelShowcaseInstance,
    type TacticsModelShowcaseReport,
} from '../components/TacticsModelShowcase.js';

/**
 * The model-seam test screen (§4.10), reachable only at `/model-showcase/`.
 *
 * **This is the canonical statement of why the screen is isolated; other files
 * on this route point here rather than restating it.** The seam's runtime
 * proof needs two magenta test quads on screen. Anywhere inside the playfield
 * they would be extra geometry in every board pixel-count and board-click
 * spec's frame, so they live here instead, where they are the only thing
 * rendered and no gameplay test can see them. Nothing in the app links to this
 * route: an e2e spec navigates to it directly (`ModelShowcasePage`, which owns
 * the only way in), and the packaged build refuses it (`showcaseRouteGate.ts`,
 * which owns that half).
 *
 * It is a plain screen component, NOT a `GameScreenRegistry` entry: registry
 * screens are selected by scene/snapshot and need a running match, and this
 * needs neither. Its asset session is opened by the route
 * (`<GameAssetSession>`), which is what makes `useModelInstance` resolve here
 * with no `GameShell` above it.
 *
 * The ref is resolved HERE rather than inside the R3F component: this screen
 * is the one thing on the route with the asset session above it, and keeping
 * `TacticsModelShowcase` prop-driven is what lets its own test render it with
 * no provider. Two calls, one per mounted quad: that is what gives each mount
 * its own `SkeletonUtils` clone, which is the seam's whole claim.
 *
 * **The clip toggle, and why the route has a control at all.** A blended
 * transition is something a game asks for by declaring a DIFFERENT clip while
 * one is playing, so a screen that names one clip for ever cannot produce one —
 * the blend chain would be exercised by unit suites and by nothing that runs in
 * a window. The toggle is that ask, made from the DOM so an e2e can drive it,
 * and the direction is asymmetric on purpose: `lean` authors a
 * `blendInSeconds` and `wave` does not, so the way there blends and the way back
 * cuts. `apps/tactics/e2e/tests/animation-blend.spec.ts` is what reads the
 * result.
 */
export function TacticsModelShowcaseScreen(): React.ReactElement {
    const [reportA, setReportA] = useState<TacticsModelShowcaseReport | null>(null);
    const [reportB, setReportB] = useState<TacticsModelShowcaseReport | null>(null);
    const modelA = useModelInstance(tacticsModelRefs.showcaseRig);
    const modelB = useModelInstance(tacticsModelRefs.showcaseRig);

    // The clip-player pair: one ref resolved twice, so the two drivers act on
    // distinct clones (Rule ONE-MIXER-PER-ROOT — `TacticsAnimatedShowcase`).
    const animatedPlayed = useModelInstance(tacticsModelRefs.showcaseRigAnimated);
    const animatedControl = useModelInstance(tacticsModelRefs.showcaseRigAnimated);
    // Resolved HERE, outside the canvas, for two reasons: the sheet is manifest
    // data that needs no `<Canvas>`, and the hook MEMOISES what it parses — so
    // the object handed to `useClipPlayer` is stable, where a parse inside the
    // canvas component would restart the clip on every render.
    const animationSheet = useAnimationSheet(tacticsModelRefs.showcaseRigAnimated);
    const clipStatusRef = useRef<HTMLDivElement | null>(null);
    // The declared clip, and the ONE thing the toggle below changes. A clip
    // change is what `useClipPlayer` turns into a transition, so this state is
    // the route's only way to reach a blend at all — nothing else here can ask
    // for one, and the blend's length comes from the incoming clip's own sheet.
    const [clip, setClip] = useState<string>(tacticsShowcaseWaveClip.name);
    const toggleClip = useCallback(() => {
        setClip((current) =>
            current === tacticsShowcaseWaveClip.name
                ? tacticsShowcaseLeanClip.name
                : tacticsShowcaseWaveClip.name,
        );
    }, []);

    return (
        <div data-testid="tactics-model-showcase" style={screenStyle}>
            {/* No lights: both showcase rigs declare KHR_materials_unlit, which
                GLTFLoader maps to MeshBasicMaterial — nothing in this scene is
                lit, so a light could not change a pixel. */}
            <GameCanvas camera={SHOWCASE_CAMERA}>
                <TacticsModelShowcase
                    instanceA={toShowcaseInstance(modelA)}
                    instanceB={toShowcaseInstance(modelB)}
                    onReportA={setReportA}
                    onReportB={setReportB}
                />
                <TacticsAnimatedShowcase
                    playedInstance={animatedPlayed.instance}
                    controlInstance={animatedControl.instance}
                    sheet={animationSheet?.sheet ?? null}
                    clip={clip}
                    statusRef={clipStatusRef}
                />
            </GameCanvas>
            {/* Positioned, and after the canvas — camera-system.md §4.22
                "Canvas-fit rules". */}
            <TacticsModelShowcaseStatus reportA={reportA} reportB={reportB} />
            {/* Written imperatively from the frame loop, never rendered from
                state — see `TacticsAnimatedShowcase`'s header. Its attributes
                are absent until the first frame writes them, which is itself
                the "nothing is running" signal. */}
            <div
                data-testid="tactics-model-showcase-clip-status"
                ref={clipStatusRef}
                style={showcaseStatusStyle}
            />
            {/* The route's only control. It carries the declared clip as an
                attribute because a bone rotation cannot say WHY it moved: a spec
                reading only the bone cannot tell a transition that never started
                from one that started and cut. */}
            <Button
                data-testid="tactics-model-showcase-clip-toggle"
                data-showcase-clip={clip}
                onClick={toggleClip}
                size="sm"
                style={clipToggleStyle}
            >
                {clip === tacticsShowcaseWaveClip.name
                    ? `Play ${tacticsShowcaseLeanClip.name}`
                    : `Play ${tacticsShowcaseWaveClip.name}`}
            </Button>
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
 * XY plane facing +Z (x ±0.45, y 0→1.4 in both rigs), so this looks straight
 * down -Z at them and needs no corrective rotation. The frustum holds FOUR
 * quads — the seam pair and the clip-player pair — plus the posed one's
 * sideways swing, and is centred on the quads' mid-height. Module-level so
 * GameCanvas's reference-compared memo keeps one camera per mount.
 *
 * Widened in BOTH axes when the clip-player pair arrived, and by the same
 * factor: the authored aspect (1.6) is what the canvas-fit policy letterboxes
 * against, so widening only the horizontal would have re-framed the whole scene
 * rather than making room in it.
 */
const SHOWCASE_CAMERA = {
    mode: 'orthographic',
    position: [0, 0.7, 6],
    lookAt: [0, 0.7, 0],
    up: [0, 1, 0],
    frustum: { left: -3.4, right: 3.4, top: 2.125, bottom: -2.125, near: 0.1, far: 100 },
} as const satisfies OrthographicCameraConfig;

// No visible content — the element exists only to carry data attributes, so
// it needs no size; pointer-events stays off so it can never occlude the canvas.
const showcaseStatusStyle: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
};

/**
 * The clip toggle: absolutely positioned in a bottom corner, and pointer-events
 * stay ON because a click is the whole point of it.
 *
 * Out of flow because it is the only node on this screen with a box: in flow it
 * would push the canvas down, and the canvas is what every pixel assertion on
 * this route is read from. A corner because it overlaps the canvas wherever it
 * sits — the canvas fills the screen — and the quads are centred, so a corner is
 * where it costs the fewest of the magenta pixels `model-instances.spec.ts`
 * counts.
 */
const clipToggleStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    bottom: 0,
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
