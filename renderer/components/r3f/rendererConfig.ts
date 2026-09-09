/**
 * renderer/components/r3f/rendererConfig.ts
 *
 * The engine-owned names for `<GameCanvas>`'s curated renderer knobs, and
 * where those names become `three` constants (§4.22).
 *
 * A game names `'aces-filmic'`, never `THREE.ACESFilmicToneMapping`: the prop
 * values are engine vocabulary, so a game configuring shadows, tone mapping,
 * output colour space and render scale imports neither `three` nor `Canvas`.
 * That is also what keeps a stored `display.*` setting an engine-owned name —
 * Invariant #1 forbids `simulation/` from naming a `three` symbol, and this
 * module is the renderer-side half that makes the name mean something.
 *
 * Where the tables may live: nothing the always-mounted shell layout chunk
 * reaches through a static VALUE edge may name `three`
 * (`renderer/__tests__/shell-layout-graph-census.test.ts`). This module is
 * reached only from `GameCanvas`, which already imports `three` at module scope
 * for its camera constructors and is therefore off that graph — see
 * camera-system.md §4.22 "Where a named-mode mapping table may live" before
 * adding a table to a module the layout does reach.
 *
 * Why the colour knobs are WRITTEN here rather than handed to `<Canvas>`: a
 * raw `gl={…}` pass-through is the shape Invariant #127 exists to keep out of
 * game files, so the curated props carry the concern and `GameCanvas` applies
 * them from a null component INSIDE the canvas, where the renderer is root
 * state. What that buys — a change takes effect without remounting the canvas
 * — is measured, not argued: `GameCanvas.test.tsx`'s
 * `applies a changed '<knob>' without remounting the canvas`.
 */

import {
    ACESFilmicToneMapping,
    AgXToneMapping,
    CineonToneMapping,
    LinearSRGBColorSpace,
    LinearToneMapping,
    NeutralToneMapping,
    NoToneMapping,
    ReinhardToneMapping,
    SRGBColorSpace,
} from 'three';
import type { WebGLRenderer } from 'three';

/**
 * Shadow-map quality. `'off'` disables shadow mapping entirely; the other four
 * are r3f's own shadow-map names, which it resolves to three's `BasicShadowMap`,
 * `PCFShadowMap`, `PCFSoftShadowMap` and `VSMShadowMap`.
 */
export type ShadowQuality = 'off' | 'basic' | 'percentage' | 'soft' | 'variance';

/** Tone-mapping curve applied when the renderer presents a frame. */
export type ToneMappingMode =
    | 'none'
    | 'linear'
    | 'reinhard'
    | 'cineon'
    | 'aces-filmic'
    | 'agx'
    | 'neutral';

/** Colour space the renderer writes to the canvas. */
export type OutputColorSpace = 'srgb' | 'linear';

/**
 * Device-pixel ratio the renderer draws at: a fixed multiplier, or a
 * `[min, max]` range clamped against the display's own ratio.
 */
export type RenderScale = number | readonly [number, number];

/**
 * Power hint the browser weighs when it picks a GPU for the context.
 *
 * Spelled out rather than taken from the DOM's `WebGLPowerPreference` so the
 * whole curated surface reads in one vocabulary — the same reason the tone
 * mapping and shadow values are engine names.
 */
export type PowerPreference = 'default' | 'high-performance' | 'low-power';

/**
 * The WebGL context attributes, which are fixed when the context is BUILT.
 *
 * The frozen half of `<GameCanvas>`'s configuration, and a nested object for
 * exactly that reason. What the shape does and does not buy is on the
 * `contextOptions` prop in `GameCanvas.tsx`, which is the copy a guard mirrors
 * into camera-system.md.
 */
export type WebGLContextOptions = Readonly<{
    antialias?: boolean;
    alpha?: boolean;
    powerPreference?: PowerPreference;
    stencil?: boolean;
    preserveDrawingBuffer?: boolean;
}>;

