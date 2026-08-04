// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/frameloop-cap-agreement.test.tsx
 *
 * The `<Canvas frameloop>` prop and the `<FrameRateLimiter />` driver are two
 * halves of one contract: the prop decides whether R3F drives its own loop, the
 * driver decides which frames get advanced. If they read the cap from different
 * places they can disagree, and a canvas whose prop says `'never'` while the
 * driver stays idle is permanently black.
 *
 * This spec pins that they read ONE selector.
 *
 * Rules:
 *  - Integration spec: the hook and the driver, exercised together against one
 *    faked cap, with the `settingsStore` set to a value neither may read.
 *  - No real WebGL context — @react-three/fiber is faked.
 *  - No electron/, ai/ or apps/* imports.
 */

import { cleanup, render, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../state/settingsStore';
import { FrameRateLimiter } from '../FrameRateLimiter';
import { useEngineFrameloop } from '../useEngineFrameloop';

// ── The one shared read, faked ────────────────────────────────────────────────

const cap = vi.hoisted(() => {
    const state = { targetFps: 0 };
    return { state, selectTargetFps: vi.fn((): number => state.targetFps) };
});

vi.mock('../selectTargetFps', () => ({ selectTargetFps: cap.selectTargetFps }));

// ── @react-three/fiber fake ───────────────────────────────────────────────────

const fiber = vi.hoisted(() => ({
    useFrame: vi.fn(),
    useThree: vi.fn(),
    advance: vi.fn(),
}));

vi.mock('@react-three/fiber', () => ({
    useFrame: fiber.useFrame,
    useThree: fiber.useThree,
    advance: fiber.advance,
}));

interface FakeRootState {
    advance: ReturnType<typeof vi.fn>;
    frameloop: 'always' | 'demand' | 'never';
    clock: { elapsedTime: number; oldTime: number };
}

let rootState: FakeRootState;

beforeEach(() => {
    cap.state.targetFps = 0;
    rootState = {
        advance: vi.fn(),
        frameloop: 'always',
        clock: { elapsedTime: 0, oldTime: 0 },
    };
    fiber.useThree.mockImplementation((selector: (state: FakeRootState) => unknown) =>
        selector(rootState),
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    // A poison pill, deliberately outside the declared `30 | 60 | 120 | 0` value
    // set so no mocked cap below can collide with it. The pin itself does not
    // rest on this value — each row asserts the shared selector was CALLED, an
    // assertion no store literal can make vacuous.
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { display: { targetFps: 240 } } },
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

describe('frameloop prop and frame-rate driver agree on the active cap', () => {
    it.each([0, 30, 60, 120])('agrees at a %i fps cap', (targetFps) => {
        cap.state.targetFps = targetFps;

        cap.selectTargetFps.mockClear();
        const frameloop = renderHook(() => useEngineFrameloop()).result.current;
        expect(cap.selectTargetFps, 'hook must read the shared selector').toHaveBeenCalled();

        // Wire the driver into the canvas the prop just described.
        rootState.frameloop = frameloop;
        cap.selectTargetFps.mockClear();
        render(<FrameRateLimiter />);
        expect(cap.selectTargetFps, 'driver must read the shared selector').toHaveBeenCalled();

        const capped = targetFps > 0;
        expect(frameloop).toBe(capped ? 'never' : 'always');
        // A canvas under 'never' with an idle driver never paints again.
        expect(rootState.advance.mock.calls.length > 0).toBe(capped);
    });
});
