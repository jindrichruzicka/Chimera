// @vitest-environment jsdom

import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionShellCameraRig } from './ActionShellCameraRig';
import {
    ACTION_SHELL_DOLLY_ATTRIBUTE,
    ACTION_SHELL_YAW_ATTRIBUTE,
    ACTION_SHELL_YAW_MS,
    actionShellCameraView,
} from './actionShellCamera.js';

// The shell state the rig reads TRANSIENTLY. A mutable module-level value
// rather than a store, so a test can move the shell between frames the way a
// route change does — and so a subscription the rig must NOT hold would be
// visibly absent (nothing here notifies).
const shellState: {
    surface: string;
    transition: { kind: string; durationMs: number } | null;
} = { surface: 'main-menu', transition: null };

vi.mock('@chimera-engine/renderer/game', () => ({
    getShellState: () => shellState,
}));

/**
 * Advance `frames` REAL frames one at a time.
 *
 * `advanceFrames(n, δ)` loops SUBSCRIBERS on the outside and frames on the
 * inside, so a single call would run this rig n times against one snapshot of
 * the mocked shell state. Stepping one frame at a time is what lets a case
 * change the surface midway.
 */
async function stepFrames(
    renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
    frames: number,
    delta: number,
): Promise<void> {
    for (let frame = 0; frame < frames; frame += 1) {
        await renderer.advanceFrames(1, delta);
    }
}

/** Captures the camera r3f put on root state, so a case can read where it went. */
function CameraProbe(): null {
    camera = useThree((state) => state.camera) as PerspectiveCamera;
    return null;
}

function RigHarness({ focusX = 0 }: { readonly focusX?: number }): React.ReactElement {
    return (
        <>
            <CameraProbe />
            <ActionShellCameraRig hostRef={{ current: host }} focusX={focusX} />
        </>
    );
}

let host: HTMLDivElement;
let camera: PerspectiveCamera | null = null;

beforeEach(() => {
    host = document.createElement('div');
    camera = null;
    shellState.surface = 'main-menu';
    shellState.transition = null;
});

afterEach(() => {
    vi.clearAllMocks();
});

/** The camera's forward axis in world space, rounded so a float tail cannot fail a match. */
function lookDirection(target: PerspectiveCamera): readonly number[] {
    const direction = target.getWorldDirection(new Vector3());
    return [direction.x, direction.y, direction.z].map((axis) => Number(axis.toFixed(5)));
}

/** The forward axis a view IMPLIES, in the same rounded form. */
function expectedDirection(view: {
    readonly position: readonly [number, number, number];
    readonly lookAt: readonly [number, number, number];
}): readonly number[] {
    const direction = new Vector3(
        view.lookAt[0] - view.position[0],
        view.lookAt[1] - view.position[1],
        view.lookAt[2] - view.position[2],
    ).normalize();
    return [direction.x, direction.y, direction.z].map((axis) => Number(axis.toFixed(5)));
}

/** The captured camera, or a loud failure rather than a null dereference. */
function activeCamera(): PerspectiveCamera {
    if (camera === null) throw new Error('the camera probe never rendered');
    return camera;
}

