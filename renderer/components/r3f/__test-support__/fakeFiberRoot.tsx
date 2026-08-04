/**
 * renderer/components/r3f/__test-support__/fakeFiberRoot.tsx
 *
 * A stand-in for `@react-three/fiber` that reproduces the semantics the engine
 * frame-rate cap turns on, so a test built on it measures the real defect rather
 * than a convenient fiction. Mirrored from `@react-three/fiber@9.6.1`
 * `dist/events-b389eeca.esm.js` unless noted:
 *
 *  - `subscribe` increments a COUNTER, `internal.priority + (priority > 0 ? 1 : 0)`,
 *    and sorts subscribers ascending by priority with a stable sort. This is the
 *    mechanism behind the co-presenter collision; `FrameRateLimiter.tsx`'s
 *    header explains why it makes a presenting cap unworkable.
 *  - `update()` calls EVERY subscriber unconditionally, then runs the automatic
 *    render only `if (!internal.priority)`.
 *  - Under `frameloop: 'never'` the delta is `timestamp - clock.elapsedTime`,
 *    and the timestamp becomes the new `elapsedTime`.
 *  - `setFrameloop` stops the clock and zeroes `elapsedTime`.
 *  - `Canvas` applies its `frameloop` prop before rendering children, because
 *    R3F awaits `configure()` before `root.render(children)` — that sequence is
 *    in `dist/react-three-fiber.esm.js:61-116`, not in `events-*`.
 *  - `invalidate` early-returns whenever `frameloop === 'never'`. Getting past
 *    that return is not the same as having an effect — under `'always'` R3F
 *    ignores the counter `invalidate` writes — so the counters below say only
 *    which calls the early return let through.
 *
 * NOT modelled, deliberately:
 *  - The native loop. A test drives it, so it can choose whether R3F would have
 *    been running its own chain (`'always'`) or waiting for an `advance`.
 *  - The `'always'` delta. Real R3F uses `clock.getDelta()`, i.e.
 *    `performance.now()`-based and ignoring the timestamp argument; this fake
 *    substitutes the driven clock so a jsdom test can pace both branches from
 *    one timeline.
 *  - The separate reconciler root. Real R3F mounts canvas children one commit
 *    later, through `root.render(children)`; here they mount in the same commit
 *    as `<Canvas>`. The consequences of the real split are pinned where they
 *    matter, in `FrameRateLimiter.test.tsx`'s deferred-report specs.
 *  - Demand rendering itself. `invalidate` is modelled only far enough to record
 *    which calls the `'never'` early return let through; `internal.frames` and
 *    the demand queue are not modelled, so this fake cannot say whether a call
 *    that got through would have rendered anything. On a real `'always'` root it
 *    would not.
 *  - `useThree`'s zustand subscription: nothing here re-renders on root-state
 *    change.
 */

import React from 'react';

export type FakeFrameloop = 'always' | 'demand' | 'never';

type FrameCallback = (state: FakeRootState, delta: number) => void;

interface Subscriber {
    readonly callback: FrameCallback;
    readonly priority: number;
}

export interface FakeRootState {
    frameloop: FakeFrameloop;
    clock: { elapsedTime: number; oldTime: number; running: boolean };
    gl: {
        render: (scene: object, camera: object) => void;
        info: { render: { calls: number; triangles: number } };
    };
    scene: object;
    camera: object;
    advance: (timestamp: number) => void;
    invalidate: () => void;
    internal: { priority: number; subscribers: Subscriber[] };
}

/** Every `gl.render` call the root saw, whoever made it. */
let glRenderCount = 0;
/** Only the calls R3F's OWN automatic render made (the `!priority` branch). */
let automaticRenderCount = 0;
/** `invalidate` calls that got past the `'never'` early return. */
let pastEarlyReturnInvalidateCount = 0;
/** `invalidate` calls made, whether or not they did anything. */
let attemptedInvalidateCount = 0;

let state: FakeRootState = makeState();

