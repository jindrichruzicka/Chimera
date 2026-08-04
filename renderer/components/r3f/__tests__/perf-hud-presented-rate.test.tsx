// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/perf-hud-presented-rate.test.tsx
 *
 * `PerfProbe` rides R3F's subscriber list, and `update()` calls every subscriber
 * on every frame the root advances. While the engine cap PRESENTED frames rather
 * than pacing the loop, the root still advanced at the panel's native rate, so
 * the HUD's `fps` counted frames the player never saw: ~120 reported for a 30 fps
 * cap on a 120 Hz display. Now that the cap paces `advance()`, subscribers run
 * only on advanced frames and the number means what the HUD label says.
 *
 * This spec is the evidence for that, driven end to end: one native tick rate,
 * several caps, different reported rates. Driving the probe's callback directly
 * cannot show it — that measures only that the probe counts the frames it is
 * called on, which was equally true of the broken version.
 *
 * Measured against the pre-pacing world (presenting limiter, no `frameloop`
 * prop), every test whose canvas the engine paces fails:
 *  - `reports 31 fps at a 30 fps cap …` → `expected 121 to be 31`
 *  - `reports 61 fps at a 60 fps cap …` → `expected 121 to be 61`
 *  - `separates the reported rate from the native rate` → `expected 1 to be
 *    greater than 3.5` — both numbers were the native one.
 * The tests whose canvas is NOT paced by the engine survive, each correctly:
 * uncapped, native and presented are the same rate; a canvas that wired no cap
 * behaves identically in both worlds; and a canvas with the prop and no driver
 * advances in neither.
 *
 * Rules:
 *  - Integration spec: real `GameCanvas`, real `PerfProbe`, real limiter, over
 *    the `@react-three/fiber` stand-in in `__test-support__/`.
 *  - No real WebGL context, no electron/, ai/ or apps/* imports.
 */

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePerfStore } from '../../shell/perf/perfStore';
import { useSettingsStore } from '../../../state/settingsStore';
import {
    Canvas,
    fakeRootState,
    resetFakeFiberRoot,
    update,
} from '../__test-support__/fakeFiberRoot';
import { GameCanvas, PerfProbe } from '../index';

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

/** One native vsync frame; R3F's own loop runs only while it owns the loop. */
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * perfStore is a singleton and deliberately exposes no `setState` (§5.5), so
 * clear the frame metrics through the same typed action the probe writes with.
 */
function resetPerfSample(): void {
    usePerfStore.getState().setPerfFrame({
        fps: 0,
        frameMsAvg: 0,
        frameMsP95: 0,
        drawCalls: 0,
        triangles: 0,
    });
}

const HZ_120 = 1000 / 120;
/** Two seconds of a 120 Hz panel — long enough to fill the probe's 1 s window. */
const TWO_SECONDS_OF_FRAMES = 240;

function setTargetFps(targetFps: 30 | 60 | 120 | 0): void {
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { display: { targetFps } } },
    });
}

/** Mount a capped canvas, drive a fixed native tick, and read what the HUD shows. */
function measureHud(targetFps: 30 | 60 | 120 | 0): { fps: number; frameMsAvg: number } {
    setTargetFps(targetFps);
    render(
        <GameCanvas camera="free">
            <mesh />
        </GameCanvas>,
    );
    driveNativeFrames(TWO_SECONDS_OF_FRAMES, HZ_120);

    const { sample } = usePerfStore.getState();
    return { fps: sample.fps, frameMsAvg: sample.frameMsAvg };
}

beforeEach(() => {
    installFakeRaf();
    resetFakeFiberRoot();
    vi.stubGlobal('__chimera', { logs: { emit: vi.fn() } });
    useSettingsStore.setState({ activeGameId: null, settings: {} });
    resetPerfSample();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useSettingsStore.setState({ activeGameId: null, settings: {} });
    resetPerfSample();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('the perf HUD reports the presented frame rate', () => {
    /**
     * The harness is deterministic — a fake rAF, a fake clock, whole frames — so
     * these are asserted exactly rather than as tolerances. They are what this
     * harness produces; only the `frameMsAvg` offset has a cause worth naming,
     * measured rather than inferred: the numbers sit just UNDER the capped
     * interval (32.639 rather than 33.333 at a 30 cap) because the limiter's
     * eager `advance(originSeconds)` contributes one sample at a zero delta.
     * Removing it restores 33.333 and 16.667. Baseline rationale for what the
     * frame-time number MEANS lives in `PerfProbe.tsx`.
     */
    it('reports 31 fps at a 30 fps cap on a 120 Hz native tick', () => {
        const { fps, frameMsAvg } = measureHud(30);

        // The native tick is 120 Hz throughout. Anything near 120 here means the
        // HUD is counting frames the player never saw.
        expect(fps).toBe(31);
        expect(frameMsAvg).toBeCloseTo(32.64, 1);
    });

    it('reports 61 fps at a 60 fps cap on the same native tick', () => {
        const { fps, frameMsAvg } = measureHud(60);

        expect(fps).toBe(61);
        expect(frameMsAvg).toBeCloseTo(16.49, 1);
    });

    it('reports the full native rate when uncapped', () => {
        const { fps, frameMsAvg } = measureHud(0);

        // Uncapped the driver is inert, so no eager frame skews the mean — but
        // `fps` still carries the same window offset the capped cases do.
        expect(fps).toBe(121);
        expect(frameMsAvg).toBeCloseTo(HZ_120, 2);
    });

    it('separates the reported rate from the native rate — 30 and 120 differ 4x', () => {
        const capped = measureHud(30);
        cleanup();
        resetFakeFiberRoot();
        resetPerfSample();
        installFakeRaf();
        const uncapped = measureHud(0);

        // Same driven panel, four times the reported rate. Before the loop was
        // paced, both numbers were the native one.
        expect(uncapped.fps / capped.fps).toBeGreaterThan(3.5);
    });

    it('reports the NATIVE rate for a probe in a canvas that wired no cap', () => {
        // The number is a property of the canvas, not of the setting. A game
        // mounting PerfProbe in its own <Canvas> with neither the frameloop prop
        // nor the driver keeps R3F's own loop, so a 30 fps setting changes
        // nothing here.
        setTargetFps(30);
        render(
            <Canvas>
                <PerfProbe />
            </Canvas>,
        );
        driveNativeFrames(TWO_SECONDS_OF_FRAMES, HZ_120);

        expect(fakeRootState().frameloop).toBe('always');
        expect(usePerfStore.getState().sample.fps).toBe(121);
        expect(usePerfStore.getState().sample.frameMsAvg).toBeCloseTo(HZ_120, 2);
    });

    it('reports nothing at all for a probe in a canvas that has the prop but no driver', () => {
        // The other half-wiring: the prop takes the canvas OFF R3F's loop, and
        // with no driver to advance it nothing ever runs — a permanently black
        // canvas, which the probe reports as a flat zero.
        setTargetFps(30);
        render(
            <Canvas frameloop="never">
                <PerfProbe />
            </Canvas>,
        );
        driveNativeFrames(TWO_SECONDS_OF_FRAMES, HZ_120);

        expect(fakeRootState().frameloop).toBe('never');
        expect(usePerfStore.getState().sample.fps).toBe(0);
        expect(usePerfStore.getState().sample.drawCalls).toBe(0);
    });
});
