import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CAMERA_FIT,
    expandFrustumToAspect,
    expandPerspectiveToAspect,
    fitBoxToAspect,
    frustumAspect,
    letterboxCanvasBox,
    type CameraFit,
} from './cameraFit';

/** The preset frustum — 20 × 12.5 world units. */
const PRESET_FRUSTUM = { left: -10, right: 10, top: 6.25, bottom: -6.25 } as const;

/** The tactics board camera's WORLD bounds — 7.5 × 5, centred on (1, 0). */
const OFF_CENTRE_FRUSTUM = { left: -2.75, right: 4.75, top: 2.5, bottom: -2.5 } as const;

/** Off-centre on the OTHER axis — the one an origin-anchored grow gets wrong. */
const HIGH_FRUSTUM = { left: -10, right: 10, top: 12, bottom: 2 } as const;

const SIXTEEN_BY_NINE = 1920 / 1080;

describe('frustumAspect', () => {
    it.each([
        ['the 16:10 preset frustum', PRESET_FRUSTUM, 1.6],
        ['the 3:2 tactics bounds', OFF_CENTRE_FRUSTUM, 1.5],
        ['a square frustum', { left: -10, right: 10, top: 10, bottom: -10 }, 1],
    ])('reports %s as (right - left) / (top - bottom)', (_label, frustum, expected) => {
        expect(frustumAspect(frustum)).toBeCloseTo(expected, 10);
    });

    it('is unchanged by translating the frustum off the origin', () => {
        // The aspect is a ratio of extents; only the extents may enter it.
        expect(frustumAspect(OFF_CENTRE_FRUSTUM)).toBe(
            frustumAspect({ left: -3.75, right: 3.75, top: 2.5, bottom: -2.5 }),
        );
    });
});

describe('fitBoxToAspect', () => {
    it('pillarboxes a canvas wider than the camera — height preserved, width = height x aspect', () => {
        const fitted = fitBoxToAspect({ width: 1920, height: 1080 }, 1.6);

        expect(fitted).toEqual({ width: 1728, height: 1080 });
    });

    it('letterboxes a canvas taller than the camera — width preserved, height = width / aspect', () => {
        const fitted = fitBoxToAspect({ width: 1000, height: 1000 }, 1.6);

        expect(fitted).toEqual({ width: 1000, height: 625 });
    });

    it('returns the container unchanged when the two aspects already agree', () => {
        expect(fitBoxToAspect({ width: 1600, height: 1000 }, 1.6)).toEqual({
            width: 1600,
            height: 1000,
        });
    });

    it.each([
        [{ width: 1920, height: 1080 }, 1.6],
        [{ width: 1000, height: 1000 }, 1.6],
        [{ width: 800, height: 600 }, 1.5],
        [{ width: 300, height: 900 }, 2.5],
        [{ width: 640, height: 400 }, 0.5],
    ])('fits inside %o at aspect %d and keeps that exact aspect', (container, aspect) => {
        const fitted = fitBoxToAspect(container, aspect);

        expect(fitted.width).toBeLessThanOrEqual(container.width);
        expect(fitted.height).toBeLessThanOrEqual(container.height);
        expect(fitted.width / fitted.height).toBeCloseTo(aspect, 10);
        // Largest such box: growing either axis would overflow the container.
        expect(
            Math.abs(fitted.width - container.width) < 1e-9 ||
                Math.abs(fitted.height - container.height) < 1e-9,
        ).toBe(true);
    });
});

describe('letterboxCanvasBox', () => {
    it.each([
        ['a wider canvas', { width: 1920, height: 1080 }, 1.6, { width: 1728, height: 1080 }],
        ['a taller canvas', { width: 1000, height: 1000 }, 1.6, { width: 1000, height: 625 }],
    ])('fits %s to the camera aspect', (_label, container, aspect, expected) => {
        expect(letterboxCanvasBox(container, aspect)).toEqual(expected);
    });

    it.each([
        ['an exactly matching container', { width: 1600, height: 1000 }, 1.6],
        // The tactics minimap: a 12 x 8 --ch-space-md box against the board's 3:2
        // frustum, and the in-tree case for the exact-match branch.
        ['the tactics minimap box', { width: 192, height: 128 }, 1.5],
        ['a container off by a fifth of a pixel', { width: 1600, height: 1000.2 }, 1.6],
        ['a container off by just under half a pixel', { width: 1600.4, height: 1000 }, 1.6],
    ])(
        'returns null for %s, so the caller pins nothing and paints nothing',
        (_label, container, aspect) => {
            expect(letterboxCanvasBox(container, aspect)).toBeNull();
        },
    );

    it.each([
        ['width', { width: 1600.5, height: 1000 }, { width: 1600, height: 1000 }],
        ['height', { width: 1000, height: 625.5 }, { width: 1000, height: 625 }],
    ])(
        'fits a container once the %s REMAINDER reaches half a pixel',
        (_axis, container, expected) => {
            // Half a pixel of remainder is the threshold on either axis, and it
            // is inclusive. Centring splits it, so the two bars are a
            // quarter-pixel each.
            expect(letterboxCanvasBox(container, 1.6)).toEqual(expected);
        },
    );
});

