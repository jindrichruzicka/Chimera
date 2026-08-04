// @vitest-environment jsdom

/**
 * renderer/components/shell/perf/PerfProbe.test.tsx
 *
 * Unit tests for the PerfProbe R3F GL stats collector (§4.16).
 * Architecture reference: §4.16 — Performance HUD
 *
 * Rules:
 *  - Tests written first (red confirmed).
 *  - Mock @react-three/fiber; no real WebGL context required.
 *  - No DOM output assertions; the component returns null.
 *  - No imports from simulation/, electron/, ai/, or games/*.
 */

import { cleanup, render } from '@testing-library/react';
import React, { type useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPerfStore } from './perfStore';
import type { PerfFrameSample } from './perfStore';

// ── @react-three/fiber mock ───────────────────────────────────────────────────

interface GlInfo {
    render: {
        calls: number;
        triangles: number;
    };
}

interface FiberState {
    gl: {
        info: GlInfo;
    };
}

type ThreeSelector<T> = (state: FiberState) => T;
type FrameCallback = (state: FiberState, deltaSeconds: number) => void;

let frameCallbacks: FrameCallback[] = [];
let currentGlInfo: GlInfo = { render: { calls: 0, triangles: 0 } };

vi.mock('@react-three/fiber', async () => {
    const { useRef: useReactRef } = await vi.importActual<{ useRef: typeof useRef }>('react');

    return {
        useFrame: vi.fn((callback: FrameCallback) => {
            const indexRef = useReactRef<number | null>(null);
            indexRef.current ??= frameCallbacks.length;
            frameCallbacks[indexRef.current] = callback;
        }),
        useThree: vi.fn(
            <T,>(selector: ThreeSelector<T>): T => selector({ gl: { info: currentGlInfo } }),
        ),
    };
});

// ── Mock imports (loaded after vi.mock hoisting) ──────────────────────────────

// Dynamic import after mocking so the module sees the mock
async function importPerfProbe(): Promise<{ PerfProbe: React.FC }> {
    const mod = await import('./PerfProbe');
    return mod;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function advanceFrames(fiberState: FiberState, count: number, deltaMs: number): void {
    for (let i = 0; i < count; i++) {
        for (const cb of frameCallbacks) {
            cb(fiberState, deltaMs / 1000);
        }
    }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    frameCallbacks = [];
    currentGlInfo = { render: { calls: 0, triangles: 0 } };
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PerfProbe — DOM output', () => {
    it('renders null — no DOM nodes produced', async () => {
        const { PerfProbe } = await importPerfProbe();
        const { container } = render(<PerfProbe />);
        expect(container.firstChild).toBeNull();
    });
});

describe('PerfProbe — registration', () => {
    it('registers a useFrame callback', async () => {
        const { useFrame } = await import('@react-three/fiber');
        const { PerfProbe } = await importPerfProbe();
        render(<PerfProbe />);
        expect(vi.mocked(useFrame)).toHaveBeenCalled();
        expect(frameCallbacks.length).toBeGreaterThan(0);
    });
});

