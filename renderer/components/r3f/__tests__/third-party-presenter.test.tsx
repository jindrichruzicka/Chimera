// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/third-party-presenter.test.tsx
 *
 * The regression guard for the defect the whole frame-rate feature exists to
 * fix: an engine cap that PRESENTS is one co-presenter among however many the
 * game mounts, and R3F can suppress none of them. The mechanism is documented in
 * `__test-support__/fakeFiberRoot.tsx`, which models it. Pacing the loop instead
 * caps whoever presents, including presenters the engine has never heard of.
 *
 * Mutation probe, measured — a guard that passes against both implementations
 * is not a guard, so the presenting limiter (`useFrame((state, d) => { …;
 * state.gl.render(…) }, 1)`) was restored and this spec re-run in two variants.
 * Both make the limiter a co-presenter, so both produce, verbatim:
 *  - `caps two competing presenters alike` → `expected 3 to be 2` — the
 *    presenting limiter is counted alongside the two composers.
 *  - `registers the engine limiter as no subscriber at all` →
 *    `expected [ +0, 1, 1 ] to deeply equal [ +0, 1 ]` — with ONE composer, the
 *    extra entry is the limiter: mounted before `{children}` and held there by
 *    the stable sort, so it is the FIRST priority-1 entry and its present ran
 *    before the composer's, which overwrote it. That is the collision itself.
 *  - `releases the priority when a presenter unmounts` → `expected 2 to be 1`.
 *
 * Where the two variants differ:
 *  - Presenting limiter, `frameloop` prop KEPT: the driver is gone, so nothing
 *    advances a `'never'` canvas and the composer presents on NO frame —
 *    `expected [] to deeply equal [ 5, 9, 13, 17, 21 ]`. 6 of 10 fail.
 *  - Presenting limiter AND no `frameloop` prop, i.e. the world before the cap
 *    was reworked: the composer presents on ALL 24 native frames —
 *    `expected [ Array(24) ] to deeply equal [ 5, 9, 13, 17, 21 ]`, deltas
 *    `[0.008333…, …(23)]`. That is the defect: the cap does nothing to a
 *    third-party presenter. 7 of 10 fail.
 *
 * `leaves the uncapped path untouched` survives both, correctly: at
 * `targetFps: 0` there was never anything to cap.
 *
 * Rules:
 *  - Integration spec: the real `GameCanvas` from the public r3f barrel, the
 *    real limiter, and a competing presenter, in one tree.
 *  - The `@react-three/fiber` stand-in and the composer stand-in live in
 *    `__test-support__/`; no `@react-three/postprocessing` dependency is added.
 *  - No real WebGL context, no electron/, ai/ or apps/* imports.
 */

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../state/settingsStore';
import {
    fakeRootState,
    renderCounts,
    resetFakeFiberRoot,
    update,
    useFrame,
} from '../__test-support__/fakeFiberRoot';
import { makePresentCounter, StandInComposer } from '../__test-support__/StandInComposer';
import type { PresentCounter } from '../__test-support__/StandInComposer';
import { GameCanvas } from '../index';

vi.mock('@react-three/fiber', () => import('../__test-support__/fakeFiberRoot'));

// ── Native frame driver ───────────────────────────────────────────────────────

let rafCallbacks: Map<number, (timestamp: number) => void>;
let nextRafHandle: number;
let clockMs: number;

function installFakeRaf(): void {
    rafCallbacks = new Map();
    nextRafHandle = 1;
    clockMs = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => void): number => {
        const handle = nextRafHandle++;
        rafCallbacks.set(handle, callback);
        return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
        rafCallbacks.delete(handle);
    });
}

/**
 * One native vsync frame. Anything holding a `requestAnimationFrame` runs — the
 * engine's loop driver among them — and, when the canvas still owns its loop,
 * R3F's own chain calls `update()` as well.
 */
function nativeFrame(deltaMs: number): void {
    clockMs += deltaMs;
    const due = [...rafCallbacks.values()];
    rafCallbacks.clear();
    for (const callback of due) {
        callback(clockMs);
    }
    if (fakeRootState().frameloop !== 'never') {
        update(clockMs / 1000);
    }
}

