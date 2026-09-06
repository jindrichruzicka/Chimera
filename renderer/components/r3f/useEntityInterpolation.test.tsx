// @vitest-environment jsdom

/**
 * renderer/components/r3f/useEntityInterpolation.test.tsx
 *
 * What the interpolation seam does BETWEEN two authoritative beats.
 *
 * Frames are driven by hand through a `@react-three/fiber` double, the same
 * way `useTween.test.tsx` drives them: the property under test is what the
 * hook writes on each frame, and a real canvas would only add a clock nobody
 * here controls.
 */

import { act, cleanup, render } from '@testing-library/react';
import React, { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vector3Tuple } from '../../types/r3f-types.js';
import { useEntityInterpolation } from './useEntityInterpolation.js';

interface FrameState {
    invalidate(): void;
}

type FrameCallback = (state: FrameState, deltaSeconds: number) => void;

let frameCallbacks: FrameCallback[] = [];
let invalidate: ReturnType<typeof vi.fn>;

vi.mock('@react-three/fiber', async () => {
    const { useRef: useReactRef } = await vi.importActual<{ useRef: typeof useRef }>('react');

    return {
        useFrame: vi.fn((callback: FrameCallback) => {
            const callbackIndexRef = useReactRef<number | null>(null);
            callbackIndexRef.current ??= frameCallbacks.length;
            frameCallbacks[callbackIndexRef.current] = callback;
        }),
    };
});

/** Advances every registered frame callback by `deltaMs`. */
function frame(deltaMs: number): void {
    act(() => {
        for (const callback of frameCallbacks) {
            callback({ invalidate }, deltaMs / 1000);
        }
    });
}

/**
 * The minimum an object3d needs for this hook: a `position` it can write.
 *
 * A hand-built stand-in rather than a real `THREE.Object3D`, so the assertions
 * read the exact numbers the hook set instead of whatever a matrix update made
 * of them.
 */
function makeObject(): {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
} {
    const position = {
        x: Number.NaN,
        y: Number.NaN,
        z: Number.NaN,
        set(x: number, y: number, z: number): void {
            position.x = x;
            position.y = y;
            position.z = z;
        },
    };
    return { position };
}

type TestObject = ReturnType<typeof makeObject>;

let renderCount = 0;
let lastObject: TestObject | null = null;
/** Stands in for r3f having attached the object3d to the ref yet. */
let attachRefOnRender = true;

function Harness({
    entityId,
    target,
    durationMs = 100,
    snapDistance,
}: {
    readonly entityId: string;
    readonly target: Vector3Tuple;
    readonly durationMs?: number;
    readonly snapDistance?: number;
}): React.ReactElement {
    renderCount += 1;
    const ref = useEntityInterpolation({
        entityId,
        target,
        durationMs,
        ...(snapDistance === undefined ? {} : { snapDistance }),
    });
    const objectRef = useRef<TestObject | null>(null);
    objectRef.current ??= makeObject();
    lastObject = objectRef.current;
    // Stand in for r3f attaching the object3d to the ref.
    if (attachRefOnRender) {
        (ref as { current: unknown }).current = objectRef.current;
    }
    return <div />;
}

