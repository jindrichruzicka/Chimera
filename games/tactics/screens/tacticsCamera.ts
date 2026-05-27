export const TACTICS_CAMERA_POSITION = [1, 12, 0] as const;
export const TACTICS_CAMERA_LOOK_AT = [1, 0, 0] as const;

export const TACTICS_CAMERA_BOUNDS = {
    left: -3,
    right: 3,
    top: 2,
    bottom: -2,
    near: 0.1,
    far: 100,
} as const;

export const TACTICS_CAMERA_WORLD_BOUNDS = {
    left: TACTICS_CAMERA_POSITION[0] + TACTICS_CAMERA_BOUNDS.left,
    right: TACTICS_CAMERA_POSITION[0] + TACTICS_CAMERA_BOUNDS.right,
    top: TACTICS_CAMERA_POSITION[2] + TACTICS_CAMERA_BOUNDS.top,
    bottom: TACTICS_CAMERA_POSITION[2] + TACTICS_CAMERA_BOUNDS.bottom,
} as const;
