// The shell background's camera, as a pure model.
//
// The background reacts to two facts the shell publishes about itself: the
// SURFACE the player is on (§4.37.18) and the armed match TRANSITION. Settings
// yaws the camera away onto bare ground and back; a `to-match` transition
// dollies it toward the primitive the draft names, over the same clock the
// engine is running its screen fade on. Both moves are eased frame by frame in
// `useFrame` off a transient `getShellState()` read, which is why every rule
// here is a value transform: the component owns the loop, this owns the answer.
//
// The pose is TWO INDEPENDENT axes, not one enum of named poses. A named-pose
// model has to decide what "settings while entering a match" is; two axes just
// run both, and neither can freeze the other halfway.
//
// Pure and boundary-clean: no renderer types, no three.js, no React — a plain
// `.ts` under `shell/`, which `chimera/no-game-renderer-internals` does not
// treat as a renderer surface. The vectors are plain tuples in the form r3f's
// `position` prop takes, so the component hands them straight on.

/** A camera pose, as two independent 0→1 fractions. */
export interface ActionShellCameraPose {
    /** 0 = the primitives are in frame; 1 = swung fully away onto bare ground. */
    readonly yaw: number;
    /** 0 = the wide shell framing; 1 = dollied onto the drafted primitive. */
    readonly dolly: number;
}

/** The pose the background opens on and returns to. */
export const ACTION_SHELL_CAMERA_HOME: ActionShellCameraPose = Object.freeze({ yaw: 0, dolly: 0 });

/** How far the look direction swings at full yaw, in radians (≈ 55°). */
export const ACTION_SHELL_YAW_RADIANS = 0.96;

/** How long a full yaw takes, in milliseconds — the background's own clock. */
export const ACTION_SHELL_YAW_MS = 600;

/**
 * How long the dolly takes to come BACK, in milliseconds.
 *
 * Its outward leg is timed by the engine instead: `ShellTransition.durationMs`
 * carries the screen fade the entry is running, so the move lands with the
 * fade rather than guessing at it. There is no transition to read on the way
 * back — a cancelled entry simply clears one — so the return needs a duration
 * of its own.
 */
export const ACTION_SHELL_DOLLY_RETURN_MS = 400;

/** Camera placement at the wide framing. */
const HOME_POSITION: readonly [number, number, number] = [0, 6.5, 14];
/** What the wide framing looks at: the primitive row, at primitive height. */
const HOME_TARGET: readonly [number, number, number] = [0, 0.5, 0];
/** Camera height and standoff once the dolly has fully run. */
const DOLLY_HEIGHT = 2.2;
const DOLLY_STANDOFF = 4.5;

/**
 * How close to an endpoint still counts as being at it, INCLUSIVE.
 *
 * The slack between "arrived" and "still moving": one frame of a 600 ms ramp at
 * 60 Hz moves ≈ 0.028, comfortably outside it, so a camera that is genuinely
 * moving is never reported as having arrived.
 *
 * Exported because it is part of what the two phase readers below MEAN, not a
 * private tuning knob: a test that restated the number would be pinning its own
 * copy rather than this one.
 */
export const ACTION_SHELL_ENDPOINT_EPSILON = 0.001;

/** Where the camera is and what it is looking at, in world space. */
export interface ActionShellCameraView {
    readonly position: readonly [number, number, number];
    readonly lookAt: readonly [number, number, number];
}

/** Which end of the yaw the camera is at, or that it is between them. */
export type ActionShellYawPhase = 'home' | 'moving' | 'away';

/** Which end of the dolly the camera is at, or that it is between them. */
export type ActionShellDollyPhase = 'wide' | 'moving' | 'close';

/** The pose the current shell state calls for. */
export function resolveActionShellCameraTarget(input: {
    readonly isSettings: boolean;
    readonly isEnteringMatch: boolean;
}): ActionShellCameraPose {
    return {
        yaw: input.isSettings ? 1 : 0,
        dolly: input.isEnteringMatch ? 1 : 0,
    };
}

