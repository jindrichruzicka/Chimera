'use client';

import { Canvas, useThree } from '@react-three/fiber';
import type { Camera, RootState } from '@react-three/fiber';
import React from 'react';
import type { ReactNode } from 'react';
import { PerfProbe } from '../shell/perf/PerfProbe';
import { FrameRateLimiter } from './FrameRateLimiter';
import { InteractionBlocker } from './InteractionBlocker';
import {
    DEFAULT_CAMERA_FIT,
    expandFrustumToAspect,
    expandPerspectiveToAspect,
    frustumAspect,
    letterboxCanvasBox,
} from './cameraFit';
import type { CameraFit, CanvasBox } from './cameraFit';
import { registerMainCanvas } from './mainCanvasRegistry';
import {
    applyColorConfig,
    readDeviceRatio,
    resolveRenderScale,
    resolveShadowQuality,
    shadowsProp,
} from './rendererConfig';
import { selectRenderScaleFraction, selectShadowQualityTier } from './selectDisplayQuality';
import { useFrozenContextOptions } from './useFrozenContextOptions';
import type {
    ColorConfigurableRenderer,
    OutputColorSpace,
    RendererColorConfig,
    RenderScale,
    ShadowQuality,
    ToneMappingMode,
    WebGLContextOptions,
} from './rendererConfig';
import { useEngineFrameloop } from './useEngineFrameloop';
import { useSettingsStore } from '../../state/settingsStore';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { Vector3Tuple } from '../../types/r3f-types.js';

export type CameraMode = 'perspective' | 'orthographic';
export type CameraPreset = 'isometric' | 'top-down' | 'side-scrolling' | 'free';
export type { Vector3Tuple } from '../../types/r3f-types.js';
export type { CameraFit } from './cameraFit';
export type {
    OutputColorSpace,
    PowerPreference,
    RenderScale,
    ShadowQuality,
    ToneMappingMode,
    WebGLContextOptions,
} from './rendererConfig';

/**
 * World-unit orthographic view volume. An explicit frustum always marks the
 * camera `manual`: without it, R3F rewrites ortho frusta to pixel half-extents
 * on every canvas resize, silently discarding the author's world framing.
 */
export type OrthographicFrustum = Readonly<{
    left: number;
    right: number;
    top: number;
    bottom: number;
    near?: number; // default 0.1
    far?: number; // default 1000
}>;

export type PerspectiveCameraConfig = Readonly<{
    mode: 'perspective';
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
    up?: Vector3Tuple; // default [0, 1, 0]; applied before lookAt
    fov?: number; // default 50
    near?: number; // default 0.1
    far?: number; // default 1000
    /**
     * Pins the aspect ratio and marks the camera `manual`; omit to let R3F
     * maintain the aspect on resize (the default and usual choice).
     */
    aspect?: number;
    /**
     * How a canvas aspect that diverges from the pinned `aspect` is resolved;
     * default `'letterbox'`. Inert without a pinned `aspect` — a responsive
     * perspective camera has no divergence to resolve.
     */
    fit?: CameraFit;
}>;

export type OrthographicCameraConfig = Readonly<{
    mode: 'orthographic';
    position: Vector3Tuple;
    lookAt: Vector3Tuple;
    up?: Vector3Tuple; // default [0, 1, 0]; applied before lookAt
    frustum: OrthographicFrustum;
    /**
     * How a canvas aspect that diverges from the frustum's own aspect
     * (`(right - left) / (top - bottom)`) is resolved; default `'letterbox'`.
     * Overriding the aspect means writing the frustum ratio you want — that
     * ratio IS the camera's aspect, so there is no separate `aspect` field.
     */
    fit?: CameraFit;
}>;

export type CameraConfig = PerspectiveCameraConfig | OrthographicCameraConfig;

/** Named preset (documented mode + defaults) or a fully explicit config. */
export type GameCanvasCamera = CameraPreset | CameraConfig;

