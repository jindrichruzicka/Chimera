// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { installFakeDisplay } from './__test-support__/fakeDisplay';
import {
    applyColorConfig,
    readDeviceRatio,
    resolveRenderScale,
    resolveShadowQuality,
    shadowsProp,
    subscribeToDeviceRatio,
    UNRESTRICTED_SHADOW_QUALITY,
    type OutputColorSpace,
    type ShadowQuality,
    type ShadowQualityTier,
    type ToneMappingMode,
} from './rendererConfig';

type ColorState = Pick<WebGLRenderer, 'toneMapping' | 'toneMappingExposure' | 'outputColorSpace'>;

/** The three fields of a renderer this module is allowed to write. */
function rendererStandIn(): ColorState {
    return {
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1,
        outputColorSpace: SRGBColorSpace,
    };
}

describe('shadowsProp', () => {
    it("maps 'off' to r3f's own disabling value rather than a shadow-map type", () => {
        expect(shadowsProp('off')).toBe(false);
    });

    // r3f 9.6.1 reads a STRING through its own {basic, percentage, soft,
    // variance} table and writes the matching three constant itself, so these
    // four names need no constant here — passing the name through is the whole
    // mapping. `off` is the only one r3f has no name for.
    it('passes every enabled quality through as the r3f shadow-map name', () => {
        expect(shadowsProp('basic')).toBe('basic');
        expect(shadowsProp('percentage')).toBe('percentage');
        expect(shadowsProp('soft')).toBe('soft');
        expect(shadowsProp('variance')).toBe('variance');
    });
});

describe('applyColorConfig', () => {
    it('writes nothing when the game authored no colour knob', () => {
        const gl = rendererStandIn();

        applyColorConfig(gl, {});

        expect(gl).toEqual(rendererStandIn());
    });

    it('maps every tone-mapping name to its three constant', () => {
        const expected = {
            none: NoToneMapping,
            linear: LinearToneMapping,
            reinhard: ReinhardToneMapping,
            cineon: CineonToneMapping,
            'aces-filmic': ACESFilmicToneMapping,
            agx: AgXToneMapping,
            neutral: NeutralToneMapping,
        } satisfies Record<ToneMappingMode, number>;

        for (const [name, constant] of Object.entries(expected)) {
            const gl = rendererStandIn();
            applyColorConfig(gl, { toneMapping: name as ToneMappingMode });
            expect(gl.toneMapping, name).toBe(constant);
        }
    });

    it('maps every output colour space name to its three constant', () => {
        const expected = {
            srgb: SRGBColorSpace,
            linear: LinearSRGBColorSpace,
        } satisfies Record<OutputColorSpace, string>;

        for (const [name, constant] of Object.entries(expected)) {
            const gl = rendererStandIn();
            applyColorConfig(gl, { outputColorSpace: name as OutputColorSpace });
            expect(gl.outputColorSpace, name).toBe(constant);
        }
    });

    it('writes the exposure as the plain multiplier it is', () => {
        const gl = rendererStandIn();

        applyColorConfig(gl, { toneMappingExposure: 1.4 });

        expect(gl.toneMappingExposure).toBe(1.4);
    });

    // An exposure of 0 is a legitimate authored value (a fully black frame while
    // a scene fades in), so the guard is on `undefined`, never on falsiness.
    it('writes an exposure of zero rather than treating it as unauthored', () => {
        const gl = rendererStandIn();

        applyColorConfig(gl, { toneMappingExposure: 0 });

        expect(gl.toneMappingExposure).toBe(0);
    });

    it('leaves the knobs the game did not author untouched', () => {
        const gl = rendererStandIn();

        applyColorConfig(gl, { toneMapping: 'none' });

        expect(gl.toneMappingExposure).toBe(1);
        expect(gl.outputColorSpace).toBe(SRGBColorSpace);
    });
});

/**
 * The precedence between a game's authored ceiling and the player's setting.
 *
 * The player's `display.shadowQuality` picks the tier; the game's `shadows`
 * prop CAPS how high that pick may go. A game therefore cannot spend a player's
 * GPU budget for them, and a player cannot ask for a tier the scene does not
 * support. Both directions are asserted, because a resolver that simply
 * returned one side would satisfy half the property.
 */