describe('expandFrustumToAspect', () => {
    it('widens the short axis of a 16:10 frustum on a 16:9 canvas and keeps the tall axis', () => {
        const expanded = expandFrustumToAspect(PRESET_FRUSTUM, SIXTEEN_BY_NINE);

        expect(expanded.top).toBe(6.25);
        expect(expanded.bottom).toBe(-6.25);
        expect(expanded.right).toBeCloseTo(6.25 * SIXTEEN_BY_NINE, 10);
        expect(expanded.left).toBeCloseTo(-6.25 * SIXTEEN_BY_NINE, 10);
    });

    it('heightens the short axis on a canvas taller than the camera and keeps the wide axis', () => {
        const expanded = expandFrustumToAspect(PRESET_FRUSTUM, 1);

        expect(expanded.left).toBe(-10);
        expect(expanded.right).toBe(10);
        expect(expanded.top).toBeCloseTo(10, 10);
        expect(expanded.bottom).toBeCloseTo(-10, 10);
    });

    it.each([
        ['horizontally', OFF_CENTRE_FRUSTUM, SIXTEEN_BY_NINE, 1, 0],
        // Centre (0, 7) and a canvas TALLER than the frustum, so the grow runs on
        // the y axis — the one an origin-anchored grow gets wrong.
        ['vertically', HIGH_FRUSTUM, 1, 0, 7],
    ] as const)(
        'grows a %s off-centre frustum around its own centre, not the world origin',
        (_axis, frustum, canvasAspect, centerX, centerY) => {
            const expanded = expandFrustumToAspect(frustum, canvasAspect);

            expect((expanded.left + expanded.right) / 2).toBeCloseTo(centerX, 10);
            expect((expanded.top + expanded.bottom) / 2).toBeCloseTo(centerY, 10);
        },
    );

    it.each([
        [OFF_CENTRE_FRUSTUM, SIXTEEN_BY_NINE],
        [OFF_CENTRE_FRUSTUM, 1.6],
        [OFF_CENTRE_FRUSTUM, 1],
        [OFF_CENTRE_FRUSTUM, 0.5],
        [OFF_CENTRE_FRUSTUM, 3],
        [HIGH_FRUSTUM, SIXTEEN_BY_NINE],
        [HIGH_FRUSTUM, 1.6],
        [HIGH_FRUSTUM, 1],
        [HIGH_FRUSTUM, 0.5],
        [HIGH_FRUSTUM, 3],
    ] as const)(
        'keeps the authored bounds of %o fully inside the frustum expanded to canvas aspect %d',
        (frustum, canvasAspect) => {
            const expanded = expandFrustumToAspect(frustum, canvasAspect);

            expect(expanded.left).toBeLessThanOrEqual(frustum.left + 1e-9);
            expect(expanded.right).toBeGreaterThanOrEqual(frustum.right - 1e-9);
            expect(expanded.top).toBeGreaterThanOrEqual(frustum.top - 1e-9);
            expect(expanded.bottom).toBeLessThanOrEqual(frustum.bottom + 1e-9);
            expect(frustumAspect(expanded)).toBeCloseTo(canvasAspect, 10);
        },
    );

    it('leaves the frustum untouched when the canvas already matches its aspect', () => {
        expect(expandFrustumToAspect(OFF_CENTRE_FRUSTUM, 1.5)).toEqual({
            left: -2.75,
            right: 4.75,
            top: 2.5,
            bottom: -2.5,
        });
    });
});

describe('expandPerspectiveToAspect', () => {
    it('takes the canvas aspect and keeps the fov on a canvas wider than the pinned aspect', () => {
        const expanded = expandPerspectiveToAspect(50, 1.6, SIXTEEN_BY_NINE);

        expect(expanded.fov).toBe(50);
        expect(expanded.aspect).toBe(SIXTEEN_BY_NINE);
    });

    it('widens the fov on a canvas taller than the pinned aspect, holding the horizontal extent', () => {
        const expanded = expandPerspectiveToAspect(50, 1.6, 1);

        expect(expanded.aspect).toBe(1);
        // Horizontal half-extent at unit depth = tan(fov / 2) * aspect. Holding
        // it is what "the frustum grows on the SHORT axis" means for a
        // perspective camera, whose fov is vertical.
        expect(Math.tan((expanded.fov * Math.PI) / 360) * expanded.aspect).toBeCloseTo(
            Math.tan((50 * Math.PI) / 360) * 1.6,
            10,
        );
        expect(expanded.fov).toBeGreaterThan(50);
    });

    it('leaves fov and aspect untouched when the canvas already matches the pinned aspect', () => {
        expect(expandPerspectiveToAspect(75, 1.5, 1.5)).toEqual({ fov: 75, aspect: 1.5 });
    });

    it.each([SIXTEEN_BY_NINE, 1.6, 1, 0.5, 3])(
        'keeps the authored vertical and horizontal extents inside the result at canvas aspect %d',
        (canvasAspect) => {
            const authoredHalfHeight = Math.tan((50 * Math.PI) / 360);
            const authoredHalfWidth = authoredHalfHeight * 1.6;
            const expanded = expandPerspectiveToAspect(50, 1.6, canvasAspect);
            const halfHeight = Math.tan((expanded.fov * Math.PI) / 360);

            expect(halfHeight).toBeGreaterThanOrEqual(authoredHalfHeight - 1e-9);
            expect(halfHeight * expanded.aspect).toBeGreaterThanOrEqual(authoredHalfWidth - 1e-9);
            expect(expanded.aspect).toBeCloseTo(canvasAspect, 10);
        },
    );
});

describe('DEFAULT_CAMERA_FIT', () => {
    it('is letterbox — an authored framing means one thing on every display', () => {
        const fit: CameraFit = DEFAULT_CAMERA_FIT;

        expect(fit).toBe('letterbox');
    });
});