export type GameCanvasProps = Readonly<{
    camera: GameCanvasCamera;
    children: ReactNode;
    /**
     * Which canvas this is. The `'main'` canvas (the default) publishes perf
     * metrics; an `'overlay'` (minimap, preview) mounts no `PerfProbe`, so the
     * HUD keeps measuring the main scene. Both roles are paced by the
     * `display.targetFps` cap. Mounting two concurrent mains is reported by
     * name through the renderer logger — logged, not thrown.
     */
    role?: 'main' | 'overlay';
    /**
     * Forwarded to the r3f wrapper `<div>` for canvas chrome. r3f pins
     * position and size as inline styles on that div, so placement and the
     * explicit size live on a game-owned wrapper element — this class can
     * never re-place or re-size the canvas. Once a `letterbox` fit pins a box,
     * that div IS the fitted box, so chrome (border, radius) follows the
     * visible canvas rather than the bars.
     *
     * For a full-window scene that wrapper is the screen's ROOT element and
     * wants `position: absolute; inset: 0`. Sizing it any other way fails
     * quietly in one of two ways — camera-system.md §4.22 "Sizing the wrapper"
     * is where both are written out, and `GameShell.test.tsx` pins the host
     * geometry they turn on.
     */
    className?: string;
    /** Forwarded to the r3f `<Canvas>` `onPointerMissed` (deselect-on-empty-click). */
    onPointerMissed?: (event: MouseEvent) => void;
    /**
     * The highest shadow-map quality this canvas will run at — a CEILING, not
     * the value applied. The player's `display.shadowQuality` picks the tier
     * and this caps how high that pick may go, so a game cannot spend a
     * player's GPU budget for them and a player cannot ask for more than the
     * scene supports. Omitted imposes no cap.
     *
     * At the engine default tier (`off`) the canvas has shadow mapping
     * disabled whatever this says, which is what it has always done — a mesh's
     * `castShadow` is inert until the PLAYER turns shadows on and the scene has
     * a light that casts.
     *
     * The value is an engine name, never a `three` constant: the mapping lives
     * in `rendererConfig.ts` so a game configuring the renderer imports neither
     * `three` nor `Canvas` (Invariant #127).
     */
    shadows?: ShadowQuality;
    /**
     * Tone-mapping curve; omitted keeps r3f's ACES filmic default.
     *
     * This and the two below are applied to the live renderer, so a change
     * takes effect without remounting the canvas. REMOVING one after it was
     * set does not restore the default: a renderer has no unset state, and
     * writing r3f's default back would overwrite whatever else set the field.
     * Author the value you want rather than dropping the prop.
     */
    toneMapping?: ToneMappingMode;
    /** Tone-mapping exposure multiplier; omitted keeps the renderer's `1`. */
    toneMappingExposure?: number;
    /** Output colour space; omitted keeps r3f's sRGB default. */
    outputColorSpace?: OutputColorSpace;
    /**
     * The device-pixel ratio to draw at before the player's scale applies — a
     * fixed multiplier, or a `[min, max]` range clamped against the display's
     * own ratio. Omitted uses r3f's `[1, 2]`. This is r3f's `dpr` under an
     * engine name; `dpr` itself stays rejected so one spelling owns the
     * concern.
     *
     * Note the two `renderScale`s are different quantities and do not mean
     * the same thing: this one is the CEILING r3f would resolve against, while
     * the player's `display.renderScale` is a fraction of what that resolution
     * yields. A range ceiling is resolved by clamping the display's own ratio
     * into it — r3f's own formula — and the player's fraction scales the
     * result, so at the engine default fraction the canvas draws at the ratio
     * r3f itself would have chosen for this ceiling. The FORMULA is r3f's; the
     * cadence is not, since the ratio is read where this component renders.
     */
    renderScale?: RenderScale;
    /**
     * WebGL context attributes, fixed when the context is BUILT.
     *
     * A nested object rather than flat props, and that shape is the contract:
     * everything above it can still move, everything inside it cannot. What
     * that separation is worth at the type level is bounded — TypeScript's
     * excess-property check bites a fresh object LITERAL, so a widened
     * variable or a spread reaches through either way. The literal case is
     * what the `@ts-expect-error` block in `GameCanvas.test.tsx` measures, in
     * both directions.
     *
     * Changing a value after mount cannot take effect, so it is refused
     * observably rather than ignored: the canvas keeps what it mounted with
     * and the differing keys are named through the renderer logger. To build a
     * context with different attributes, remount the canvas under a new React
     * `key`.
     */
    contextOptions?: WebGLContextOptions;
}>;

