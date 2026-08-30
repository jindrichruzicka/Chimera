import { describe, expect, it } from 'vitest';

import {
    ACTION_SHELL_CAMERA_HOME,
    ACTION_SHELL_DOLLY_RETURN_MS,
    ACTION_SHELL_ENDPOINT_EPSILON,
    ACTION_SHELL_YAW_MS,
    ACTION_SHELL_YAW_RADIANS,
    actionShellCameraView,
    type ActionShellCameraView,
    advanceActionShellPose,
    describeActionShellDolly,
    describeActionShellYaw,
    resolveActionShellCameraTarget,
} from './actionShellCamera.js';

describe('resolveActionShellCameraTarget', () => {
    it('sits home on an ordinary shell surface', () => {
        expect(
            resolveActionShellCameraTarget({ isSettings: false, isEnteringMatch: false }),
        ).toEqual({ yaw: 0, dolly: 0 });
    });

    it('yaws away while the settings surface is open', () => {
        expect(
            resolveActionShellCameraTarget({ isSettings: true, isEnteringMatch: false }),
        ).toEqual({ yaw: 1, dolly: 0 });
    });

    it('dollies in while a match entry is armed', () => {
        expect(
            resolveActionShellCameraTarget({ isSettings: false, isEnteringMatch: true }),
        ).toEqual({ yaw: 0, dolly: 1 });
    });

    it('answers both axes when a match is entered from settings', () => {
        // Not reachable from the menu today, but the two axes are independent
        // and a target that dropped one would freeze that axis mid-move.
        expect(resolveActionShellCameraTarget({ isSettings: true, isEnteringMatch: true })).toEqual(
            {
                yaw: 1,
                dolly: 1,
            },
        );
    });
});

describe('advanceActionShellPose', () => {
    const HOME = ACTION_SHELL_CAMERA_HOME;

    it('moves the yaw a whole ramp in the ramp’s own duration', () => {
        const next = advanceActionShellPose(
            HOME,
            { yaw: 1, dolly: 0 },
            ACTION_SHELL_YAW_MS / 1000,
            400,
        );

        expect(next.yaw).toBe(1);
    });

    it('moves the yaw half a ramp in half its duration', () => {
        const next = advanceActionShellPose(
            HOME,
            { yaw: 1, dolly: 0 },
            ACTION_SHELL_YAW_MS / 2000,
            400,
        );

        expect(next.yaw).toBeCloseTo(0.5, 5);
    });

    it('never overshoots the target', () => {
        const next = advanceActionShellPose(HOME, { yaw: 1, dolly: 0 }, 10, 400);

        expect(next.yaw).toBe(1);
    });

    it('moves BACK toward home, not only away', () => {
        const next = advanceActionShellPose(
            { yaw: 1, dolly: 0 },
            HOME,
            ACTION_SHELL_YAW_MS / 2000,
            400,
        );

        expect(next.yaw).toBeCloseTo(0.5, 5);
        expect(next.yaw).toBeGreaterThan(0);
    });

    it('times the DOLLY on the duration it is handed, not the yaw’s', () => {
        // The dolly rides the engine's screen fade, whose length the transition
        // carries; a dolly on the yaw's clock would land early or late.
        const next = advanceActionShellPose(HOME, { yaw: 0, dolly: 1 }, 0.1, 200);

        expect(next.dolly).toBeCloseTo(0.5, 5);
        expect(next.yaw).toBe(0);
    });

    it('returns the dolly on its own duration when nothing is armed', () => {
        const next = advanceActionShellPose(
            { yaw: 0, dolly: 1 },
            HOME,
            ACTION_SHELL_DOLLY_RETURN_MS / 2000,
            ACTION_SHELL_DOLLY_RETURN_MS,
        );

        expect(next.dolly).toBeCloseTo(0.5, 5);
    });

    it('snaps when the dolly duration is zero rather than dividing by it', () => {
        const next = advanceActionShellPose(HOME, { yaw: 0, dolly: 1 }, 0.016, 0);

        expect(next.dolly).toBe(1);
    });

    it('holds still for a non-finite or negative frame delta', () => {
        const current = { yaw: 0.25, dolly: 0.5 };

        expect(advanceActionShellPose(current, { yaw: 1, dolly: 1 }, Number.NaN, 400)).toEqual(
            current,
        );
        expect(advanceActionShellPose(current, { yaw: 1, dolly: 1 }, -1, 400)).toEqual(current);
    });

    it('returns the same object when nothing moved', () => {
        // The rig writes a data attribute off the phase; a fresh object every
        // frame would make "did the pose change" unanswerable by identity.
        const current = { yaw: 1, dolly: 0 };

        expect(advanceActionShellPose(current, { yaw: 1, dolly: 0 }, 0.016, 400)).toBe(current);
    });
});

