// @vitest-environment jsdom
//
// This file exercises the animation === null defensive guards inside useCamera's
// onTick and onComplete callbacks (lines 81-83, 95-97).  Those branches cannot
// be reached through the public API in a synchronous test environment (they
// protect against a cancelled animation being overtaken by a frame render in a
// concurrent runtime), so we mock useTweenCallback to drive the callbacks
// directly.

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { type CameraController, useCamera } from './useCamera.js';

// ── Mutable state shared between mock implementation and tests ───────────────

let capturedOnTick: ((value: number) => void) | null = null;
let capturedOnComplete: (() => void) | null = null;

const mockTweenStart = vi.fn();
const mockTweenStop = vi.fn();

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('./useTweenCallback.js', () => ({
    useTweenCallback: vi.fn(
        (
            _durationMs: number,
            _easingFn: unknown,
            callbacks: {
                onTick: (v: number) => void;
                onComplete: () => void;
                onCancel: () => void;
            },
        ) => {
            // Capture the latest callbacks on every render so the closures
            // reference the current activeAnimationRef.
            capturedOnTick = callbacks.onTick;
            capturedOnComplete = callbacks.onComplete;
            return { start: mockTweenStart, stop: mockTweenStop, isRunning: false };
        },
    ),
}));

let activeCamera: PerspectiveCamera;

vi.mock('@react-three/fiber', () => ({
    useFrame: vi.fn(),
    useThree: vi.fn(
        (selector?: (state: { camera: PerspectiveCamera; invalidate: () => void }) => unknown) => {
            const state = { camera: activeCamera, invalidate: vi.fn() };
            return selector ? selector(state) : state;
        },
    ),
}));

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
    activeCamera = new PerspectiveCamera();
    activeCamera.position.set(0, 0, 10);
    capturedOnTick = null;
    capturedOnComplete = null;
    mockTweenStart.mockClear();
    mockTweenStop.mockClear();
});

afterEach(() => {
    cleanup();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useCamera — null guards in frame callbacks', () => {
    it('onTick is a no-op when no animation is active (animation === null)', () => {
        renderUseCamera();
        expect(capturedOnTick).not.toBeNull();

        // Call onTick directly without ever calling animateTo so
        // activeAnimationRef.current is null — guard must silently return.
        act(() => {
            capturedOnTick!(0.5);
        });

        // Camera position must be unchanged; the null guard fired.
        expect(activeCamera.position.toArray()).toEqual([0, 0, 10]);
    });

    it('onComplete is a no-op when no animation is active (animation === null)', () => {
        renderUseCamera();
        expect(capturedOnComplete).not.toBeNull();

        // Call onComplete directly without ever calling animateTo so
        // activeAnimationRef.current is null — guard must silently return
        // without throwing or mutating camera state.
        expect(() => {
            act(() => {
                capturedOnComplete!();
            });
        }).not.toThrow();

        expect(activeCamera.position.toArray()).toEqual([0, 0, 10]);
    });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderUseCamera(): CameraController {
    let controller: CameraController | null = null;

    function Harness(): React.ReactElement {
        controller = useCamera();
        return <div />;
    }

    render(<Harness />);

    if (controller === null) {
        throw new Error('Expected useCamera to return a controller');
    }

    return controller;
}
