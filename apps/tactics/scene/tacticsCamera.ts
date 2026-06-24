export const TACTICS_CAMERA_POSITION = [1, 12, 0] as const;
export const TACTICS_CAMERA_LOOK_AT = [1, 0, 0] as const;

// Orthographic frustum, centred on the board centre (1, 0) via TACTICS_CAMERA_POSITION.
// Widened ~1.25× from the board-exact 6×4 framing so units at the seat 2–3 corner
// start positions (TACTICS_START_POSITIONS) clear the viewport edge instead of being
// half-clipped, while preserving the 3:2 aspect so units stay circular (the manual
// camera is not aspect-corrected). tacticsCamera.test.ts guards the corner clearance.
export const TACTICS_CAMERA_BOUNDS = {
    left: -3.75,
    right: 3.75,
    top: 2.5,
    bottom: -2.5,
    near: 0.1,
    far: 100,
} as const;

export const TACTICS_CAMERA_WORLD_BOUNDS = {
    left: TACTICS_CAMERA_POSITION[0] + TACTICS_CAMERA_BOUNDS.left,
    right: TACTICS_CAMERA_POSITION[0] + TACTICS_CAMERA_BOUNDS.right,
    top: TACTICS_CAMERA_POSITION[2] + TACTICS_CAMERA_BOUNDS.top,
    bottom: TACTICS_CAMERA_POSITION[2] + TACTICS_CAMERA_BOUNDS.bottom,
} as const;
