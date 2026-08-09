/**
 * renderer/animation/ClipPosition.ts
 *
 * Resolves an authored {@link ClipPosition} — a bare phase, `{ seconds }` or
 * `{ frame }` — into the one unit the playback layer works in: a normalized phase
 * in `[0, 1]`.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Resolution is FAIL-SOFT and NEVER throws into a caller, the posture
 * `renderer/audio/audioCueSheet.ts` takes for cue sheets (Invariant #118). It
 * also never calls a logger: it RETURNS the warning string in the result, so a
 * caller can count warnings synchronously and decide once where they go.
 *
 * Out-of-range and unusable are kept apart on purpose. A position that merely
 * points past an end CLAMPS — the author meant "the end". A position the resolver
 * cannot place at all is REJECTED — a phase of 0 or 1 would be a mark the author
 * never wrote, firing at the clip start or the clip end.
 *
 * This module is the compile half: pure arithmetic, no three.js, no React, no DOM.
 */

import type { ClipPosition } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

/** What a clip can tell the resolver about itself. Both fields are genuinely optional. */
export interface ClipPositionContext {
    /**
     * The clip's length in seconds. Supplied by the caller from the RUNTIME clip,
     * never from the sheet's authoring-time value — see `ClipTimeline.ts`.
     */
    readonly durationSeconds?: number;
    /** How many frames the clip's run holds. Sprite clips declare it; mesh clips do not. */
    readonly frameCount?: number;
}

/** The result of resolving one position. `rejected` always carries one non-empty warning. */
export type ClipPositionResolution =
    | { readonly kind: 'resolved'; readonly phase: number }
    | { readonly kind: 'rejected'; readonly warning: string };

/**
 * Resolve `position` to a phase in `[0, 1]` against whatever `ctx` can supply.
 *
 * - a bare `number` is already a phase and needs no context;
 * - `{ seconds }` divides by `ctx.durationSeconds`;
 * - `{ frame }` divides by `ctx.frameCount`, mapping a frame onto the START of
 *   its own cell — so frame 0 is the clip start, and the last frame of an
 *   `n`-frame run sits at `(n - 1) / n` rather than at the clip end, where a
 *   `'once'` clip has already stopped.
 *
 * A missing context field is a rejection, not a default; so is a non-finite
 * number, a fractional frame index, and a shape that is no position at all —
 * every one of which is reachable, because a sheet arrives through the `unknown`
 * `AssetManifestEntry.metadata` slot.
 */
export function resolveClipPosition(
    position: ClipPosition,
    ctx: ClipPositionContext,
): ClipPositionResolution {
    if (typeof position === 'number') {
        return Number.isFinite(position)
            ? resolved(clamp01(position))
            : rejected(`position ${describePosition(position)} is not a finite phase`);
    }

    if (typeof position !== 'object' || position === null) {
        return rejected(`position ${describePosition(position)} is not a clip position`);
    }

    const record = position as Readonly<Record<string, unknown>>;
    const rawSeconds = record['seconds'];
    const rawFrame = record['frame'];

    if (rawSeconds !== undefined && rawFrame !== undefined) {
        // Nothing in the union's two object arms stops them being merged, and
        // either precedence would place the mark somewhere unwritten.
        return rejected(
            `position ${describePosition(position)} declares both seconds and frame; which one is meant is ambiguous`,
        );
    }

    if (rawSeconds !== undefined) {
        return resolveSeconds(rawSeconds, ctx.durationSeconds, position);
    }
    if (rawFrame !== undefined) {
        return resolveFrame(rawFrame, ctx.frameCount, position);
    }
    return rejected(`position ${describePosition(position)} is not a clip position`);
}

// ─── internals ──────────────────────────────────────────────────────────────────

function resolveSeconds(
    rawSeconds: unknown,
    durationSeconds: number | undefined,
    position: unknown,
): ClipPositionResolution {
    if (typeof rawSeconds !== 'number' || !Number.isFinite(rawSeconds)) {
        return rejected(`position ${describePosition(position)} declares a non-finite second`);
    }
    // A zero duration is why this is a range test and not a presence test:
    // dividing by it yields Infinity, which the clamp would turn into a phase of 1.
    if (
        durationSeconds === undefined ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0
    ) {
        return rejected(
            `position ${describePosition(position)} needs the clip duration to resolve, and none is available`,
        );
    }
    return resolved(clamp01(rawSeconds / durationSeconds));
}

function resolveFrame(
    rawFrame: unknown,
    frameCount: number | undefined,
    position: unknown,
): ClipPositionResolution {
    if (typeof rawFrame !== 'number' || !Number.isInteger(rawFrame)) {
        return rejected(
            `position ${describePosition(position)} declares a frame that is not a whole number`,
        );
    }
    if (frameCount === undefined || !Number.isInteger(frameCount) || frameCount <= 0) {
        return rejected(
            `position ${describePosition(position)} needs a frameCount to resolve, and the clip declares none`,
        );
    }
    return resolved(clamp01(rawFrame / frameCount));
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function resolved(phase: number): ClipPositionResolution {
    return { kind: 'resolved', phase };
}

function rejected(warning: string): ClipPositionResolution {
    return { kind: 'rejected', warning };
}

/** A readable rendering of any value, for the warning text. Never throws. */
function describePosition(position: unknown): string {
    if (typeof position === 'object' && position !== null) {
        try {
            // `JSON.stringify` throws on a cycle — which a sheet built in code
            // can hold even though a parsed one cannot — and answers `undefined`
            // rather than a string for some values. Both are load-bearing here:
            // this helper only ever runs while building a warning, so a throw
            // from it would escape as a throw from `resolveClipPosition`.
            return JSON.stringify(position) ?? '[unserializable]';
        } catch {
            return '[unserializable]';
        }
    }
    if (typeof position === 'function' || typeof position === 'symbol') {
        // Neither stringifies usefully: a function renders its whole source.
        return `[${typeof position}]`;
    }
    return String(position);
}
