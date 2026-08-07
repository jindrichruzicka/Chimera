/**
 * renderer/components/r3f/cameraFit.ts
 *
 * The canvas-aspect fit policy for a `manual` GameCanvas camera (§4.22), as
 * pure geometry — no React, no three.js, no DOM.
 *
 * A `manual` camera projects at an aspect of its own: `(right - left) /
 * (top - bottom)` for an orthographic frustum, the pinned `aspect` for a
 * perspective one. Three maps that projection onto the whole GL viewport, one
 * axis independently of the other, so wherever the canvas aspect diverges the
 * result is stretched. `CameraFit` names what to do about the divergence; the
 * functions here compute each answer.
 *
 * Every function is total over finite, positive-extent inputs and mutates
 * nothing — `GameCanvas` owns the DOM box and the three.js camera these
 * numbers are applied to.
 */

/**
 * What happens when the canvas aspect diverges from the camera's own aspect
 * (ortho: `(right - left) / (top - bottom)`; perspective: the pinned
 * `aspect`). Only meaningful for a `manual` camera — a responsive perspective
 * camera has no divergence to resolve.
 *
 * - `'letterbox'` (the default) — the authored frustum is rendered at its
 *   exact aspect, centred, with bars filling the remainder. The one policy
 *   under which an authored world framing means exactly one thing on every
 *   display.
 * - `'expand'` — the frustum grows on its short axis to fill the canvas: no
 *   bars, and a wider monitor sees *more* world. Never distorts, but the
 *   authored bounds become a guaranteed minimum rather than an exact framing.
 * - `'stretch'` — no correction at all. The named escape hatch for a game that
 *   wants the frustum mapped onto the whole canvas whatever its shape.
 */
export type CameraFit = 'letterbox' | 'expand' | 'stretch';

/** The fit a camera config gets when it names none. */
export const DEFAULT_CAMERA_FIT = 'letterbox' as const satisfies CameraFit;

/** A CSS-pixel box: the canvas container, or the fitted rect inside it. */
export type CanvasBox = Readonly<{ width: number; height: number }>;

/** The four world-unit sides of an orthographic view volume. */
export type FrustumBounds = Readonly<{
    left: number;
    right: number;
    top: number;
    bottom: number;
}>;

/** The aspect an orthographic frustum projects at, independent of its centre. */
export function frustumAspect(frustum: FrustumBounds): number {
    return (frustum.right - frustum.left) / (frustum.top - frustum.bottom);
}

/**
 * The largest box of `aspect` that fits inside `container` — the `'letterbox'`
 * answer. A container wider than the camera keeps its height and loses width
 * (pillarbox, side bars); a taller one keeps its width and loses height
 * (letterbox, top/bottom bars). One axis always survives intact, so the result
 * is the largest such box and never overflows.
 */
export function fitBoxToAspect(container: CanvasBox, aspect: number): CanvasBox {
    return container.width / container.height > aspect
        ? { width: container.height * aspect, height: container.height }
        : { width: container.width, height: container.width / aspect };
}

/**
 * This module treats a remainder under half a CSS pixel as no remainder at all:
 * pinning the canvas to it would trade a hairline bar for a hairline resize.
 * Centring splits the remainder across two bars, so each is half of this.
 */
const MINIMUM_REMAINDER_PX = 0.5;

/**
 * The rect a `'letterbox'` fit puts the canvas in, or `null` when fitting
 * `container` to `aspect` would leave no remainder worth the name. For a
 * container that already has the camera's shape this returns `null`, and the
 * caller then pins nothing and paints nothing.
 */
export function letterboxCanvasBox(container: CanvasBox, aspect: number): CanvasBox | null {
    const fitted = fitBoxToAspect(container, aspect);
    const hasRemainder =
        container.width - fitted.width >= MINIMUM_REMAINDER_PX ||
        container.height - fitted.height >= MINIMUM_REMAINDER_PX;

    return hasRemainder ? fitted : null;
}

/**
 * Grow the short axis of `frustum` until it projects at `canvasAspect` — the
 * `'expand'` answer for an orthographic camera. Growth is centred on the
 * frustum's own centre, so an off-centre framing (a board camera aimed at the
 * board centre) keeps its subject centred; the authored bounds stay fully
 * inside the result, which is what makes them a minimum rather than an exact
 * framing.
 */
export function expandFrustumToAspect(frustum: FrustumBounds, canvasAspect: number): FrustumBounds {
    const centerX = (frustum.left + frustum.right) / 2;
    const centerY = (frustum.top + frustum.bottom) / 2;
    const halfWidth = (frustum.right - frustum.left) / 2;
    const halfHeight = (frustum.top - frustum.bottom) / 2;
    const grown =
        canvasAspect > frustumAspect(frustum)
            ? { halfWidth: halfHeight * canvasAspect, halfHeight }
            : { halfWidth, halfHeight: halfWidth / canvasAspect };

    return {
        left: centerX - grown.halfWidth,
        right: centerX + grown.halfWidth,
        top: centerY + grown.halfHeight,
        bottom: centerY - grown.halfHeight,
    };
}

/**
 * Grow the short axis of a pinned perspective frustum until it projects at
 * `canvasAspect` — the `'expand'` answer for a perspective camera.
 *
 * `fov` is *vertical*, so taking the canvas aspect alone already grows the
 * horizontal axis and nothing else is needed on a canvas wider than the pinned
 * aspect. On a taller one the horizontal extent would shrink below the
 * authored one, so the fov is widened until the horizontal half-extent at unit
 * depth (`tan(fov / 2) * aspect`) is back to its authored value.
 */
export function expandPerspectiveToAspect(
    fovDegrees: number,
    pinnedAspect: number,
    canvasAspect: number,
): Readonly<{ fov: number; aspect: number }> {
    if (canvasAspect >= pinnedAspect) {
        return { fov: fovDegrees, aspect: canvasAspect };
    }

    const authoredHalfWidth = Math.tan((fovDegrees * Math.PI) / 360) * pinnedAspect;

    return {
        fov: (Math.atan(authoredHalfWidth / canvasAspect) * 360) / Math.PI,
        aspect: canvasAspect,
    };
}