/**
 * Every key `WebGLContextOptions` carries, for the drift comparison.
 *
 * Derived from a `Record<keyof …, true>` rather than written as a tuple,
 * because the record is what makes the compiler ENFORCE the enumeration: a
 * literal missing a key is TS2741 and one carrying an extra is TS2353. A
 * `satisfies readonly (keyof …)[]` on a tuple checks MEMBERSHIP only, so a
 * sixth option added to the type and forgotten here would compile — and be
 * silently uncompared, which is a context change accepted without a word.
 */
const contextOptionKeyFlags: Record<keyof WebGLContextOptions, true> = {
    antialias: true,
    alpha: true,
    powerPreference: true,
    stencil: true,
    preserveDrawingBuffer: true,
};

export const WEBGL_CONTEXT_OPTION_KEYS = Object.keys(
    contextOptionKeyFlags,
) as readonly (keyof WebGLContextOptions)[];

/** The three renderer fields `applyColorConfig` is allowed to write. */
export type ColorConfigurableRenderer = Pick<
    WebGLRenderer,
    'toneMapping' | 'toneMappingExposure' | 'outputColorSpace'
>;

/**
 * The colour half of the curated configuration — the knobs r3f cannot carry.
 *
 * Each field is explicitly `| undefined`, unlike the props on
 * `GameCanvasProps`. This is the INTERNAL shape, built by reading three
 * optional props: under `exactOptionalPropertyTypes` an unset optional prop
 * READS as `undefined`, so a bare `?:` here would reject the very object
 * GameCanvas constructs. The public props stay bare `?:`, which is what keeps
 * `toneMapping={undefined}` from being a legal way to author "no curve".
 */
export type RendererColorConfig = Readonly<{
    toneMapping?: ToneMappingMode | undefined;
    toneMappingExposure?: number | undefined;
    outputColorSpace?: OutputColorSpace | undefined;
}>;

const toneMappingConstants = {
    none: NoToneMapping,
    linear: LinearToneMapping,
    reinhard: ReinhardToneMapping,
    cineon: CineonToneMapping,
    'aces-filmic': ACESFilmicToneMapping,
    agx: AgXToneMapping,
    neutral: NeutralToneMapping,
} satisfies Record<ToneMappingMode, WebGLRenderer['toneMapping']>;

const outputColorSpaceConstants = {
    srgb: SRGBColorSpace,
    linear: LinearSRGBColorSpace,
} satisfies Record<OutputColorSpace, WebGLRenderer['outputColorSpace']>;

/**
 * The value r3f's `shadows` prop takes for an engine quality name.
 *
 * Only `'off'` needs translating: r3f reads the other four through its own
 * string table and writes the three constant itself, so this maps a name to a
 * name rather than to a constant. `false` is what disables the map — r3f does
 * `gl.shadowMap.enabled = !!shadows`.
 */
export function shadowsProp(quality: ShadowQuality): boolean | Exclude<ShadowQuality, 'off'> {
    return quality === 'off' ? false : quality;
}

/**
 * Write the authored colour knobs onto a live renderer. A knob the game did not
 * author is left exactly as r3f configured it, so omitting the props reproduces
 * r3f's own defaults — sRGB output and the ACES filmic curve.
 *
 * The guards test for `undefined`, never for falsiness: an exposure of `0` is a
 * legitimate authored value.
 */
export function applyColorConfig(gl: ColorConfigurableRenderer, config: RendererColorConfig): void {
    if (config.toneMapping !== undefined) {
        gl.toneMapping = toneMappingConstants[config.toneMapping];
    }
    if (config.toneMappingExposure !== undefined) {
        gl.toneMappingExposure = config.toneMappingExposure;
    }
    if (config.outputColorSpace !== undefined) {
        gl.outputColorSpace = outputColorSpaceConstants[config.outputColorSpace];
    }
}
