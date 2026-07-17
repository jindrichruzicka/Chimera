// @vitest-environment jsdom

/**
 * renderer/components/r3f/FrameRateLimiter.test.tsx
 *
 * Unit tests for the engine frame-rate limiter. Caps the R3F render loop to the
 * active game's `settings.display.targetFps`.
 *
 * Rules:
 *  - Mock @react-three/fiber; no real WebGL context required.
 *  - Drive the captured useFrame callback with synthetic deltas.
 *  - No imports from simulation/ runtime, electron/, ai/, or games/*.
 */

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_DEFAULTS } from '@chimera-engine/simulation/settings/index.js';
import { useSettingsStore } from '../../state/settingsStore';

// ── @react-three/fiber mock ───────────────────────────────────────────────────

interface FiberState {
    gl: { render: ReturnType<typeof vi.fn> };
    scene: object;
    camera: object;
}
type FrameCallback = (state: FiberState, deltaSeconds: number) => void;

let frameCallbacks: { callback: FrameCallback; priority: number | undefined }[] = [];

vi.mock('@react-three/fiber', () => ({
    useFrame: vi.fn((callback: FrameCallback, priority?: number) => {
        frameCallbacks.push({ callback, priority });
    }),
}));

async function importFrameRateLimiter(): Promise<{ FrameRateLimiter: React.FC }> {
    return import('./FrameRateLimiter');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTargetFps(targetFps: 30 | 60 | 120 | 0): void {
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { ...ENGINE_DEFAULTS, display: { targetFps } } },
    });
}

function makeState(): FiberState {
    return { gl: { render: vi.fn() }, scene: {}, camera: {} };
}

/** Drive `count` frames of `deltaMs` each; returns how many renders happened. */
function driveFrames(state: FiberState, count: number, deltaMs: number): number {
    for (let i = 0; i < count; i++) {
        for (const { callback } of frameCallbacks) {
            callback(state, deltaMs / 1000);
        }
    }
    return state.gl.render.mock.calls.length;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    frameCallbacks = [];
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FrameRateLimiter — uncapped (targetFps 0)', () => {
    it('renders null and registers no useFrame — R3F keeps its automatic render', async () => {
        setTargetFps(0);
        const { FrameRateLimiter } = await importFrameRateLimiter();
        const { container } = render(<FrameRateLimiter />);
        expect(container.firstChild).toBeNull();
        expect(frameCallbacks).toHaveLength(0);
    });

    it('renders no useFrame when settings are not yet hydrated', async () => {
        // activeGameId null / no settings → treated as uncapped.
        const { FrameRateLimiter } = await importFrameRateLimiter();
        render(<FrameRateLimiter />);
        expect(frameCallbacks).toHaveLength(0);
    });
});

describe('FrameRateLimiter — capped (targetFps > 0)', () => {
    it('takes over rendering with a non-zero render priority', async () => {
        setTargetFps(60);
        const { FrameRateLimiter } = await importFrameRateLimiter();
        render(<FrameRateLimiter />);
        expect(frameCallbacks).toHaveLength(1);
        expect(frameCallbacks[0]?.priority).toBeGreaterThan(0);
    });

    it('renders every frame when the native rate matches the cap (60 fps on 60 Hz)', async () => {
        setTargetFps(60);
        const { FrameRateLimiter } = await importFrameRateLimiter();
        render(<FrameRateLimiter />);
        // 10 frames at ~16.667 ms (60 Hz) → 10 presents (jitter tolerance keeps
        // the cadence from collapsing to half rate).
        expect(driveFrames(makeState(), 10, 1000 / 60)).toBe(10);
    });

    it('halves the present rate when native runs at double the cap (60 fps on 120 Hz)', async () => {
        setTargetFps(60);
        const { FrameRateLimiter } = await importFrameRateLimiter();
        render(<FrameRateLimiter />);
        // 12 frames at ~8.333 ms (120 Hz) → ~6 presents (60 fps cap).
        expect(driveFrames(makeState(), 12, 1000 / 120)).toBe(6);
    });

    it('caps a high-refresh display to a low target (30 fps on 120 Hz)', async () => {
        setTargetFps(30);
        const { FrameRateLimiter } = await importFrameRateLimiter();
        render(<FrameRateLimiter />);
        // 12 frames at ~8.333 ms (120 Hz) → ~3 presents (30 fps cap).
        expect(driveFrames(makeState(), 12, 1000 / 120)).toBe(3);
    });

    it('does not queue catch-up renders after a long stall', async () => {
        setTargetFps(60);
        const { FrameRateLimiter } = await importFrameRateLimiter();
        render(<FrameRateLimiter />);
        const state = makeState();
        // One 2-second stall frame renders once, not ~120 times.
        expect(driveFrames(state, 1, 2000)).toBe(1);
        // The accumulator was clamped, so the next frame at native rate renders.
        expect(driveFrames(state, 1, 1000 / 60)).toBe(2);
    });
});