/** One linear step of `value` toward `target`, never past it. */
function approach(value: number, target: number, step: number): number {
    if (value === target) {
        return value;
    }
    if (step <= 0) {
        return target;
    }
    const delta = target - value;
    return Math.abs(delta) <= step ? target : value + Math.sign(delta) * step;
}

/**
 * Advance the pose by one frame.
 *
 * Returns the INPUT REFERENCE when nothing moved, so the caller can decide
 * whether to touch the DOM by identity rather than by comparing fractions
 * every frame. A non-finite or negative delta — the shape a resumed tab and a
 * clock jump arrive in — moves nothing rather than teleporting.
 *
 * @param dollyMs The dolly's duration for THIS frame: the armed transition's
 *   `durationMs` on the way in, {@link ACTION_SHELL_DOLLY_RETURN_MS} on the way
 *   back. Zero or less snaps, rather than dividing by it.
 */
export function advanceActionShellPose(
    current: ActionShellCameraPose,
    target: ActionShellCameraPose,
    deltaSeconds: number,
    dollyMs: number,
): ActionShellCameraPose {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
        return current;
    }

    const yaw = approach(current.yaw, target.yaw, (deltaSeconds * 1000) / ACTION_SHELL_YAW_MS);
    const dolly = approach(
        current.dolly,
        target.dolly,
        dollyMs <= 0 ? Number.POSITIVE_INFINITY : (deltaSeconds * 1000) / dollyMs,
    );

    if (yaw === current.yaw && dolly === current.dolly) {
        return current;
    }
    return { yaw, dolly };
}

function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * t;
}

/**
 * The camera placement and look target for `pose`.
 *
 * `focusX` is the arena X of the primitive the draft names — the cell the dolly
 * drives to. It is inert at `dolly === 0`, which is what keeps the menu framing
 * identical whichever primitive is picked.
 *
 * The yaw is applied to the look DIRECTION about the world Y axis, so the
 * camera holds its place while the primitives leave frame. An orbit would keep
 * them centred and show the same scene from a new side, which is not what
 * "look away to bare ground" means.
 */
export function actionShellCameraView(
    pose: ActionShellCameraPose,
    focusX: number,
): ActionShellCameraView {
    const position: readonly [number, number, number] = [
        lerp(HOME_POSITION[0], focusX, pose.dolly),
        lerp(HOME_POSITION[1], DOLLY_HEIGHT, pose.dolly),
        lerp(HOME_POSITION[2], DOLLY_STANDOFF, pose.dolly),
    ];
    const framed: readonly [number, number, number] = [
        lerp(HOME_TARGET[0], focusX, pose.dolly),
        HOME_TARGET[1],
        HOME_TARGET[2],
    ];

    const angle = pose.yaw * ACTION_SHELL_YAW_RADIANS;
    const dx = framed[0] - position[0];
    const dz = framed[2] - position[2];
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);

    return {
        position,
        lookAt: [position[0] + dx * cos + dz * sin, framed[1], position[2] + dz * cos - dx * sin],
    };
}

/** Which end of the yaw `value` is at — the fact the background publishes. */
export function describeActionShellYaw(value: number): ActionShellYawPhase {
    if (value <= ACTION_SHELL_ENDPOINT_EPSILON) return 'home';
    if (value >= 1 - ACTION_SHELL_ENDPOINT_EPSILON) return 'away';
    return 'moving';
}

/** Which end of the dolly `value` is at — the fact the background publishes. */
export function describeActionShellDolly(value: number): ActionShellDollyPhase {
    if (value <= ACTION_SHELL_ENDPOINT_EPSILON) return 'wide';
    if (value >= 1 - ACTION_SHELL_ENDPOINT_EPSILON) return 'close';
    return 'moving';
}
