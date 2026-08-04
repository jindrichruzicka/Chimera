/**
 * renderer/components/r3f/__test-support__/StandInComposer.tsx
 *
 * A composer-shaped third-party presenter: `useFrame(cb, 1)` plus a `gl.render`
 * from that callback. That is the shape of every third-party pass — a
 * post-processing composer, a portal/scissor renderer, a hand-rolled
 * render-target pipeline — and the shape is what matters, not any one library:
 * see `fakeFiberRoot.tsx` for the R3F mechanism that makes them all
 * co-presenters. No such package is installed here, so nothing in this file's
 * behaviour can be checked against one.
 *
 * It is a stand-in and not the real package on purpose: the collision is a
 * property of R3F's subscriber model, not of any one library, and the engine
 * must not take a dependency to prove that.
 *
 * It records the delta it is handed as well as its present count, so a test can
 * assert the cadence the engine paced it at without reaching into R3F.
 */

import { useFrame } from '@react-three/fiber';

const COMPOSER_RENDER_PRIORITY = 1;

export interface PresentCounter {
    presents: number;
    /** Seconds since the previous frame, as the root reported them. */
    readonly deltas: number[];
}

export function makePresentCounter(): PresentCounter {
    return { presents: 0, deltas: [] };
}

export function StandInComposer({ counter }: { readonly counter: PresentCounter }): null {
    useFrame((state, delta) => {
        counter.presents++;
        counter.deltas.push(delta);
        state.gl.render(state.scene, state.camera);
    }, COMPOSER_RENDER_PRIORITY);

    return null;
}