/** Drive `count` native frames; return the 1-based frames the counter presented on. */
function presentedOnFrames(counter: PresentCounter, count: number, deltaMs: number): number[] {
    const frames: number[] = [];
    for (let frame = 1; frame <= count; frame++) {
        const before = counter.presents;
        nativeFrame(deltaMs);
        if (counter.presents > before) {
            frames.push(frame);
        }
    }
    return frames;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTargetFps(targetFps: 30 | 60 | 120 | 0): void {
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { display: { targetFps } } },
    });
}

const HZ_120 = 1000 / 120;
const NATIVE_FRAMES = 24;

/** Renderer log entries; a wiring report here would mean the canvas is half-wired. */
let logEmit: ReturnType<typeof vi.fn>;

beforeEach(() => {
    installFakeRaf();
    resetFakeFiberRoot();
    logEmit = vi.fn();
    vi.stubGlobal('__chimera', { logs: { emit: logEmit } });
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('a third-party presenter under an engine frame-rate cap', () => {
    it('presents on every fourth native frame at a 30 fps cap on a 120 Hz display', () => {
        setTargetFps(30);
        const composer = makePresentCounter();

        render(
            <GameCanvas camera="free">
                <StandInComposer counter={composer} />
            </GameCanvas>,
        );

        // Frame 1 seeds the driver's timestamp baseline, so the first capped
        // interval closes on frame 5 and every fourth frame after it — one
        // present per 33 ms of a 120 Hz panel's 8.3 ms frames.
        expect(presentedOnFrames(composer, NATIVE_FRAMES, HZ_120)).toEqual([5, 9, 13, 17, 21]);
        // The canvas is correctly wired, so no half-wiring is reported.
        expect(logEmit).not.toHaveBeenCalled();
    });

    it('receives the capped delta, in seconds, not the native frame time', () => {
        setTargetFps(30);
        const composer = makePresentCounter();

        render(
            <GameCanvas camera="free">
                <StandInComposer counter={composer} />
            </GameCanvas>,
        );
        presentedOnFrames(composer, NATIVE_FRAMES, HZ_120);

        // Every delta the composer sees is one capped interval, ~33 ms — not the
        // 8.3 ms of the panel, and not milliseconds mistaken for seconds.
        expect(composer.deltas).toHaveLength(5);
        for (const delta of composer.deltas) {
            expect(delta).toBeCloseTo(1 / 30, 3);
        }
    });

    it('adds exactly one draw at mount and none after — the composer presents alone', () => {
        setTargetFps(30);
        const composer = makePresentCounter();

        render(
            <GameCanvas camera="free">
                <StandInComposer counter={composer} />
            </GameCanvas>,
        );
        // One automatic render happens at mount, before the composer's own
        // layout effect has subscribed: the driver presents its eager first
        // frame while `internal.priority` is still 0, so the canvas is never
        // blank. From then on the composer's priority suppresses it entirely.
        const atMount = renderCounts();
        expect(atMount).toEqual({ total: 1, automatic: 1 });

        presentedOnFrames(composer, NATIVE_FRAMES, HZ_120);

        const after = renderCounts();
        expect(after.automatic).toBe(1); // unchanged — no automatic render since mount
        // Every draw after the mount frame came from the composer. The engine
        // cap contributes none: it calls gl.render zero times, at any cap.
        expect(after.total - atMount.total).toBe(composer.presents);
    });

    it('leaves the uncapped path untouched — the composer runs every native frame', () => {
        setTargetFps(0);
        const composer = makePresentCounter();

        render(
            <GameCanvas camera="free">
                <StandInComposer counter={composer} />
            </GameCanvas>,
        );

        expect(fakeRootState().frameloop).toBe('always');
        expect(presentedOnFrames(composer, 12, HZ_120)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        ]);
        // Nothing advanced at mount, so not even the eager frame drew.
        expect(renderCounts()).toEqual({ total: 12, automatic: 0 });
        // Native cadence, not a capped one.
        expect(composer.deltas.at(-1)).toBeCloseTo(1 / 120, 4);
        expect(logEmit).not.toHaveBeenCalled();
    });

    it('caps two competing presenters alike — the engine suppresses neither, and needs to', () => {
        setTargetFps(30);
        const first = makePresentCounter();
        const second = makePresentCounter();

        render(
            <GameCanvas camera="free">
                <StandInComposer counter={first} />
                <StandInComposer counter={second} />
            </GameCanvas>,
        );

        // `internal.priority` COUNTS both — it is not a lock, so neither can
        // suppress the other. Pacing the loop means neither has to.
        expect(fakeRootState().internal.priority).toBe(2);
        expect(presentedOnFrames(first, NATIVE_FRAMES, HZ_120)).toEqual([5, 9, 13, 17, 21]);
        expect(second.presents).toBe(first.presents);
        expect(renderCounts().automatic).toBe(1); // still only the mount frame
    });

    it('registers the engine limiter as no subscriber at all', () => {
        setTargetFps(30);
        const composer = makePresentCounter();

        render(
            <GameCanvas camera="free">
                <StandInComposer counter={composer} />
            </GameCanvas>,
        );

        // PerfProbe (priority 0) and the composer (priority 1) — the limiter is
        // absent from the subscriber list, so it can never become a co-presenter,
        // and `internal.priority` reflects only what the game mounted.
        expect(
            fakeRootState().internal.subscribers.map((subscriber) => subscriber.priority),
        ).toEqual([0, 1]);
        expect(fakeRootState().internal.priority).toBe(1);
    });

    it('releases the priority when a presenter unmounts', () => {
        setTargetFps(30);
        const composer = makePresentCounter();

        const { rerender } = render(
            <GameCanvas camera="free">
                <StandInComposer counter={composer} />
            </GameCanvas>,
        );
        expect(fakeRootState().internal.priority).toBe(1);

        rerender(<GameCanvas camera="free">{null}</GameCanvas>);

        // Back to zero, so R3F's automatic render resumes for whoever is left.
        expect(fakeRootState().internal.priority).toBe(0);
        expect(fakeRootState().internal.subscribers).toHaveLength(1); // PerfProbe
    });
});

describe('the fiber stand-in reproduces R3F subscriber ordering', () => {
    function Subscriber({
        label,
        priority,
        order,
    }: {
        readonly label: string;
        readonly priority: number;
        readonly order: string[];
    }): null {
        useFrame(() => {
            order.push(label);
        }, priority);
        return null;
    }

    /**
     * `GameCanvas` happens to mount its priority-0 subscriber first, so the
     * ordering it produces cannot tell a sorting root from a non-sorting one.
     * Mount the priorities in the WRONG order to see the sort at all.
     */
    it('sorts a late priority-0 subscriber ahead of an earlier priority-1 one', () => {
        const order: string[] = [];

        render(
            <>
                <Subscriber label="1" priority={1} order={order} />
                <Subscriber label="0" priority={0} order={order} />
            </>,
        );
        update(0.016);

        expect(
            fakeRootState().internal.subscribers.map((subscriber) => subscriber.priority),
        ).toEqual([0, 1]);
        expect(order).toEqual(['0', '1']);
    });

    /**
     * The sort is STABLE, and that is the half that decided the pre-cap
     * collision: an engine presenter and a composer are both priority 1, so
     * ascending order separates neither of them — mount order does. The engine's
     * present ran first and the composer's overwrote it.
     */
    it('keeps two equal-priority subscribers in mount order', () => {
        const order: string[] = [];

        render(
            <>
                <Subscriber label="first" priority={1} order={order} />
                <Subscriber label="second" priority={1} order={order} />
            </>,
        );
        update(0.016);

        expect(order).toEqual(['first', 'second']);
    });

    it('zeroes the clock when a canvas enters frameloop never', () => {
        setTargetFps(0);
        const composer = makePresentCounter();
        render(
            <GameCanvas camera="free">
                <StandInComposer counter={composer} />
            </GameCanvas>,
        );
        presentedOnFrames(composer, 6, HZ_120);
        expect(fakeRootState().clock.elapsedTime).toBeGreaterThan(0);

        // Turning the cap on flips the prop, and `setFrameloop` stops the clock
        // and zeroes `elapsedTime`. Nothing the limiter does depends on that —
        // it reads the clock rather than assuming zero — but the fake claims to
        // model it, so the claim is measured here rather than asserted.
        act(() => {
            setTargetFps(30);
        });

        expect(fakeRootState().frameloop).toBe('never');
        expect(fakeRootState().clock.elapsedTime).toBe(0);
    });
});