function makeState(): FakeRootState {
    const root: FakeRootState = {
        frameloop: 'always',
        clock: { elapsedTime: 0, oldTime: 0, running: true },
        gl: {
            render: (): void => {
                glRenderCount++;
            },
            info: { render: { calls: 1, triangles: 3 } },
        },
        scene: {},
        camera: {},
        advance: (timestamp: number): void => {
            update(timestamp);
        },
        invalidate: (): void => {
            attemptedInvalidateCount++;
            // The early return that makes demand rendering dead under a cap.
            if (root.frameloop === 'never') {
                return;
            }
            pastEarlyReturnInvalidateCount++;
        },
        internal: { priority: 0, subscribers: [] },
    };
    return root;
}

/** Mirrors R3F's `update()`. Exported so a test can drive the native loop. */
export function update(timestamp: number): void {
    let delta = 0;
    if (state.frameloop === 'never') {
        delta = timestamp - state.clock.elapsedTime;
        state.clock.oldTime = state.clock.elapsedTime;
        state.clock.elapsedTime = timestamp;
    } else {
        delta = timestamp - state.clock.elapsedTime;
        state.clock.elapsedTime = timestamp;
    }

    // EVERY subscriber, unconditionally — priority does not gate this.
    for (const subscriber of [...state.internal.subscribers]) {
        subscriber.callback(state, delta);
    }

    // The automatic render is the ONLY thing a non-zero priority suppresses.
    if (!state.internal.priority) {
        automaticRenderCount++;
        state.gl.render(state.scene, state.camera);
    }
}

function subscribe(callback: FrameCallback, priority: number): () => void {
    state.internal.priority = state.internal.priority + (priority > 0 ? 1 : 0);
    state.internal.subscribers = [...state.internal.subscribers, { callback, priority }].sort(
        (a, b) => a.priority - b.priority,
    );
    return () => {
        state.internal.priority = state.internal.priority - (priority > 0 ? 1 : 0);
        const index = state.internal.subscribers.findIndex(
            (subscriber) => subscriber.callback === callback,
        );
        if (index >= 0) {
            state.internal.subscribers = state.internal.subscribers.filter((_, i) => i !== index);
        }
    };
}

function setFrameloop(frameloop: FakeFrameloop): void {
    state.frameloop = frameloop;
    state.clock.running = false;
    state.clock.elapsedTime = 0;
    if (frameloop !== 'never') {
        state.clock.running = true;
        state.clock.elapsedTime = 0;
    }
}

// ── The mocked @react-three/fiber surface ─────────────────────────────────────

export function Canvas({
    children,
    frameloop = 'always',
}: {
    readonly children?: React.ReactNode;
    readonly camera?: unknown;
    readonly frameloop?: FakeFrameloop;
}): React.ReactElement {
    // Applied BEFORE children render: R3F awaits configure() before
    // root.render(children), so a child observes the final value.
    if (state.frameloop !== frameloop) {
        setFrameloop(frameloop);
    }
    return <>{children}</>;
}

export function useThree<T>(selector: (rootState: FakeRootState) => T): T {
    return selector(state);
}

export function useFrame(callback: FrameCallback, renderPriority = 0): void {
    const callbackRef = React.useRef(callback);
    callbackRef.current = callback;
    React.useLayoutEffect(
        () =>
            subscribe((rootState, delta) => callbackRef.current(rootState, delta), renderPriority),
        [renderPriority],
    );
}

// ── Test-facing handles ───────────────────────────────────────────────────────

export function resetFakeFiberRoot(): void {
    glRenderCount = 0;
    automaticRenderCount = 0;
    pastEarlyReturnInvalidateCount = 0;
    attemptedInvalidateCount = 0;
    state = makeState();
}

/**
 * `attempted` counts every call; `pastEarlyReturn` only those `'never'` did not
 * reject. Getting past that return is NOT the same as having an effect — under
 * `'always'` R3F ignores what invalidate writes; see useEngineFrameloop.ts.
 */
export function invalidateCounts(): { attempted: number; pastEarlyReturn: number } {
    return { attempted: attemptedInvalidateCount, pastEarlyReturn: pastEarlyReturnInvalidateCount };
}

export function fakeRootState(): FakeRootState {
    return state;
}

export function renderCounts(): { total: number; automatic: number } {
    return { total: glRenderCount, automatic: automaticRenderCount };
}