describe('actionShellCameraView', () => {
    /**
     * How far the look direction has swung from the home pose, in radians,
     * normalised into `(-π, π]` — `atan2` wraps, so a raw difference of the two
     * bearings reports a 55° swing as −305°.
     */
    function swingFromHome(pose: { readonly yaw: number; readonly dolly: number }): number {
        const bearing = (view: ActionShellCameraView): number =>
            Math.atan2(view.lookAt[0] - view.position[0], view.lookAt[2] - view.position[2]);
        const delta =
            bearing(actionShellCameraView(pose, 0)) -
            bearing(actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 0));
        return Math.atan2(Math.sin(delta), Math.cos(delta));
    }

    it('looks at the arena centre from the home pose', () => {
        const view = actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 0);

        expect(view.lookAt[0]).toBeCloseTo(0, 6);
        expect(view.lookAt[2]).toBeCloseTo(0, 6);
    });

    it('swings the LOOK direction on yaw while the camera stays put', () => {
        // Yaw is a look-away, not an orbit: the camera holds its place and the
        // primitives leave frame, which is what puts bare ground on screen.
        const home = actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 0);
        const away = actionShellCameraView({ yaw: 1, dolly: 0 }, 0);

        expect(away.position).toEqual(home.position);
        expect(away.lookAt[0]).not.toBeCloseTo(home.lookAt[0], 2);
    });

    it('rotates the look direction by exactly the declared yaw angle', () => {
        expect(swingFromHome({ yaw: 1, dolly: 0 })).toBeCloseTo(ACTION_SHELL_YAW_RADIANS, 5);
    });

    it('holds the look direction at half yaw halfway between the two', () => {
        expect(swingFromHome({ yaw: 0.5, dolly: 0 })).toBeCloseTo(ACTION_SHELL_YAW_RADIANS / 2, 5);
    });

    it('moves the camera toward the focus cell as the dolly runs', () => {
        const wide = actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 4);
        const close = actionShellCameraView({ yaw: 0, dolly: 1 }, 4);

        expect(close.position[1]).toBeLessThan(wide.position[1]);
        expect(close.position[2]).toBeLessThan(wide.position[2]);
        expect(close.position[0]).toBeCloseTo(4, 6);
        expect(close.lookAt[0]).toBeCloseTo(4, 6);
    });

    it('follows the focus the caller names, not a fixed cell', () => {
        // A dolly that always drove to the arena centre would land on whichever
        // primitive happened to sit there rather than on the drafted one.
        const left = actionShellCameraView({ yaw: 0, dolly: 1 }, -4);
        const right = actionShellCameraView({ yaw: 0, dolly: 1 }, 4);

        expect(left.position[0]).toBeCloseTo(-4, 6);
        expect(right.position[0]).toBeCloseTo(4, 6);
    });

    it('leaves the wide framing on the focus cell alone', () => {
        // Nothing has been armed, so a background that already framed the
        // drafted primitive would be dollied in on the menu.
        const centre = actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 0);
        const offset = actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 4);

        expect(offset.position).toEqual(centre.position);
        expect(offset.lookAt).toEqual(centre.lookAt);
    });
});

describe('phase reporting', () => {
    it('names the yaw endpoints and the move between them', () => {
        expect(describeActionShellYaw(0)).toBe('home');
        expect(describeActionShellYaw(0.5)).toBe('moving');
        expect(describeActionShellYaw(1)).toBe('away');
    });

    it('names a yaw one frame off an endpoint as moving', () => {
        // The endpoint names are the arrival signal; reporting 'home' for a
        // camera still swinging would let a reader act on a move that is still
        // running. The fixture is one 60 Hz frame of the declared yaw ramp.
        const oneFrame = 1000 / 60 / ACTION_SHELL_YAW_MS;

        expect(describeActionShellYaw(oneFrame)).toBe('moving');
        expect(describeActionShellYaw(1 - oneFrame)).toBe('moving');
    });

    it('names the dolly endpoints and the move between them', () => {
        expect(describeActionShellDolly(0)).toBe('wide');
        expect(describeActionShellDolly(0.5)).toBe('moving');
        expect(describeActionShellDolly(1)).toBe('close');
    });

    it('counts a value exactly ON the epsilon as arrived, on both axes and both ends', () => {
        // The slack is INCLUSIVE. A fixture that only straddles the boundary
        // cannot tell `<=` from `<`: a camera parked one epsilon short of an
        // endpoint would report 'moving' forever, and a reader waiting on the
        // arrival would wait forever with it.
        expect(describeActionShellYaw(ACTION_SHELL_ENDPOINT_EPSILON)).toBe('home');
        expect(describeActionShellYaw(1 - ACTION_SHELL_ENDPOINT_EPSILON)).toBe('away');
        expect(describeActionShellDolly(ACTION_SHELL_ENDPOINT_EPSILON)).toBe('wide');
        expect(describeActionShellDolly(1 - ACTION_SHELL_ENDPOINT_EPSILON)).toBe('close');
    });

    it('counts a value just OUTSIDE the epsilon as still moving, on both axes', () => {
        // The other side of the same boundary: a slack widened past what it
        // says would report a camera mid-swing as arrived.
        const outside = ACTION_SHELL_ENDPOINT_EPSILON * 2;

        expect(describeActionShellYaw(outside)).toBe('moving');
        expect(describeActionShellYaw(1 - outside)).toBe('moving');
        expect(describeActionShellDolly(outside)).toBe('moving');
        expect(describeActionShellDolly(1 - outside)).toBe('moving');
    });
});