// Each preset carries its documented projection mode (camera-system.md preset
// table); a game wanting a preset viewpoint in the other mode writes the
// explicit config instead.
//
// The orthographic frusta are 20 x 12.5 world units — aspect 1.6, a shape real
// displays have. A preset is authored blind to the player's monitor, so no
// frustum ratio can match every canvas; the default `letterbox` fit is what
// makes this one render undistorted on the ones it does not match.
const cameraPresetConfigs = {
    isometric: {
        mode: 'orthographic',
        position: [10, 10, 10],
        lookAt: [0, 0, 0],
        frustum: { left: -10, right: 10, top: 6.25, bottom: -6.25 },
    },
    'top-down': {
        mode: 'orthographic',
        position: [0, 20, 0],
        lookAt: [0, 0, 0],
        frustum: { left: -10, right: 10, top: 6.25, bottom: -6.25 },
    },
    'side-scrolling': { mode: 'perspective', position: [0, 5, 15], lookAt: [0, 5, 0] },
    free: { mode: 'perspective', position: [0, 5, 10], lookAt: [0, 0, 0] },
} satisfies Record<CameraPreset, CameraConfig>;

const DEFAULT_UP: Vector3Tuple = [0, 1, 0];
const DEFAULT_FOV = 50;

/**
 * The engine-owned box the fit policy works in. It declares no layout mode of
 * its own, so with nothing pinned the r3f wrapper resolves its size against a
 * box of the same shape it resolved against before this frame existed, and the
 * game's wrapper sizing rules ("Sizing the wrapper", §4.22) are untouched.
 * Inert to the pointer, so a click on a bar is not absorbed by the engine box
 * and reaches whatever the game has behind it; this module passes no
 * `eventSource`, so r3f 9.6.1 keeps `pointer-events: auto` on its own wrapper
 * and the canvas itself stays hit-testable.
 *
 * What a game must do to keep an overlay above the scrim: camera-system.md
 * §4.22 "Canvas-fit rules".
 */
const fitFrameStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
};

/**
 * The same frame once a remainder actually exists — `letterboxCanvasBox`
 * returns a box only then, so a canvas that already fills its frame has nothing
 * pinned on it and nothing painted behind it. What the scrim reaches beyond the
 * bars: camera-system.md §4.22 "Canvas-fit rules".
 */
const letterboxedFitFrameStyle: React.CSSProperties = {
    ...fitFrameStyle,
    backgroundColor: 'var(--ch-color-scrim)',
};

