// @vitest-environment jsdom

/**
 * renderer/hooks/__tests__/tween-frameloop-modes.test.tsx
 *
 * `useTween` and `useTweenCallback` call `invalidate()` around their lifecycle,
 * and on an ENGINE canvas none of those calls has any observable effect — under
 * `'never'` it early-returns, under `'always'` R3F ignores what it writes. See
 * `useEngineFrameloop.ts` for both halves.
 *
 * The audit outcome is to KEEP them: they are the correct contract for a
 * `frameloop="demand"` canvas — one no game canvas can be under Invariant
 * #127, but renderer-internal code may still create — and they cost nothing
 * on the engine's own. What must not rot is the
 * belief that a tween DEPENDS on them — so this spec drives the same tween under
 * both engine frameloops and asserts it completes either way.
 *
 * The counters below say only which calls the `'never'` early return let
 * through. That is a fact about the frameloop, not about anything rendering:
 * deleting all 14 call sites leaves every outcome assertion here green, which is
 * exactly why the reason for keeping them is not "the tween needs them".
 *
 * Rules:
 *  - Integration spec over the `@react-three/fiber` stand-in; the real hooks,
 *    the real limiter, the real `GameCanvas`.
 *  - No real WebGL context, no electron/, ai/ or apps/* imports.
 */

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../state/settingsStore';
import {
    fakeRootState,
    invalidateCounts,
    resetFakeFiberRoot,
    update,
} from '../../components/r3f/__test-support__/fakeFiberRoot';
import { GameCanvas } from '../../components/r3f/index';
import { useTween } from '../useTween';
import { useTweenCallback } from '../useTweenCallback';
import { linear } from '../../utils/curves.js';

vi.mock('@react-three/fiber', () => import('../../components/r3f/__test-support__/fakeFiberRoot'));

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

function driveNativeFrames(count: number, deltaMs: number): void {
    for (let i = 0; i < count; i++) {
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
}

// ── Harness ───────────────────────────────────────────────────────────────────

const HZ_120 = 1000 / 120;
const TWEEN_MS = 200;
/** 400 ms of a 120 Hz panel — twice the tween, capped or not. */
const FRAMES = 48;

function setTargetFps(targetFps: 30 | 0): void {
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { display: { targetFps } } },
    });
}

interface TweenProbe {
    /** The live tween object; its getters read the hook's refs, not React state. */
    tween: { readonly value: number; readonly isRunning: boolean } | null;
    ticks: number[];
    completed: number;
}

function TweenHarness({ probe }: { readonly probe: TweenProbe }): null {
    const tween = useTween(TWEEN_MS, linear);
    const callbackTween = useTweenCallback(TWEEN_MS, linear, {
        onTick: (value) => probe.ticks.push(value),
        onComplete: () => {
            probe.completed++;
        },
        onCancel: () => undefined,
    });
    const startRef = React.useRef<() => void>(() => undefined);

    probe.tween = tween;
    startRef.current = () => {
        tween.start();
        callbackTween.start();
    };

    React.useEffect(() => {
        startRef.current();
    }, []);

    return null;
}

function runTween(targetFps: 30 | 0): TweenProbe {
    const probe: TweenProbe = { tween: null, ticks: [], completed: 0 };
    setTargetFps(targetFps);
    render(
        <GameCanvas camera="free">
            <TweenHarness probe={probe} />
        </GameCanvas>,
    );
    driveNativeFrames(FRAMES, HZ_120);
    return probe;
}

function readTween(probe: TweenProbe): { value: number; isRunning: boolean } {
    if (!probe.tween) {
        throw new Error('TweenHarness never rendered');
    }
    return { value: probe.tween.value, isRunning: probe.tween.isRunning };
}

beforeEach(() => {
    installFakeRaf();
    resetFakeFiberRoot();
    vi.stubGlobal('__chimera', { logs: { emit: vi.fn() } });
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tweens advance under both frameloop modes', () => {
    it('completes on a capped canvas, where every invalidate() is a no-op', () => {
        const probe = runTween(30);

        expect(fakeRootState().frameloop).toBe('never');
        expect(readTween(probe).value).toBe(1);
        expect(readTween(probe).isRunning).toBe(false);
        expect(probe.completed).toBe(1);
        expect(probe.ticks.at(-1)).toBe(1);

        // The calls were made and the early return rejected every one. The loop
        // driver supplies the frames instead, which is why they cost nothing.
        const counts = invalidateCounts();
        expect(counts.attempted).toBeGreaterThan(0);
        expect(counts.pastEarlyReturn).toBe(0);
    });

    it('completes on an uncapped canvas, where invalidate() is not early-returned', () => {
        const probe = runTween(0);

        expect(fakeRootState().frameloop).toBe('always');
        expect(readTween(probe).value).toBe(1);
        expect(readTween(probe).isRunning).toBe(false);
        expect(probe.completed).toBe(1);
        expect(probe.ticks.at(-1)).toBe(1);

        // Same call sites, past the early return this time — which is NOT the
        // same as doing something: R3F's loop renders an active 'always' root
        // regardless of the counter invalidate writes. The tween completes here
        // for the same reason it does under a cap: frames arrive unasked.
        expect(invalidateCounts().pastEarlyReturn).toBeGreaterThan(0);
    });

    it('starts each case from zeroed counters, so an absolute count means something', () => {
        // The stand-in holds its counters at module scope and five spec files
        // share it. `pastEarlyReturn === 0` above is an absolute claim, and it
        // is only a claim at all while the reset works.
        runTween(0);
        expect(invalidateCounts().attempted).toBeGreaterThan(0);

        cleanup();
        resetFakeFiberRoot();

        expect(invalidateCounts()).toEqual({ attempted: 0, pastEarlyReturn: 0 });
    });

    it('still rejects every invalidate under a cap that follows an uncapped canvas', () => {
        // The stand-in's counters are module-scoped, so the capped assertion
        // above would pass on a stale zero if it happened to run first. Run the
        // two in the opposite order against one uninterrupted counter.
        runTween(0);
        const afterUncapped = invalidateCounts().pastEarlyReturn;
        expect(afterUncapped).toBeGreaterThan(0);

        cleanup();
        installFakeRaf();
        const probe = runTween(30);

        expect(fakeRootState().frameloop).toBe('never');
        expect(readTween(probe).value).toBe(1);
        // Not "zero" — "no higher than it already was", which is the same claim
        // made against a counter the capped run cannot have reset.
        expect(invalidateCounts().pastEarlyReturn).toBe(afterUncapped);
    });

    it('samples the tween fewer times under a cap, without changing its outcome', () => {
        const capped = runTween(30);
        cleanup();
        resetFakeFiberRoot();
        installFakeRaf();
        const uncapped = runTween(0);

        // A 30 fps cap gives roughly a quarter of the samples a 120 Hz panel
        // would. Both still land exactly on 1 — the cap changes sampling
        // resolution, never the destination.
        expect(capped.ticks.length).toBeLessThan(uncapped.ticks.length / 2);
        expect(capped.ticks.at(-1)).toBe(1);
        expect(uncapped.ticks.at(-1)).toBe(1);
    });
});