describe('resolveShadowQuality', () => {
    it('lets the player pick below the ceiling', () => {
        expect(resolveShadowQuality('low', 'soft')).toBe('basic');
    });

    // One case per tier that can be clamped, because the clamp is an
    // `indexOf` comparison: a name missing from the order returns -1, and
    // `-1 <= anything` is true, so a dropped entry disables the clamp for that
    // tier alone and every other case stays green.
    it.each([
        { tier: 'low', ceiling: 'off', expected: 'off' },
        { tier: 'medium', ceiling: 'basic', expected: 'basic' },
        { tier: 'high', ceiling: 'basic', expected: 'basic' },
        { tier: 'high', ceiling: 'percentage', expected: 'percentage' },
    ] as const)('clamps $tier down to a $ceiling ceiling', ({ tier, ceiling, expected }) => {
        expect(resolveShadowQuality(tier, ceiling)).toBe(expected);
    });

    it('gives a game that authored no ceiling the player pick unchanged', () => {
        expect(resolveShadowQuality('high', undefined)).toBe('soft');
        expect(resolveShadowQuality('off', undefined)).toBe('off');
    });

    // The engine default is 'off', so a player who has changed nothing gets a
    // canvas with shadow mapping disabled whatever the game authored — which is
    // what the canvas rendered before either setting existed.
    it("resolves the engine default tier to 'off' under any ceiling", () => {
        expect(resolveShadowQuality('off', 'variance')).toBe('off');
    });

    it('maps every player tier to a shadow-map name in ascending order', () => {
        const expected = {
            off: 'off',
            low: 'basic',
            medium: 'percentage',
            high: 'soft',
        } satisfies Record<ShadowQualityTier, ShadowQuality>;

        for (const [tier, quality] of Object.entries(expected)) {
            expect(resolveShadowQuality(tier as ShadowQualityTier, undefined), tier).toBe(quality);
        }
    });

    // The pinnable half of "'variance' is above every tier a player can name":
    // asserting it against `resolveShadowQuality(tier, undefined)` would be a
    // tautology, since the implementation substitutes one for the other. What
    // is real is that NO tier is clamped by it — a lower default would clamp
    // the tiers above it, which is what this catches.
    it('clamps no player tier at all', () => {
        const tiers: readonly ShadowQualityTier[] = ['off', 'low', 'medium', 'high'];

        for (const tier of tiers) {
            expect(resolveShadowQuality(tier, UNRESTRICTED_SHADOW_QUALITY), tier).toBe(
                resolveShadowQuality(tier, 'variance'),
            );
            expect(resolveShadowQuality(tier, UNRESTRICTED_SHADOW_QUALITY), tier).not.toBe(
                UNRESTRICTED_SHADOW_QUALITY,
            );
        }
    });
});

/**
 * The render scale is a FRACTION of whatever the game (or r3f) would otherwise
 * draw at, not an absolute device-pixel ratio. The two spellings are easy to
 * confuse: `GameCanvasProps.renderScale` is r3f's `dpr` and is absolute, while
 * `display.renderScale` is the player's fraction. This is the bridge.
 */
/**
 * r3f's own resolution, copied here as the REFERENCE the engine default must
 * reproduce. Asserting against the formula rather than against hand-copied
 * numbers is what keeps 'the default draws at what it always drew at' a
 * measurement instead of a restatement.
 */
function calculateDpr(dpr: number | readonly [number, number], deviceRatio: number): number {
    return Array.isArray(dpr) ? Math.min(Math.max(dpr[0], deviceRatio), dpr[1]) : (dpr as number);
}

describe('readDeviceRatio', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reads the browser's reported ratio", () => {
        vi.stubGlobal('devicePixelRatio', 2);

        expect(readDeviceRatio()).toBe(2);
    });

    // r3f's own fallback, and the only part of this function's contract no
    // reachable input in this app distinguishes — no worker mounts a canvas,
    // and an Electron renderer always reports a ratio. Pinned anyway, because
    // the header promises it.
    it('falls back to 2 where a window reports no ratio at all', () => {
        vi.stubGlobal('devicePixelRatio', undefined);

        expect(readDeviceRatio()).toBe(2);
    });
});