export function GameCanvas({
    camera,
    children,
    role = 'main',
    className,
    onPointerMissed,
    shadows,
    toneMapping,
    toneMappingExposure,
    outputColorSpace,
    renderScale,
    contextOptions,
}: GameCanvasProps): React.ReactElement {
    // `resolveCameraConfig` returns either the caller's own object or a
    // module-level preset, so it is already stable per `camera` and needs no
    // memo of its own — which is what lets the camera memo and the expand
    // effect below key off it.
    const config = resolveCameraConfig(camera);
    const cameraInstance = React.useMemo(() => createCamera(config), [config]);
    // Both halves of the frame-rate cap — the prop below and the
    // <FrameRateLimiter /> driver inside; see selectTargetFps.ts for why they
    // must read one cap.
    const frameloop = useEngineFrameloop();
    // The value r3f built the context from, whatever later renders pass.
    const mountedContextOptions = useFrozenContextOptions(contextOptions);
    // The player's half of each quality knob. Both are read here, at the canvas
    // root, for the same reason the frame-rate cap is: it is the one place an
    // engine-wide display setting can apply to whatever a game renders
    // (Invariant #127). Both take effect on a store change without remounting
    // the canvas — r3f re-runs configure() from a layout effect with no
    // dependency array, and writes the shadow map and the dpr on every pass.
    const shadowTier = useSettingsStore(selectShadowQualityTier);
    const renderScaleFraction = useSettingsStore(selectRenderScaleFraction);

    const frameRef = React.useRef<HTMLDivElement | null>(null);
    const fit = config.fit ?? DEFAULT_CAMERA_FIT;
    // `null` for a responsive perspective camera: R3F keeps its aspect correct
    // itself, so there is no divergence for any policy to resolve.
    const manualAspect = manualCameraAspect(config);
    const fittedBox = useLetterboxedCanvasBox(frameRef, fit === 'letterbox' ? manualAspect : null);

    React.useEffect(() => {
        if (role !== 'main') {
            return;
        }
        return registerMainCanvas();
    }, [role]);

    return (
        <div ref={frameRef} style={fittedBox === null ? fitFrameStyle : letterboxedFitFrameStyle}>
            <Canvas
                camera={cameraInstance}
                frameloop={frameloop}
                className={className}
                // r3f merges this over its own wrapper styles, so the fitted
                // size replaces its 100%/100% fill. Why that is the box r3f then
                // reports as `state.size` — and why it has to be:
                // camera-system.md §4.22 "Canvas-fit rules".
                {...(fittedBox === null ? {} : { style: fittedCanvasStyle(fittedBox) })}
                // r3f types onPointerMissed without `| undefined`, so under
                // exactOptionalPropertyTypes the key must be omitted, not set to
                // undefined.
                {...(onPointerMissed ? { onPointerMissed } : {})}
                // Resolved, never authored: the player's setting picks and the
                // game's prop caps. Both keys are always emitted, because the
                // player's choice has to reach a canvas whose game authored no
                // ceiling at all. Emitting them changes nothing on its own —
                // `configure()` destructures `shadows = false` and
                // `dpr = [1, 2]`, and a destructuring default applies to a key
                // passed as `undefined` exactly as to an absent one — so at the
                // engine defaults the canvas resolves to what it always did.
                shadows={shadowsProp(resolveShadowQuality(shadowTier, shadows))}
                dpr={resolveRenderScale(renderScale, renderScaleFraction, readDeviceRatio())}
                // The FROZEN options, so what r3f builds the context from
                // never changes; the key is omitted entirely when the game
                // authored nothing, so r3f's own defaults build the context.
                // The engine passes this, never a game — a raw `gl` prop is
                // the pass-through Invariant #127 keeps out of game files.
                {...(mountedContextOptions === undefined ? {} : { gl: mountedContextOptions })}
            >
                {role === 'main' ? <PerfProbe /> : null}
                <FrameRateLimiter />
                <ApplyColorConfig
                    toneMapping={toneMapping}
                    toneMappingExposure={toneMappingExposure}
                    outputColorSpace={outputColorSpace}
                />
                {fit === 'expand' ? <ExpandCameraToCanvas config={config} /> : null}
                {/*
                 * Pointer gating for everything the game renders (§4.23). Mounted
                 * INSIDE the `<Canvas>` rather than around it: the children that
                 * call `useGameInteraction` are r3f children, so providing the
                 * context here needs no assumption about whether React context
                 * crosses the r3f reconciler boundary. Every role gets one — the
                 * value is read from one store, so an overlay would compute the
                 * same `isBlocked` a main does.
                 */}
                <InteractionBlocker>{children}</InteractionBlocker>
            </Canvas>
        </div>
    );
}

