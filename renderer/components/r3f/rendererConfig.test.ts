import { describe, expect, it } from 'vitest';
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
import {
    applyColorConfig,
    shadowsProp,
    type OutputColorSpace,
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