describe('subscribeToDeviceRatio', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('notifies when the display ratio changes, and not on subscribing', () => {
        const display = installFakeDisplay(1);
        const onChange = vi.fn();

        subscribeToDeviceRatio(onChange);
        expect(onChange).not.toHaveBeenCalled();

        display.setRatio(2);

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    // A `(resolution: Ndppx)` query is built for one ratio and fires as the
    // ratio leaves it. Hearing the SECOND change is what shows the listener
    // moved to a query for the ratio the display moved to.
    it('keeps notifying across successive changes', () => {
        const display = installFakeDisplay(1);
        const onChange = vi.fn();

        subscribeToDeviceRatio(onChange);
        display.setRatio(2);
        display.setRatio(1.5);

        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('notifies a subscription made at a fractional ratio', () => {
        const display = installFakeDisplay(1.25);
        const onChange = vi.fn();

        subscribeToDeviceRatio(onChange);
        display.setRatio(1.75);

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('holds one listener, not one per change it has heard', () => {
        const display = installFakeDisplay(1);

        subscribeToDeviceRatio(vi.fn());
        display.setRatio(2);
        display.setRatio(1.5);

        expect(display.liveListenerCount()).toBe(1);
    });

    // After a change the live listener is on a query the subscription built
    // LATER than the first one, so an unsubscribe holding only the first
    // would leave it behind.
    it('removes the listener it moved to when unsubscribed after a change', () => {
        const display = installFakeDisplay(1);
        const onChange = vi.fn();

        const unsubscribe = subscribeToDeviceRatio(onChange);
        display.setRatio(2);
        unsubscribe();
        display.setRatio(1.5);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(display.liveListenerCount()).toBe(0);
    });

    it('does not throw where there is no matchMedia', () => {
        expect(typeof window.matchMedia).toBe('undefined');

        expect(() => subscribeToDeviceRatio(vi.fn())()).not.toThrow();
    });

    it('does not throw where there is no window', () => {
        vi.stubGlobal('window', undefined);

        expect(() => subscribeToDeviceRatio(vi.fn())()).not.toThrow();
    });
});

describe('resolveRenderScale', () => {
    // The property the whole 'nothing visibly changes' claim rests on, over
    // every ceiling shape and every ratio a display reports — not one example.
    it.each([undefined, 1, 2, [1, 2], [0.5, 3]] as const)(
        "reproduces r3f's own resolution of ceiling %j at the engine default fraction",
        (ceiling) => {
            for (const deviceRatio of [1, 1.5, 2, 3]) {
                expect(resolveRenderScale(ceiling, 1, deviceRatio), String(deviceRatio)).toBe(
                    calculateDpr(ceiling ?? [1, 2], deviceRatio),
                );
            }
        },
    );

    // The defect a range ceiling hides: r3f clamps the DISPLAY's ratio into the
    // range, so scaling the range ENDS yields clamp(target, lo*f, hi*f) — which
    // on a devicePixelRatio of 1 is the same ratio for every fraction. The
    // player's setting would be inert on exactly the displays that need it.
    it.each([0.5, 0.75, 1])('scales the resolved ratio by %j on a 1x display', (fraction) => {
        expect(resolveRenderScale(undefined, fraction, 1)).toBe(fraction);
    });

    it('scales the resolved ratio on a 2x display', () => {
        expect(resolveRenderScale(undefined, 0.5, 2)).toBe(1);
    });

    it('scales a fixed ceiling, which no display ratio enters', () => {
        expect(resolveRenderScale(2, 0.75, 1)).toBe(1.5);
        expect(resolveRenderScale(2, 0.75, 3)).toBe(1.5);
    });

    it('clamps the display ratio into a range ceiling before scaling', () => {
        // 3 is above the ceiling's top, so the top is what scales.
        expect(resolveRenderScale([1, 2], 0.5, 3)).toBe(1);
        // 0.5 is below the ceiling's floor, so the floor is what scales.
        expect(resolveRenderScale([1, 2], 0.5, 0.5)).toBe(0.5);
    });

    // A zero-area drawing buffer is not a coarse render, it is a broken one.
    it('never resolves to zero', () => {
        expect(resolveRenderScale(0, 0.5, 1)).toBeGreaterThan(0);
        expect(resolveRenderScale([0, 0], 0.5, 1)).toBeGreaterThan(0);
    });
});