/**
 * Writes the colour half of the curated configuration onto the live renderer.
 *
 * It lives INSIDE the `<Canvas>` because the renderer is R3F root state, and
 * because the alternative — handing r3f a raw `gl={…}` object — is the
 * pass-through shape Invariant #127 keeps out of game files. That a change
 * takes effect without remounting the canvas is measured by
 * `GameCanvas.test.tsx`'s `applies a changed '<knob>' without remounting the
 * canvas`, one case per knob.
 *
 * The three values are taken as separate props rather than one object so the
 * effect's dependencies ARE the authored values: a parent re-render with
 * unchanged knobs re-runs nothing.
 */
function ApplyColorConfig({
    toneMapping,
    toneMappingExposure,
    outputColorSpace,
}: RendererColorConfig): null {
    const gl = useThree(selectRenderer);

    React.useLayoutEffect(() => {
        applyColorConfig(gl, { toneMapping, toneMappingExposure, outputColorSpace });
    }, [gl, toneMapping, toneMappingExposure, outputColorSpace]);

    return null;
}

/** Narrowed at the selector, the way FrameRateLimiter narrows `advance`. */
function selectRenderer(state: RootState): ColorConfigurableRenderer {
    return state.gl;
}

/**
 * Grows the camera's frustum to the canvas aspect on every canvas size change
 * — the `'expand'` policy. It lives inside the `<Canvas>` because the canvas
 * size is R3F root state, and it recomputes from the AUTHORED config every
 * time so repeated resizes never compound.
 *
 * It writes whatever camera R3F has on root state, matched by class — normally
 * the one `createCamera` built, and a replacement a game installs from inside
 * the canvas (a `makeDefault` control) if it is of the config's kind.
 */
function ExpandCameraToCanvas({ config }: { readonly config: CameraConfig }): null {
    const camera = useThree((state) => state.camera);
    const width = useThree((state) => state.size.width);
    const height = useThree((state) => state.size.height);

    React.useLayoutEffect(() => {
        if (width <= 0 || height <= 0) {
            return;
        }
        expandCameraToAspect(camera, config, width / height);
    }, [camera, config, width, height]);

    return null;
}

/** The aspect a `manual` camera projects at; `null` when it is not manual. */
function manualCameraAspect(config: CameraConfig): number | null {
    return config.mode === 'orthographic' ? frustumAspect(config.frustum) : (config.aspect ?? null);
}

/**
 * Takes the canvas out of flow and centres it: with `inset: 0` and definite
 * dimensions, auto margins take the remainder equally on both axes. Why being
 * out of flow — and why these dimensions size the content box — is load-bearing:
 * camera-system.md §4.22 "Canvas-fit rules".
 */
function fittedCanvasStyle(box: CanvasBox): React.CSSProperties {
    return {
        position: 'absolute',
        inset: 0,
        margin: 'auto',
        width: `${box.width}px`,
        height: `${box.height}px`,
    };
}

/**
 * The fitted rect for `frameRef`'s current size, or `null` while there is
 * nothing to fit. The measurement is a layout effect, so the fitted size is
 * applied before the browser paints.
 */