describe('ActionShellCameraRig', () => {
    it('publishes the opening phases before any frame has run', async () => {
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            expect(host.getAttribute(ACTION_SHELL_YAW_ATTRIBUTE)).toBe('home');
            expect(host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE)).toBe('wide');
        } finally {
            await renderer.unmount();
        }
    });

    it('reports the yaw as moving while the swing is in flight, then away', async () => {
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            shellState.surface = 'settings';

            await stepFrames(renderer, 1, ACTION_SHELL_YAW_MS / 4000);
            expect(host.getAttribute(ACTION_SHELL_YAW_ATTRIBUTE)).toBe('moving');

            await stepFrames(renderer, 4, ACTION_SHELL_YAW_MS / 1000);
            expect(host.getAttribute(ACTION_SHELL_YAW_ATTRIBUTE)).toBe('away');
        } finally {
            await renderer.unmount();
        }
    });

    it('yaws back home when the settings surface closes', async () => {
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            shellState.surface = 'settings';
            await stepFrames(renderer, 2, ACTION_SHELL_YAW_MS / 1000);
            expect(host.getAttribute(ACTION_SHELL_YAW_ATTRIBUTE)).toBe('away');

            shellState.surface = 'main-menu';
            await stepFrames(renderer, 2, ACTION_SHELL_YAW_MS / 1000);

            expect(host.getAttribute(ACTION_SHELL_YAW_ATTRIBUTE)).toBe('home');
        } finally {
            await renderer.unmount();
        }
    });

    it('dollies in on an armed to-match transition', async () => {
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            shellState.transition = { kind: 'to-match', durationMs: 200 };

            await stepFrames(renderer, 1, 0.05);
            expect(host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE)).toBe('moving');

            await stepFrames(renderer, 4, 0.05);
            expect(host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE)).toBe('close');
        } finally {
            await renderer.unmount();
        }
    });

    it('times the dolly on the transition’s OWN duration', async () => {
        // A dolly on a hardcoded clock would land early or late against the
        // engine's screen fade — the whole reason `durationMs` is carried.
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            shellState.transition = { kind: 'to-match', durationMs: 2000 };

            await stepFrames(renderer, 1, 0.2);

            expect(host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE)).toBe('moving');
        } finally {
            await renderer.unmount();
        }
    });

    it('does NOT dolly for a to-shell transition', async () => {
        // A background that dollied on any armed transition would drive INTO the
        // arena as the player left it.
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            shellState.transition = { kind: 'to-shell', durationMs: 200 };

            await stepFrames(renderer, 5, 0.05);

            expect(host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE)).toBe('wide');
        } finally {
            await renderer.unmount();
        }
    });

    it('returns the dolly when the armed entry is cleared', async () => {
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            shellState.transition = { kind: 'to-match', durationMs: 200 };
            await stepFrames(renderer, 5, 0.05);
            expect(host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE)).toBe('close');

            shellState.transition = null;
            await stepFrames(renderer, 5, 0.2);

            expect(host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE)).toBe('wide');
        } finally {
            await renderer.unmount();
        }
    });

    it('places the camera at the home view before anything moves', async () => {
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            await stepFrames(renderer, 1, 0.016);

            const home = actionShellCameraView({ yaw: 0, dolly: 0 }, 0);
            const camera = activeCamera();
            expect([camera.position.x, camera.position.y, camera.position.z]).toEqual([
                home.position[0],
                home.position[1],
                home.position[2],
            ]);
        } finally {
            await renderer.unmount();
        }
    });

    it('turns the camera toward the home look target before anything moves', async () => {
        // The camera POSITION is a function of the dolly alone, so a rig that
        // placed the camera and never turned it would pass every position
        // assertion above and still leave the scene off screen.
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            await stepFrames(renderer, 1, 0.016);

            expect(lookDirection(activeCamera())).toEqual(
                expectedDirection(actionShellCameraView({ yaw: 0, dolly: 0 }, 0)),
            );
        } finally {
            await renderer.unmount();
        }
    });

    it('turns the camera AWAY as the yaw runs — the whole settings move lives in lookAt', async () => {
        // `actionShellCameraView` puts the entire yaw in `lookAt`: the position
        // it returns depends on the dolly and the focus only. This is the case
        // that measures the settings swing end to end rather than through the
        // phase attribute the rig publishes about itself.
        const renderer = await ReactThreeTestRenderer.create(<RigHarness />);
        try {
            await stepFrames(renderer, 1, 0.016);
            const home = lookDirection(activeCamera());

            shellState.surface = 'settings';
            await stepFrames(renderer, 2, ACTION_SHELL_YAW_MS / 1000);

            const away = lookDirection(activeCamera());
            expect(away).toEqual(expectedDirection(actionShellCameraView({ yaw: 1, dolly: 0 }, 0)));
            expect(away).not.toEqual(home);
        } finally {
            await renderer.unmount();
        }
    });

    it('re-places the camera on a FOCUS change with no pose change at all', async () => {
        // The focus is a prop and the pose is not moving, so a rig that only
        // re-placed the camera when the pose changed would stay dollied onto the
        // primitive that was picked before the last click.
        const renderer = await ReactThreeTestRenderer.create(<RigHarness focusX={-4} />);
        try {
            shellState.transition = { kind: 'to-match', durationMs: 100 };
            await stepFrames(renderer, 4, 0.1);
            expect(activeCamera().position.x).toBeCloseTo(-4, 6);

            await renderer.update(<RigHarness focusX={4} />);
            await stepFrames(renderer, 1, 0.016);

            expect(activeCamera().position.x).toBeCloseTo(4, 6);
        } finally {
            await renderer.unmount();
        }
    });

    it('survives a host that is not mounted', async () => {
        // The ref is filled by the parent's own commit; a frame that ran before
        // it (or after an unmount) must not throw inside the frame loop.
        const renderer = await ReactThreeTestRenderer.create(
            <ActionShellCameraRig hostRef={{ current: null }} focusX={0} />,
        );
        try {
            shellState.surface = 'settings';
            await expect(stepFrames(renderer, 3, 0.1)).resolves.not.toThrow();
        } finally {
            await renderer.unmount();
        }
    });
});
