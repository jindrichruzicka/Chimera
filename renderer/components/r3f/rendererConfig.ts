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

// ── Resolving a player setting against a game's ceiling (§4.13 → §4.22) ──────
//
// Two vocabularies meet here, and they are easy to confuse because one word
// spans both. `display.shadowQuality` is a player TIER (`off` | `low` |
// `medium` | `high`); `GameCanvasProps.shadows` is a shadow-map NAME and is the
// game's ceiling. `display.renderScale` is a FRACTION of what would otherwise
// be drawn; `GameCanvasProps.renderScale` is r3f's `dpr` and is ABSOLUTE.
//
// The precedence is one rule in both cases: the player's setting chooses, the
// game's prop caps. A game therefore cannot spend a player's GPU budget for
// them, and a player cannot ask for more than the scene supports. A game that
// authors nothing imposes no cap, so the player's setting stands alone — and at
// the engine defaults (`off`, `1`) that reproduces what the canvas rendered
// before either setting existed. The shadow clamp has no floor, deliberately —
// camera-system.md §4.22 "Precedence" says why.

/** The player-facing quality tiers stored in `display.shadowQuality`. */
export type ShadowQualityTier = 'off' | 'low' | 'medium' | 'high';

/**
 * Shadow-map names in ascending cost. The ORDER is the clamp: an index
 * comparison is what makes "at or below the ceiling" mean anything.
 */
const SHADOW_QUALITY_ORDER = [
    'off',
    'basic',
    'percentage',
    'soft',
    'variance',
] as const satisfies readonly ShadowQuality[];

/**
 * The ceiling a game that authored none is treated as having — the top of the
 * order, so it restricts nothing. It is a real, authorable value rather than a
 * sentinel, which is why the "no ceiling" and "unrestricted ceiling" paths
 * resolve identically.
 */
export const UNRESTRICTED_SHADOW_QUALITY: ShadowQuality = 'variance';

/** The shadow-map name each player tier asks for, before any ceiling applies. */
const TIER_SHADOW_QUALITY = {
    off: 'off',
    low: 'basic',
    medium: 'percentage',
    high: 'soft',
} as const satisfies Record<ShadowQualityTier, ShadowQuality>;

/**
 * r3f's own `dpr` default. It is a destructuring default inside `configure()`,
 * so it applies to a prop passed as `undefined` exactly as to an absent key —
 * which is why a canvas that authors no ceiling has always drawn at this.
 */
export const DEFAULT_RENDER_SCALE: RenderScale = [1, 2];

/**
 * The smallest ratio a resolved render scale may reach, so a coarse setting
 * renders coarsely rather than degenerating to a zero-area drawing buffer.
 */
const MIN_RENDER_SCALE = 0.01;

/** The effective shadow-map name for a player tier under a game's ceiling. */
export function resolveShadowQuality(
    tier: ShadowQualityTier,
    ceiling: ShadowQuality | undefined,
): ShadowQuality {
    const requested = TIER_SHADOW_QUALITY[tier];
    const capped = ceiling ?? UNRESTRICTED_SHADOW_QUALITY;

    return SHADOW_QUALITY_ORDER.indexOf(requested) <= SHADOW_QUALITY_ORDER.indexOf(capped)
        ? requested
        : capped;
}

/**
 * The effective `dpr` for a player fraction under a game's authored ceiling —
 * always a SCALAR, and that is the whole of this function's difficulty.
 *
 * A range ceiling cannot simply have its ends scaled. r3f resolves a range by
 * clamping the DISPLAY's own ratio into it (`calculateDpr`:
 * `Math.min(Math.max(dpr[0], target), dpr[1])`), so scaling the ends yields
 * `clamp(target, lo·f, hi·f)` — which is not `f ×` anything, and on a
 * `devicePixelRatio` of 1 leaves every fraction resolving to the same ratio.
 * The player's setting would be inert on exactly the displays that need it
 * most. Resolving the range HERE and scaling the result is what makes the
 * fraction mean what it says.
 *
 * At `fraction === 1` this returns what r3f's own `calculateDpr` returns for
 * the same ceiling, so the engine default reproduces the ratio the canvas drew
 * at before the setting existed — asserted against that formula rather than
 * against a hand-copied number.
 */
export function resolveRenderScale(
    ceiling: RenderScale | undefined,
    fraction: number,
    deviceRatio: number,
): number {
    const capped = ceiling ?? DEFAULT_RENDER_SCALE;
    const resolved =
        typeof capped === 'number' ? capped : Math.min(Math.max(capped[0], deviceRatio), capped[1]);

    return Math.max(resolved * fraction, MIN_RENDER_SCALE);
}

/**
 * The display's device-pixel ratio, read the way r3f reads it — including its
 * fallback of 2 for a context where `window` exists but the ratio does not
 * (a worker), and 1 where there is no `window` at all.
 */
export function readDeviceRatio(): number {
    return typeof window !== 'undefined' ? (window.devicePixelRatio ?? 2) : 1;
}

/**
 * Calls `onChange` when the display's device-pixel ratio changes, and returns
 * the unsubscribe — the `useSyncExternalStore` subscription whose snapshot is
 * `readDeviceRatio`.
 *
 * A `(resolution: Ndppx)` query is built for one ratio and reports a change as
 * the ratio leaves it; the listener then moves to a query for the ratio the
 * display moved to.
 *
 * Where there is no `matchMedia` — jsdom, which a scaffolded game's own
 * component tests render in — nothing is subscribed.
 */
export function subscribeToDeviceRatio(onChange: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
    }

    const queryCurrentRatio = (): MediaQueryList =>
        window.matchMedia(`(resolution: ${readDeviceRatio()}dppx)`);

    let query = queryCurrentRatio();
    const handleChange = (): void => {
        query.removeEventListener('change', handleChange);
        query = queryCurrentRatio();
        query.addEventListener('change', handleChange);
        onChange();
    };
    query.addEventListener('change', handleChange);

    return () => query.removeEventListener('change', handleChange);
}