function useLetterboxedCanvasBox(
    frameRef: React.RefObject<HTMLDivElement | null>,
    aspect: number | null,
): CanvasBox | null {
    const [box, setBox] = React.useState<CanvasBox | null>(null);

    React.useLayoutEffect(() => {
        const frame = frameRef.current;
        if (frame === null || aspect === null) {
            setBox(null);
            return;
        }

        const measure = (): void => {
            const rect = frame.getBoundingClientRect();
            // A collapsed frame carries no information about what to fit, so the
            // last box stands. That is what keeps a game wrapper of auto block
            // size — the common misconfiguration "Sizing the wrapper" (§4.22)
            // names — from oscillating: a pinned canvas is out of flow and
            // contributes no height, so the frame it collapses is the one being
            // measured, and clearing the box on that reading would un-pin it,
            // restore the height, and start over on the next notification.
            if (rect.width <= 0 || rect.height <= 0) {
                return;
            }
            const next = letterboxCanvasBox(rect, aspect);
            setBox((previous) => (isSameBox(previous, next) ? previous : next));
        };

        measure();

        // Absent wherever a jsdom-style environment renders no layout — a
        // scaffolded game's own component tests reach this. The layout-effect
        // measurement above still runs, so a canvas that never resizes is
        // fitted either way.
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(frame);

        return () => observer.disconnect();
    }, [frameRef, aspect]);

    return box;
}

function isSameBox(first: CanvasBox | null, second: CanvasBox | null): boolean {
    if (first === null || second === null) {
        return first === second;
    }

    return first.width === second.width && first.height === second.height;
}

/**
 * Apply the `'expand'` policy to the live camera. A perspective camera with no
 * pinned `aspect` reaches here too — `fit` is the only mount condition — and
 * matches neither branch: R3F keeps its aspect correct, so there is nothing to
 * grow and nothing to take over.
 */
function expandCameraToAspect(camera: Camera, config: CameraConfig, canvasAspect: number): void {
    if (config.mode === 'orthographic' && camera instanceof OrthographicCamera) {
        const grown = expandFrustumToAspect(config.frustum, canvasAspect);
        camera.left = grown.left;
        camera.right = grown.right;
        camera.top = grown.top;
        camera.bottom = grown.bottom;
        camera.updateProjectionMatrix();
        return;
    }

    if (
        config.mode === 'perspective' &&
        config.aspect !== undefined &&
        camera instanceof PerspectiveCamera
    ) {
        const grown = expandPerspectiveToAspect(
            config.fov ?? DEFAULT_FOV,
            config.aspect,
            canvasAspect,
        );
        camera.fov = grown.fov;
        camera.aspect = grown.aspect;
        camera.updateProjectionMatrix();
    }
}

function resolveCameraConfig(camera: GameCanvasCamera): CameraConfig {
    return typeof camera === 'string' ? cameraPresetConfigs[camera] : camera;
}

function createCamera(config: CameraConfig): Camera {
    const instance =
        config.mode === 'orthographic'
            ? createOrthographicCamera(config)
            : createPerspectiveCamera(config);

    orientCamera(instance, config);

    return instance;
}

function createOrthographicCamera(config: OrthographicCameraConfig): Camera {
    const { frustum } = config;
    const camera: Camera = new OrthographicCamera(
        frustum.left,
        frustum.right,
        frustum.top,
        frustum.bottom,
        frustum.near ?? 0.1,
        frustum.far ?? 1000,
    );

    // A world-unit frustum must survive canvas resizes: without `manual`,
    // R3F's updateCamera() replaces left/right/top/bottom with pixel
    // half-extents. `manual` also opts out of R3F's only aspect hook, which is
    // why the frustum's own aspect is reconciled with the canvas here instead,
    // by the config's `fit` policy.
    camera.manual = true;

    return camera;
}

function createPerspectiveCamera(config: PerspectiveCameraConfig): Camera {
    const camera: Camera = new PerspectiveCamera(
        config.fov ?? DEFAULT_FOV,
        config.aspect ?? 1,
        config.near ?? 0.1,
        config.far ?? 1000,
    );

    if (config.aspect !== undefined) {
        camera.manual = true; // pinned aspect: opt out of R3F resize correction
    }

    return camera;
}

function orientCamera(camera: Camera, config: CameraConfig): void {
    camera.up.set(...(config.up ?? DEFAULT_UP)); // before lookAt: lookAt derives roll from up
    camera.position.set(...config.position); // before lookAt: lookAt aims from the position
    camera.lookAt(new Vector3(...config.lookAt));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
}