beforeEach(() => {
    frameCallbacks = [];
    invalidate = vi.fn();
    renderCount = 0;
    lastObject = null;
    attachRefOnRender = true;
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useEntityInterpolation', () => {
    it('passes through positions strictly BETWEEN the two beats, not just the endpoints', () => {
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);

        const samples: number[] = [];
        for (let i = 0; i < 4; i += 1) {
            frame(20);
            samples.push(lastObject?.position.x ?? Number.NaN);
        }

        // Every sample inside the beat is strictly between the two cells, and
        // the sequence advances — a hook that only wrote the endpoints would
        // give 0s then a 4.
        const midSamples = samples.slice(0, 3);
        for (const x of midSamples) {
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(4);
        }
        expect(midSamples).toStrictEqual([...midSamples].sort((a, b) => a - b));
        expect(new Set(midSamples).size).toBe(midSamples.length);
    });

    it('eases OUT — the shared curve, not a linear ramp', () => {
        // The curve's identity, not merely "it moved": `easeOut` front-loads,
        // so halfway through the beat the entity is three quarters of the way
        // across rather than half. A linear ramp would put it at 2, and the
        // whole reason this hook reuses `utils/curves` is so the engine has one
        // answer to what a move looks like.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);

        frame(50);

        expect(lastObject?.position.x).toBeCloseTo(3, 10);
    });

    it('slides on the VERTICAL axis too', () => {
        // Every other fixture keeps Y at 0, which cannot tell a three-axis
        // dependency list from a two-axis one — and a seam typed on a full
        // Vector3Tuple has to carry a jump, a lift or a flier.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[0, 6, 0]} />);

        frame(20);
        const midFlightY = lastObject?.position.y ?? Number.NaN;
        expect(midFlightY).toBeGreaterThan(0);
        expect(midFlightY).toBeLessThan(6);

        frame(200);
        expect(lastObject?.position.y).toBe(6);
    });

    it('seeds the mount only once the ref is ATTACHED', () => {
        // The seed is a one-shot. Spent against a ref r3f has not attached yet,
        // it would write nothing and never come back — leaving the object at
        // wherever it was constructed, which is the origin, and that is the one
        // thing the seed exists to prevent.
        attachRefOnRender = false;
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);

        // The target MOVES while the ref is still unattached, so the seed has
        // to take the current one rather than the tuple the mount was built
        // with — a ref attached two commits late would otherwise seed the
        // entity on a cell the host has already left.
        rerender(<Harness entityId="e1" target={[5, 0, 5]} />);

        attachRefOnRender = true;
        // The same target again, so the layout effect does not run — the frame
        // is the only thing left that can take the seed.
        rerender(<Harness entityId="e1" target={[5, 0, 5]} />);
        frame(16);

        expect(lastObject?.position.x).toBe(5);
        expect(lastObject?.position.z).toBe(5);

        // And the seed is spent ONCE: the next move slides. A seed re-taken
        // every frame would snap this one instead of drawing it.
        rerender(<Harness entityId="e1" target={[6, 0, 5]} />);
        frame(20);

        expect(lastObject?.position.x).toBeGreaterThan(5);
        expect(lastObject?.position.x).toBeLessThan(6);
    });

    it('does not burn the seed on a frame that runs before the ref attaches', () => {
        // A frame can land while r3f has not attached the object yet. Spending
        // the one-shot there writes nothing and never comes back: the layout
        // effect will not re-run for a target that has not moved, so the object
        // would sit at the origin for the rest of its life.
        attachRefOnRender = false;
        const { rerender } = render(<Harness entityId="e1" target={[5, 0, 5]} />);
        frame(16);

        attachRefOnRender = true;
        rerender(<Harness entityId="e1" target={[5, 0, 5]} />);
        frame(16);

        expect(lastObject?.position.x).toBe(5);
        expect(lastObject?.position.z).toBe(5);
    });

    it('slides the first move after a LATE attach that also changed the entity', () => {
        // Both seed arms return early, so each has to record the identity it
        // seeded with. Left at the mount's, the next effect run reads a
        // spurious id change and snaps a move that should have been drawn.
        attachRefOnRender = false;
        const { rerender } = render(<Harness entityId="a" target={[0, 0, 0]} />);

        attachRefOnRender = true;
        rerender(<Harness entityId="b" target={[0, 0, 0]} />);
        frame(16);

        rerender(<Harness entityId="b" target={[4, 0, 0]} />);
        frame(20);

        expect(lastObject?.position.x).toBeGreaterThan(0);
        expect(lastObject?.position.x).toBeLessThan(4);
    });

    it('slides the first move when the FRAME took the seed after an id change', () => {
        // The other route to a stale identity, and the one that is easy to
        // reason wrongly about. The id changes while the ref is unattached, so
        // the effect runs and declines to seed — leaving the recorded identity
        // at the mount's. The ref then attaches on a commit that changes no
        // dependency, so the effect does not run at all and the FRAME takes the
        // seed. If that arm records nothing, the next real move reads an
        // identity change that never happened and snaps.
        attachRefOnRender = false;
        const { rerender } = render(<Harness entityId="a" target={[0, 0, 0]} />);
        rerender(<Harness entityId="b" target={[0, 0, 0]} />);

        attachRefOnRender = true;
        rerender(<Harness entityId="b" target={[0, 0, 0]} />);
        frame(16);

        rerender(<Harness entityId="b" target={[4, 0, 0]} />);
        frame(20);

        expect(lastObject?.position.x).toBeGreaterThan(0);
        expect(lastObject?.position.x).toBeLessThan(4);
    });

    it('cancels a slide the host takes back before a single frame runs', () => {
        // Two target commits inside one frame, which a fast beat produces — at
        // the top of the dilation range a beat is shorter than a frame — and
        // which a player reversing direction produces on purpose. The second
        // commit returns to where the entity is DRAWN, so "nothing moved" is
        // true of the position and false of the tween: left running, it would
        // carry the entity on to a cell the host has revoked.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[0, 0, 0]} />);

        frame(20);

        expect(lastObject?.position.x).toBe(0);
    });

    it('lands exactly on the authoritative position once the beat is spent', () => {
        // Interpolation is presentation: it must not leave the entity a
        // fraction of a cell away from where the host says it is.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);

        frame(500);

        expect(lastObject?.position.x).toBe(4);
    });

    it('does not lerp a newly appearing entity from the origin', () => {
        // A primitive that spawns mid-match has no previous position. Sliding
        // in from (0,0,0) would draw a move the simulation never made.
        render(<Harness entityId="spawned" target={[7, 0, -3]} />);

        frame(16);

        expect(lastObject?.position.x).toBe(7);
        expect(lastObject?.position.z).toBe(-3);
    });

    it('snaps rather than slides when the entity IDENTITY changes', () => {
        // One mounted component may be reused for a different entity. Tweening
        // across that swap draws a move between two different things.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e2" target={[9, 0, 0]} />);

        frame(16);

        expect(lastObject?.position.x).toBe(9);
    });

    it('snaps rather than slides across a deliberate teleport', () => {
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} snapDistance={5} />);
        rerender(<Harness entityId="e1" target={[40, 0, 0]} snapDistance={5} />);

        frame(16);

        expect(lastObject?.position.x).toBe(40);
    });

    it('snaps a teleport that arrives MID-SLIDE, and stays snapped', () => {
        // The case a realtime game actually produces: a restore or a rules
        // teleport lands while the entity is still sliding. A snap that left
        // the old tween alive would let the very next frame drag the entity
        // back toward where it was going.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} snapDistance={5} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} snapDistance={5} />);
        frame(20);
        expect(lastObject?.position.x).toBeLessThan(4);

        rerender(<Harness entityId="e1" target={[40, 0, 0]} snapDistance={5} />);
        frame(1);
        expect(lastObject?.position.x).toBe(40);

        frame(20);
        expect(lastObject?.position.x).toBe(40);
    });

    it('re-targets from the SNAPPED position, not from where the slide was going', () => {
        // The other half of a mid-slide snap: the drawn position has to move
        // with it. Left behind, the next beat would build its slide from a cell
        // the entity is no longer on and jump it backwards first.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} snapDistance={5} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} snapDistance={5} />);
        frame(20);
        rerender(<Harness entityId="e1" target={[40, 0, 0]} snapDistance={5} />);

        // One cell on from the teleport. Measured from 40 that is a SLIDE, so a
        // frame into it the entity is between 40 and 41. Measured from the
        // mid-slide position the snap replaced it is a 38-unit jump, which
        // exceeds the snap distance and would land on 41 at once — so the
        // upper bound is what separates the two.
        rerender(<Harness entityId="e1" target={[41, 0, 0]} snapDistance={5} />);
        frame(1);

        expect(lastObject?.position.x).toBeGreaterThan(40);
        expect(lastObject?.position.x).toBeLessThan(41);
    });

    it('snaps a move exactly ON the snap distance', () => {
        // The threshold is inclusive, which its own doc states. Every other
        // fixture sits well clear of the boundary, so nothing else can tell an
        // inclusive comparison from an exclusive one.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} snapDistance={4} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} snapDistance={4} />);

        frame(1);

        expect(lastObject?.position.x).toBe(4);
    });

    it('still slides for a move SHORTER than the snap distance', () => {
        // The boundary the test above sits past: without this, a snap distance
        // of 0 would be indistinguishable from any other value.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} snapDistance={5} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} snapDistance={5} />);

        frame(20);

        expect(lastObject?.position.x).toBeGreaterThan(0);
        expect(lastObject?.position.x).toBeLessThan(4);
    });

    it('writes the transform through the ref, committing no React render per frame', () => {
        // The whole point of a ref: a per-frame `setState` would re-render the
        // game screen 60 times a second to move one object.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);
        const rendersBeforeFrames = renderCount;

        frame(16);
        frame(16);
        frame(16);

        expect(renderCount).toBe(rendersBeforeFrames);
        expect(lastObject?.position.x).toBeGreaterThan(0);
    });

    it('re-targets mid-flight from where the entity actually IS', () => {
        // A beat arriving before the previous one finished must not restart the
        // slide from the old cell — that would jump the entity backwards.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);
        frame(20);
        const midFlightX = lastObject?.position.x ?? Number.NaN;

        rerender(<Harness entityId="e1" target={[8, 0, 0]} />);
        frame(1);

        expect(lastObject?.position.x).toBeGreaterThanOrEqual(midFlightX);
    });

    it('does not restart the slide when a re-render hands over an EQUAL new target', () => {
        // A caller derives the world position from the snapshot, so it builds a
        // fresh tuple on every render. Keyed on the array's identity, any
        // re-render mid-flight would reset the elapsed time and the slide would
        // crawl toward the target instead of arriving with the next beat.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);
        frame(50);
        const halfway = lastObject?.position.x ?? Number.NaN;

        // Same numbers, new array — exactly what a re-render produces.
        rerender(<Harness entityId="e1" target={[4, 0, 0]} />);
        frame(50);

        expect(halfway).toBeGreaterThan(0);
        expect(halfway).toBeLessThan(4);
        expect(lastObject?.position.x).toBe(4);
    });

    it('applies on ARRIVAL when the duration is zero — before any frame runs', () => {
        // "Applied on arrival" is what the option's doc promises, and a sample
        // taken after a frame cannot tell it from "applied one frame later".
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} durationMs={0} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} durationMs={0} />);

        expect(lastObject?.position.x).toBe(4);
    });

    it('snaps when the duration is zero', () => {
        // A game that declares no beat, or a reduced-motion duration, gets the
        // un-interpolated behaviour rather than a division by zero.
        const { rerender } = render(<Harness entityId="e1" target={[0, 0, 0]} durationMs={0} />);
        rerender(<Harness entityId="e1" target={[4, 0, 0]} durationMs={0} />);

        frame(16);

        expect(lastObject?.position.x).toBe(4);
    });
});
