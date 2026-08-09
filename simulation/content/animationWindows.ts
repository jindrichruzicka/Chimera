// simulation/content/animationWindows.ts
// Animation System → content-load window verification. Feature F82,
// docs/roadmap-sections/m10-first-public-release-v1.0.0.md.
//
// `compileAnimationWindows` reconciles the two halves of a beat-owned gameplay
// window. A game authors the span TWICE: once as clip-relative positions
// (`AnimationPassage.from`/`to`, what the renderer plays) and once as beat
// integers (`AnimationPassage.beatWindow`, what the simulation opens). This
// function RECOMPUTES the second from the first and compares them — it never
// derives one from the other. Deriving would make the length of a gameplay
// window a function of the host pacing knob `tickRateMs`: raising the tick rate
// would silently widen or narrow every hit window in the game.
//
// Rule WINDOW-OUTWARD-ROUNDING — a passage's beats are the beats it TOUCHES:
//   startBeat = floor(fromSeconds × 1000 / tickRateMs)
//   endBeat   = max(startBeat + 1, ceil(toSeconds × 1000 / tickRateMs))
// The `max` is the structural one-beat floor: at the default 20 Hz the finest
// expressible mechanical window is one beat, and a narrower authored span is
// floored at one rather than collapsing to the empty window `[n, n]`.
//
// Purity: the verifier reads its input and returns authored values by reference.
// It mutates nothing, reads no clock and dispatches nothing (Invariant #1).
//
// Zero-dependency leaf edge: imports only within simulation/.

import type {
    AnimationClipName,
    AnimationMarkName,
    AnimationTrackSheet,
    AnimationWindowName,
    ClipPosition,
} from '../foundation/animation-clip-sheet.js';
import { dilatedBeatPeriodMs } from '../foundation/time-scale.js';

/**
 * Tolerance, in beats, for snapping a beat quotient onto an integer before
 * rounding it outward.
 *
 * Resolving a phase or a frame multiplies two floats — `frame / frameCount ×
 * durationSeconds` — and lands a hair off an exact beat: frame 3 of 8 over a
 * 0.4 s clip is 0.15000000000000002 s, i.e. 3.0000000000000004 beats, which a
 * bare `Math.ceil` reports as beat 4. The snap keeps a boundary on its boundary
 * while leaving any genuinely sub-beat remainder to round outward.
 */
const BEAT_EPSILON = 1e-9;

/**
 * Thrown when a passage's authored `beatWindow` disagrees with the window its
 * `from`/`to` positions imply under Rule WINDOW-OUTWARD-ROUNDING.
 *
 * Carries both tuples so the message names the fix rather than only the fault.
 */
export class AnimationWindowMismatchError extends Error {
    /** The clip the passage belongs to. */
    public readonly clipName: AnimationClipName;
    /** The passage's own name — its key in the clip's `passages` record. */
    public readonly passageName: AnimationMarkName;
    /** The `[startBeat, endBeat]` the game authored. */
    public readonly authored: readonly [number, number];
    /** The `[startBeat, endBeat]` the passage's positions imply. */
    public readonly expected: readonly [number, number];