describe('PerfProbe — sampling interval', () => {
    it('does not call setPerfFrame before 500 ms have elapsed (via frames)', async () => {
        const store = createPerfStore();
        const setPerfFrame = vi.spyOn(store.getState(), 'setPerfFrame');

        // Provide the store via a factory override; we test integration by
        // checking the singleton directly (probe reads usePerfStore.getState())
        // but we can spy on the singleton for this test.
        const { usePerfStore } = await import('./perfStore');
        const spy = vi.spyOn(usePerfStore, 'getState').mockReturnValue(store.getState());

        const { PerfProbe } = await importPerfProbe();
        const fiberState: FiberState = { gl: { info: { render: { calls: 10, triangles: 5000 } } } };
        render(<PerfProbe />);

        // Advance < 500 ms worth of frames
        advanceFrames(fiberState, 10, 16); // 160 ms total

        expect(setPerfFrame).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('calls setPerfFrame after 500 ms have elapsed', async () => {
        const store = createPerfStore();
        const setPerfFrame = vi.spyOn(store.getState(), 'setPerfFrame');

        const { usePerfStore } = await import('./perfStore');
        const spy = vi.spyOn(usePerfStore, 'getState').mockReturnValue(store.getState());

        const { PerfProbe } = await importPerfProbe();
        const fiberState: FiberState = { gl: { info: { render: { calls: 10, triangles: 5000 } } } };
        render(<PerfProbe />);

        advanceFrames(fiberState, 32, 16); // 512 ms total

        expect(setPerfFrame).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('PerfProbe — PerfFrameSample content', () => {
    async function mountAndAdvance(
        calls: number,
        triangles: number,
        framesCount = 32,
        deltaMs = 16,
    ): Promise<PerfFrameSample> {
        const store = createPerfStore();
        let captured: PerfFrameSample | undefined;
        vi.spyOn(store.getState(), 'setPerfFrame').mockImplementation((f) => {
            captured = f;
        });

        const { usePerfStore } = await import('./perfStore');
        const spy = vi.spyOn(usePerfStore, 'getState').mockReturnValue(store.getState());

        const { PerfProbe } = await importPerfProbe();
        const fiberState: FiberState = {
            gl: { info: { render: { calls, triangles } } },
        };
        render(<PerfProbe />);

        advanceFrames(fiberState, framesCount, deltaMs);
        spy.mockRestore();

        if (!captured) throw new Error('setPerfFrame was not called');
        return captured;
    }

    it('reports drawCalls from gl.info.render.calls', async () => {
        const sample = await mountAndAdvance(42, 9000);
        expect(sample.drawCalls).toBe(42);
    });

    it('reports triangles from gl.info.render.triangles', async () => {
        const sample = await mountAndAdvance(10, 7777);
        expect(sample.triangles).toBe(7777);
    });

    it('fps is a positive number', async () => {
        const sample = await mountAndAdvance(5, 100, 32, 16);
        expect(sample.fps).toBeGreaterThan(0);
    });

    it('reports FPS above 120 when the one-second frame window contains more than 120 frames', async () => {
        const sample = await mountAndAdvance(5, 100, 125, 4);
        expect(sample.fps).toBe(125);
    });

    it('frameMsAvg is approximately the delta in ms', async () => {
        const sample = await mountAndAdvance(5, 100, 32, 16);
        // With 16 ms frames, avg should be close to 16
        expect(sample.frameMsAvg).toBeCloseTo(16, 0);
    });

    it('frameMsP95 is >= frameMsAvg (95th percentile >= mean)', async () => {
        const sample = await mountAndAdvance(5, 100, 32, 16);
        expect(sample.frameMsP95).toBeGreaterThanOrEqual(sample.frameMsAvg);
    });

    // The probe counts ADVANCED frames, so the frame-time baseline moves with
    // the cap; baseline rationale in `PerfProbe.tsx`'s header, and what the two
    // rates mean end to end in
    // renderer/components/r3f/__tests__/perf-hud-presented-rate.test.tsx.
    it.each([
        [30, 1000 / 30],
        [60, 1000 / 60],
        [120, 1000 / 120],
    ])('reports the %i fps cadence as its frame-time baseline', async (fps, intervalMs) => {
        const frames = Math.ceil(600 / intervalMs); // past the 500 ms publish gate
        const sample = await mountAndAdvance(5, 100, frames, intervalMs);

        expect(sample.frameMsAvg).toBeCloseTo(intervalMs, 1);
        expect(sample.frameMsP95).toBeCloseTo(intervalMs, 1);
    });

    it('separates p95 from the mean when the cadence is uneven', async () => {
        // A uniform cadence makes mean and p95 the same number, so neither
        // assertion above can tell them apart. 18 frames at 25 ms then 2 at
        // 40 ms: the publish gate is crossed on frame 20 (450 + 40 = 490 ms,
        // then 530 ms), so the ring holds all 20. mean = 530/20 = 26.5, and
        // nearest-rank p95 is index ceil(0.95·20)-1 = 18 of the ascending array
        // — the first of the two long frames, 40 ms.
        const store = createPerfStore();
        let captured: PerfFrameSample | undefined;
        vi.spyOn(store.getState(), 'setPerfFrame').mockImplementation((f) => {
            captured = f;
        });
        const { usePerfStore } = await import('./perfStore');
        const spy = vi.spyOn(usePerfStore, 'getState').mockReturnValue(store.getState());

        const { PerfProbe } = await importPerfProbe();
        const fiberState: FiberState = { gl: { info: { render: { calls: 5, triangles: 100 } } } };
        render(<PerfProbe />);

        advanceFrames(fiberState, 18, 25);
        advanceFrames(fiberState, 2, 40);
        spy.mockRestore();

        if (!captured) throw new Error('setPerfFrame was not called');
        expect(captured.frameMsAvg).toBeCloseTo(26.5, 1);
        expect(captured.frameMsP95).toBeCloseTo(40, 1);
        expect(captured.frameMsP95).toBeGreaterThan(captured.frameMsAvg);
    });

    // The rolling one-second window counts the frames it was called on, so the
    // reported rate IS the advanced-frame rate. Separate mounts: the harness
    // keeps every registered callback, so two probes in one test drive together.
    it('reports ~30 fps from a 30 fps advanced cadence', async () => {
        const sample = await mountAndAdvance(5, 100, 40, 1000 / 30);
        expect(sample.fps).toBeGreaterThanOrEqual(28);
        expect(sample.fps).toBeLessThanOrEqual(31);
    });

    it('reports ~120 fps from a 120 fps advanced cadence', async () => {
        const sample = await mountAndAdvance(5, 100, 130, 1000 / 120);
        expect(sample.fps).toBeGreaterThanOrEqual(118);
        expect(sample.fps).toBeLessThanOrEqual(122);
    });

    it("drops a sample landing exactly on the window's left edge", async () => {
        // The FPS window is half-open: a sample at exactly `accTime - 1000` is
        // trimmed, one just inside is kept. 150 frames of 10 ms publish on
        // frames 50, 100 and 150; at the third, accTime is 1500 and the edge is
        // 500 — precisely frame 50's timestamp. Counting it would give 101.
        const sample = await mountAndAdvance(5, 100, 150, 10);

        expect(sample.fps).toBe(100);
    });
});

describe('PerfProbe — rolling window caps', () => {
    it('averages only the last 120 frame times, discarding older samples', async () => {
        const store = createPerfStore();
        let captured: PerfFrameSample | undefined;
        vi.spyOn(store.getState(), 'setPerfFrame').mockImplementation((f) => {
            captured = f;
        });

        const { usePerfStore } = await import('./perfStore');
        const spy = vi.spyOn(usePerfStore, 'getState').mockReturnValue(store.getState());

        const { PerfProbe } = await importPerfProbe();
        const fiberState: FiberState = { gl: { info: { render: { calls: 1, triangles: 100 } } } };
        render(<PerfProbe />);

        // 200 frames at 50 ms then 120 at 10 ms. The last publish lands on fast
        // frame 100 (500 ms of 10 ms frames), so a 120-sample ring holds those
        // 100 fast frames plus the 20 slow ones just behind them:
        // (100·10 + 20·50)/120 = 16.67 ms. The number moves in BOTH directions
        // if the cap changes — a smaller ring drops the slow tail towards 10 ms,
        // a larger one (or none) pulls in more 50 ms frames.
        advanceFrames(fiberState, 200, 50);
        advanceFrames(fiberState, 120, 10);
        spy.mockRestore();

        if (!captured) throw new Error('setPerfFrame was not called');
        expect(captured.frameMsAvg).toBeCloseTo(16.67, 1);
    });
});
