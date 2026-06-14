import { describe, expect, it } from 'vitest';
import { TACTICS_START_POSITIONS } from '@chimera/shared/tactics.js';
import { TACTICS_CAMERA_WORLD_BOUNDS } from './tacticsCamera';

// Cylinder base radius (0.36) grown by the affordance scale (×1.12 ≈ 0.40) and the
// persistent own-unit ring (0.42); a start position must clear the viewport edge by
// at least this much so seat 2–3 corner units render whole rather than clipped.
const UNIT_FOOTPRINT_RADIUS = 0.45;

describe('tacticsCamera', () => {
    it('frames every start position inside the camera world bounds with unit clearance', () => {
        const { left, right, top, bottom } = TACTICS_CAMERA_WORLD_BOUNDS;

        for (const { x, y } of TACTICS_START_POSITIONS) {
            // gridToWorldPoint maps grid (x, y) to world (x, _, y): world.z = grid.y.
            expect(x - left).toBeGreaterThanOrEqual(UNIT_FOOTPRINT_RADIUS);
            expect(right - x).toBeGreaterThanOrEqual(UNIT_FOOTPRINT_RADIUS);
            expect(y - bottom).toBeGreaterThanOrEqual(UNIT_FOOTPRINT_RADIUS);
            expect(top - y).toBeGreaterThanOrEqual(UNIT_FOOTPRINT_RADIUS);
        }
    });
});