    constructor(
        clipName: AnimationClipName,
        passageName: AnimationMarkName,
        authored: readonly [number, number],
        expected: readonly [number, number],
    ) {
        super(
            `Animation passage '${passageName}' of clip '${clipName}' authors beatWindow ` +
                `[${authored[0]}, ${authored[1]}] but its span implies ` +
                `[${expected[0]}, ${expected[1]}]`,
        );
        this.name = 'AnimationWindowMismatchError';
        this.clipName = clipName;
        this.passageName = passageName;
        this.authored = authored;
        this.expected = expected;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** A verified gameplay window, ready for the simulation to open. */
export interface CompiledAnimationWindow {
    /** The passage's own name — its key in the clip's `passages` record. */
    readonly passageName: AnimationMarkName;
    /** The gameplay window id the passage claims, when it declares one. */
    readonly window?: AnimationWindowName;
    /** The AUTHORED `[startBeat, endBeat]`, returned verbatim once verified. */
    readonly beatWindow: readonly [number, number];
}

/**
 * Verify every windowed passage of one clip and return the authored windows.
 *
 * Passages are visited in the clip's own `passages` key order, and a passage
 * that authors no `beatWindow` is presentation-only and contributes nothing.
 *
 * @param sheet       The clip sheet carried in `AssetManifestEntry.metadata`.
 *                    Declared structurally so both `ModelAnimationMetadata` and
 *                    `SpriteAnimationMetadata` pass: window verification reads
 *                    only the shared track-sheet fields, and a two-member union
 *                    would report a sprite mismatch for every malformed mesh
 *                    sheet.
 * @param clipName    The clip to verify. A clip the sheet does not declare
 *                    yields an empty list.
 * @param tickRateMs  The game's undilated beat period in milliseconds.
 * @throws RangeError                     when `tickRateMs` is not a finite
 *                                        positive number, when an
 *                                        authored bound that is not a
 *                                        non-negative integer,
 *                                        or a position the clip cannot resolve.
 * @throws AnimationWindowMismatchError   when an authored window disagrees with
 *                                        the one its span implies.
 */
export function compileAnimationWindows(
    sheet: { readonly clips?: Readonly<Record<AnimationClipName, AnimationTrackSheet>> },
    clipName: AnimationClipName,
    tickRateMs: number,
): readonly CompiledAnimationWindow[] {
    assertPositiveTickRate(tickRateMs);

    const track = sheet.clips?.[clipName];
    if (track === undefined) return [];

    const compiled: CompiledAnimationWindow[] = [];
    for (const [passageName, passage] of Object.entries(track.passages ?? {})) {
        const authored = passage.beatWindow;
        if (authored === undefined) continue;

        assertAuthoredBound(authored[0], clipName, passageName, 'startBeat');
        assertAuthoredBound(authored[1], clipName, passageName, 'endBeat');

        const fromBeats = beatsAt(
            resolveSeconds(passage.from, track, clipName, passageName, 'from'),
            tickRateMs,
        );
        const toBeats = beatsAt(
            resolveSeconds(passage.to, track, clipName, passageName, 'to'),
            tickRateMs,
        );

        const startBeat = Math.floor(fromBeats + BEAT_EPSILON);
        const endBeat = Math.max(startBeat + 1, Math.ceil(toBeats - BEAT_EPSILON));

        if (authored[0] !== startBeat || authored[1] !== endBeat) {
            throw new AnimationWindowMismatchError(clipName, passageName, authored, [
                startBeat,
                endBeat,
            ]);
        }

        compiled.push(
            passage.window === undefined
                ? { passageName, beatWindow: authored }
                : { passageName, window: passage.window, beatWindow: authored },
        );
    }
    return compiled;
}

/**
 * How many beats a real-time span occupies at a given time scale.
 *
 * Derived from the one shared {@link dilatedBeatPeriodMs} rather than
 * re-deriving the division. The scales at which
 * `beatsForRealSeconds(rs, t, p) × dilatedBeatPeriodMs(t, p)` is asserted to be
 * exactly `rs × 1000` are measured in `animationWindows.test.ts`.
 *
 * @param realSeconds     The wall-clock span.
 * @param tickRateMs      The game's undilated beat period in milliseconds.
 * @param scalePermille   The time scale, or `undefined` for real time.
 * @throws RangeError     when `tickRateMs` is not a finite positive number.
 */
export function beatsForRealSeconds(
    realSeconds: number,
    tickRateMs: number,
    scalePermille?: number,
): number {
    assertPositiveTickRate(tickRateMs);
    return (realSeconds * 1000) / dilatedBeatPeriodMs(tickRateMs, scalePermille);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function assertPositiveTickRate(tickRateMs: number): void {
    if (!Number.isFinite(tickRateMs) || tickRateMs <= 0) {
        throw new RangeError(`tickRateMs must be a finite positive number, received ${tickRateMs}`);
    }
}

function assertAuthoredBound(
    bound: number,
    clipName: AnimationClipName,
    passageName: AnimationMarkName,
    label: string,
): void {
    if (!Number.isSafeInteger(bound) || bound < 0) {
        throw new RangeError(
            `Animation passage '${passageName}' of clip '${clipName}' authors a ${label} of ` +
                `${bound}; beatWindow bounds are non-negative integers`,
        );
    }
}

/** Beats — fractional — that an offset from the clip start corresponds to. */
function beatsAt(seconds: number, tickRateMs: number): number {
    return (seconds * 1000) / tickRateMs;
}

/**
 * Resolve an authored {@link ClipPosition} to seconds from the clip start.
 *
 * Total and THROWING, unlike the renderer's fail-soft playback resolver: a
 * window this verifier cannot check is a window the simulation would open on
 * unverified integers, so an unresolvable position fails content load rather
 * than degrading.
 */
function resolveSeconds(
    position: ClipPosition,
    track: AnimationTrackSheet,
    clipName: AnimationClipName,
    passageName: AnimationMarkName,
    label: string,
): number {
    // In each branch below, the `=== undefined` conjunct on a sheet field is a
    // TYPE-NARROWING conjunct rather than a second runtime rule — `Number`'s
    // predicates already reject `undefined` — so the arithmetic sees a `number`.
    if (typeof position === 'number') {
        if (!Number.isFinite(position) || position < 0) {
            throw unresolvable(clipName, passageName, label, `phase ${position} is not finite ≥ 0`);
        }
        const duration = track.durationSeconds;
        if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
            throw unresolvable(
                clipName,
                passageName,
                label,
                'a normalized phase needs the clip to declare a positive durationSeconds',
            );
        }
        return position * duration;
    }

    if ('seconds' in position) {
        if (!Number.isFinite(position.seconds) || position.seconds < 0) {
            throw unresolvable(
                clipName,
                passageName,
                label,
                `${position.seconds} seconds is not finite ≥ 0`,
            );
        }
        return position.seconds;
    }

    if (!Number.isSafeInteger(position.frame) || position.frame < 0) {
        throw unresolvable(
            clipName,
            passageName,
            label,
            `frame ${position.frame} is not a non-negative integer`,
        );
    }
    const frameCount = track.frameCount;
    if (frameCount === undefined || !Number.isSafeInteger(frameCount) || frameCount <= 0) {
        throw unresolvable(
            clipName,
            passageName,
            label,
            'a frame position needs the clip to declare a positive integer frameCount',
        );
    }
    const duration = track.durationSeconds;
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
        throw unresolvable(
            clipName,
            passageName,
            label,
            'a frame position needs the clip to declare a positive durationSeconds',
        );
    }
    return (position.frame / frameCount) * duration;
}

function unresolvable(
    clipName: AnimationClipName,
    passageName: AnimationMarkName,
    label: string,
    reason: string,
): RangeError {
    return new RangeError(
        `Animation passage '${passageName}' of clip '${clipName}' cannot resolve its ` +
            `'${label}' position: ${reason}`,
    );
}
