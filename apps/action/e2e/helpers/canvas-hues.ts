/**
 * apps/action/e2e/helpers/canvas-hues.ts
 *
 * Counting lit-green pixels in a canvas screenshot.
 *
 * The menu's mirror ball reflects a green environment map, and the action arena
 * paints no green of its own — its primitives are amber, sky-blue and slate on a
 * near-black floor. So a count of bright green pixels is a count of pixels that
 * came from the decoded HDRI, with no before-and-after frame to arrange. What
 * the image holds is `tools/gen-action-environment-hdr.ts`'s to say.
 *
 * Dominance thresholds rather than exact colours: what reaches the screen is a
 * pre-filtered blur of the image, tone-mapped and encoded, so no pixel carries
 * the authored bytes. What survives all of that is which channel leads.
 */

import {
    assertValidFrame,
    MIN_VISIBLE_ALPHA,
    type CanvasRgbaFrame,
} from '../../../../tools/e2e/canvas-frames';

/**
 * How bright the leading channel must be.
 *
 * High, because what is being counted is the reflection of a sky whose radiance
 * exceeds 1.0 — a lit mirror, not a tinted surface. The engine's connection
 * indicator is green and sits in the same screenshot; `canvas-hues.test.ts`
 * carries it as the fixture this floor has to exclude, and the reflection's
 * measured colour as the one it has to admit. Those two fixtures are where the
 * numbers live.
 */
export const MIN_GREEN_CHANNEL = 110;

/** How far the leading channel must clear each of the ones it leads. */
const DOMINANCE_DELTA = 25;

/** Green: the channel leads both others by a clear margin, and is lit. */
export function isGreenPixel(red: number, green: number, blue: number): boolean {
    return (
        green >= MIN_GREEN_CHANNEL &&
        green - red >= DOMINANCE_DELTA &&
        green - blue >= DOMINANCE_DELTA
    );
}

export interface CanvasGreenCounts {
    readonly green: number;
    readonly visible: number;
}

/** How many drawn pixels of `frame` read as a lit green. */
export function countLitGreen(frame: CanvasRgbaFrame): CanvasGreenCounts {
    assertValidFrame(frame);

    let green = 0;
    let visible = 0;

    for (let offset = 0; offset < frame.rgba.length; offset += 4) {
        if ((frame.rgba[offset + 3] ?? 0) < MIN_VISIBLE_ALPHA) {
            continue;
        }
        visible += 1;
        if (
            isGreenPixel(
                frame.rgba[offset] ?? 0,
                frame.rgba[offset + 1] ?? 0,
                frame.rgba[offset + 2] ?? 0,
            )
        ) {
            green += 1;
        }
    }

    return { green, visible };
}
