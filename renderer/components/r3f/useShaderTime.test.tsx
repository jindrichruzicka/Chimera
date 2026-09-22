// @vitest-environment jsdom

/**
 * renderer/components/r3f/useShaderTime.test.tsx
 *
 * The supported time uniform: engine time in, a stable `{ value }` a shader can
 * be handed out.
 *
 * **Why the dilation case is the load-bearing one.** A hand-rolled time uniform
 * built on the frame clock works perfectly until the player enables slow motion,
 * and that is the worst possible moment to discover it does not dilate. So the
 * assertion that separates this helper from the naive version is not "the value
 * advances" — it is "the value advances by the DILATED amount".
 *
 * **Why both frame rates are driven.** The frame limiter paces the loop, so a
 * capped game sees fewer, larger deltas. What each arm measures is the value
 * against WALL TIME — a uniform accumulating per FRAME rather than per delta
 * reads wrong at any rate but the one it was tuned for. The cross-arm comparison
 * is the weak assertion of the pair: for any delta-accumulating implementation it
 * follows from equal-step summation, so the absolute assertions are what carry
 * the test.
 */

import { act, cleanup, render } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimeScaleStore } from '../../animation/timeScaleStore.js';
import { resetFakeFiberRoot, update } from './__test-support__/fakeFiberRoot';
import { useShaderTime } from './useShaderTime';
import type { ShaderTimeUniform } from './useShaderTime';

vi.mock('@react-three/fiber', () => import('./__test-support__/fakeFiberRoot'));

/** Every uniform the hook handed out, newest last. */
const handed: ShaderTimeUniform[] = [];

function Probe(): React.ReactElement | null {
    handed.push(useShaderTime());
    return null;
}

/** The uniform the most recent render was given. */
function current(): ShaderTimeUniform {
    const uniform = handed.at(-1);
    if (uniform === undefined) {
        throw new Error('the hook handed out no uniform');
    }
    return uniform;
}

let frameClockSeconds = 0;

/** Drive `seconds` of engine time as `frames` equal deltas. */
function driveSeconds(seconds: number, frames: number): void {
    const step = seconds / frames;
    for (let index = 0; index < frames; index += 1) {
        frameClockSeconds += step;
        act(() => {
            update(frameClockSeconds);
        });
    }
}

beforeEach(() => {
    resetFakeFiberRoot();
    frameClockSeconds = 0;
    handed.length = 0;
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

afterEach(() => {
    cleanup();
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

describe('useShaderTime follows engine time', () => {
    it('starts at zero and advances with the frame loop', () => {
        render(<Probe />);

        expect(current().value).toBe(0);

        driveSeconds(1, 60);

        expect(current().value).toBeCloseTo(1, 5);
    });

    it('advances by the DILATED amount when the match is in slow motion', () => {
        // The assertion that catches the wrong implementation. A uniform driven
        // straight off the frame delta passes every other case in this file.
        render(<Probe />);

        act(() => {
            useTimeScaleStore.getState().setAuthoritativePermille(250);
        });
        driveSeconds(1, 60);

        expect(current().value).toBeCloseTo(0.25, 5);
    });

    it('picks up a dilation change part-way through, without rewriting what elapsed', () => {
        render(<Probe />);

        driveSeconds(1, 60);
        act(() => {
            useTimeScaleStore.getState().setAuthoritativePermille(500);
        });
        driveSeconds(1, 60);

        // One undilated second, then one at half speed.
        expect(current().value).toBeCloseTo(1.5, 5);
    });

    it('reaches the same time at a 30 fps cap as uncapped', () => {
        // Same wall time, different frame counts: two seconds at 30 fps is 60
        // large deltas, where 144 fps is 288 small ones.
        render(<Probe />);
        driveSeconds(2, 60);
        const capped = current().value;

        cleanup();
        handed.length = 0;
        resetFakeFiberRoot();
        frameClockSeconds = 0;

        render(<Probe />);
        driveSeconds(2, 288);
        const uncapped = current().value;

        expect(capped).toBeCloseTo(2, 5);
        expect(uncapped).toBeCloseTo(2, 5);
        expect(capped).toBeCloseTo(uncapped, 5);
    });

    it('dilates correctly at a 30 fps cap too', () => {
        render(<Probe />);

        act(() => {
            useTimeScaleStore.getState().setAuthoritativePermille(250);
        });
        driveSeconds(2, 60);

        expect(current().value).toBeCloseTo(0.5, 5);
    });
});

describe('useShaderTime hands out one stable uniform per mount', () => {
    it('hands the same object to every render of one component', () => {
        const { rerender } = render(<Probe />);

        rerender(<Probe />);
        rerender(<Probe />);

        expect(handed.length).toBeGreaterThan(1);
        for (const uniform of handed) {
            expect(uniform).toBe(handed[0]);
        }
    });

    it('allocates one uniform under StrictMode, not one per invocation', () => {
        // StrictMode double-invokes the render function. A uniform built freshly
        // in the render body would hand the shader one object while the frame loop
        // wrote into another, and the shader would simply never advance.
        //
        // Measured limit of this pin: a `useMemo` version would pass it. React
        // double-invokes the factory but returns the SAME object to both render
        // passes, so identity cannot separate the two constructs — what rules a
        // memo out is that React may discard it later, which no test here can
        // provoke. See the module header.
        render(
            <StrictMode>
                <Probe />
            </StrictMode>,
        );

        expect(handed.length).toBeGreaterThan(1);
        expect(new Set(handed).size).toBe(1);

        driveSeconds(1, 60);

        // And the one object every render saw is the one the loop advances.
        expect(handed[0]?.value).toBeCloseTo(1, 5);
    });

    it('gives two mounted components uniforms of their own', () => {
        render(
            <>
                <Probe />
                <Probe />
            </>,
        );

        expect(new Set(handed).size).toBe(2);
    });

    it('stops advancing a uniform once its component unmounts', () => {
        const { unmount } = render(<Probe />);
        const uniform = current();

        driveSeconds(1, 60);
        unmount();
        driveSeconds(1, 60);

        expect(uniform.value).toBeCloseTo(1, 5);
    });
});

describe('useShaderTime gates nothing authoritative', () => {
    it('takes no parameters at all', () => {
        // Held by SHAPE, per Invariants #132 and #135: a dispatcher, a
        // `SendAction`, a `PlayerId` or a tick cannot be passed to a function
        // that accepts nothing, and a parameter that does not exist cannot be
        // `eslint-disable`d back in.
        // The TYPE is the pin. `Function.length` would not be: it ignores optional,
        // defaulted and rest parameters, so a widened `(options?: …)` signature
        // would satisfy an arity check while accepting exactly what this forbids.
        const noParameters: Parameters<typeof useShaderTime> extends [] ? true : false = true;

        expect(noParameters).toBe(true);
    });

    it('returns a value carrying nothing but the uniform itself', () => {
        // The other half of the shape: what comes BACK is a number in a box. A
        // return value that carried a handle would reach authoritative state as
        // readily as a parameter would.
        render(<Probe />);

        const uniform = current();
        expect(Object.keys(uniform)).toEqual(['value']);
        expect(typeof uniform.value).toBe('number');
    });
});
