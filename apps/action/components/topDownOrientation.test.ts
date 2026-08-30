import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';

import {
    ACTION_MOVE_DIRECTIONS,
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_UP_ACTION,
} from '../input-action-ids.js';
import { arenaToWorld } from './actionSceneModel.js';

/**
 * Why arrow-Up is `dy: -1`.
 *
 * The mapping rests on a property of the engine's `top-down` camera preset: it
 * looks straight down the -Y axis with `up` at +Y, which is DEGENERATE — the
 * view direction and `up` are parallel, so `Matrix4.lookAt` cannot take their
 * cross product and falls into a fallback branch that nudges one axis by a
 * ten-thousandth. Screen-up lands on world -Z because of which axis that
 * fallback picks.
 *
 * That is a three.js implementation detail, not a documented contract, and the
 * failure mode if it ever changes is silent: `move-up` becomes `move-left` with
 * every other test in this app still green (`arenaToWorld` is axis-only, and the
 * app has no e2e yet). So it is measured here against three itself.
 *
 * The camera's own numbers are the ENGINE's — `cameraPresetConfigs['top-down']`
 * in `GameCanvas`, which a game cannot import — so they are restated below and
 * the restatement is the limit of this test: it pins how three resolves that
 * viewpoint, not that the preset still declares it. What pins the preset SELECTION
 * is `ActionPlayfield.test.tsx` › `mounts exactly one main-role canvas on the
 * top-down preset`.
 */
const PRESET_POSITION = [0, 20, 0] as const;
const PRESET_LOOK_AT = [0, 0, 0] as const;
/** `GameCanvas`'s `DEFAULT_UP`, applied because the preset declares no `up`. */
const PRESET_UP = [0, 1, 0] as const;

/** The world-space direction that appears as "up" on screen for that viewpoint. */
function screenUpInWorld(): Vector3 {
    const camera = new OrthographicCamera();
    camera.up.set(...PRESET_UP);
    camera.position.set(...PRESET_POSITION);
    camera.lookAt(new Vector3(...PRESET_LOOK_AT));
    camera.updateMatrixWorld(true);
    // Column 1 of the world matrix is the camera's own +Y basis vector — what
    // the viewer reads as up. `camera.up` is the INPUT to `lookAt` and is left
    // untouched by it, so reading that field back would answer +Y and prove
    // nothing.
    return new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
}

describe('the top-down preset’s screen orientation', () => {
    it('puts screen-up on world -Z', () => {
        const up = screenUpInWorld();

        expect(up.z).toBeCloseTo(-1, 3);
        expect(up.x).toBeCloseTo(0, 3);
        expect(up.y).toBeCloseTo(0, 3);
    });

    it('puts screen-right on world +X', () => {
        // The other axis of the same basis: without it a rotation that put
        // screen-up on -Z and screen-right on -X would pass the check above
        // while mirroring left and right.
        const camera = new OrthographicCamera();
        camera.up.set(...PRESET_UP);
        camera.position.set(...PRESET_POSITION);
        camera.lookAt(new Vector3(...PRESET_LOOK_AT));
        camera.updateMatrixWorld(true);

        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        expect(right.x).toBeCloseTo(1, 3);
        expect(right.z).toBeCloseTo(0, 3);
    });

    it('sends the "move up" action’s step toward screen-up', () => {
        // The claim the whole file exists for, assembled from the two halves:
        // the direction table's step, mapped to world by `arenaToWorld`, points
        // the same way as screen-up.
        const up = screenUpInWorld();
        const step = ACTION_MOVE_DIRECTIONS[ACTION_MOVE_UP_ACTION];
        const [dx, , dz] = arenaToWorld({ x: step.dx, y: step.dy }, 0);

        expect(new Vector3(dx, 0, dz).normalize().dot(up)).toBeCloseTo(1, 3);
    });

    it('sends the "move down" action’s step the opposite way', () => {
        const up = screenUpInWorld();
        const step = ACTION_MOVE_DIRECTIONS[ACTION_MOVE_DOWN_ACTION];
        const [dx, , dz] = arenaToWorld({ x: step.dx, y: step.dy }, 0);

        expect(new Vector3(dx, 0, dz).normalize().dot(up)).toBeCloseTo(-1, 3);
    });
});
