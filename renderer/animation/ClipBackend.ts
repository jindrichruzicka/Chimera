/**
 * renderer/animation/ClipBackend.ts
 *
 * The seam between the animation layer and whatever actually moves pixels: a
 * three.js `AnimationMixer` driving a skinned mesh, or a sprite atlas stepping
 * through frame indices. Interfaces, one narrowing guard, and the argument
 * refusals the seam owns rather than each backend — no playback machinery lives
 * here, which is what lets the compile half stay three.js-free.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Two shapes in here are deliberate and worth stating once.
 *
 * **`advance` is on the BACKEND, not on the playback.** One
 * `AnimationMixer.update(delta)` advances every action that mixer owns; there is
 * no per-action step. A `ClipPlayback.advance` would therefore have to either
 * step every sibling playback too or throw — a method whose contract the mesh
 * implementation cannot honour, which is the LSP violation this interface exists
 * to not have. Per-clip pacing is expressed as speed instead, which composes.
 *
 * **Blending is a separate interface.** A mesh mixer crossfades between actions;
 * a sprite atlas has nothing to interpolate. Putting `crossfadeTo` on the base
 * interface would force the sprite backend to ship a method that throws, so it is
 * an extension a caller narrows to via {@link supportsBlending}.
 */

import type {
    AnimationClipName,
    AnimationLoopMode,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

/**
 * Where a clip's playhead is, sampled once per frame. The scheduler's only input:
 * it derives every `notify` / `passage-*` / `clip-end` emission from the movement
 * between two consecutive samples.
 */
export interface PlayheadSample {
    /**
     * Normalized position in the clip, on the same scale as a compiled mark's
     * phase — `compileClipTimeline` clamps into `[0, 1]` inclusive, so a mark
     * authored past the end sits exactly at 1 and a sampler that could never
     * report 1 would never fire it.
     */
    readonly phase: number;
    /**
     * How many times the clip has wrapped since it started. Distinguishes a loop
     * from a seek.
     *
     * Counts CYCLE BOUNDARIES CROSSED, and is never incremented by `ended`
     * latching: a `'once'` clip cannot wrap, so its `cycle` stays 0 however far
     * past its end it is advanced. A step worth several cycles counts several,
     * and a step of exactly one clip length counts one even though it lands back
     * on the phase it started from — the seated scheduler reads a loop out of
     * this number, and a wrap it never heard about is a whole clip of marks
     * silently dropped.
     */
    readonly cycle: number;
    /** True once a `'once'` clip has reached its end and stopped advancing. */
    readonly ended: boolean;
}

/** How a clip starts. Both fields default to whatever the backend's clip declares. */
export interface ClipPlayOptions {
    /** Overrides the sheet's authored loop mode. */
    readonly loop?: AnimationLoopMode;
    /**
     * The initial speed multiplier. Present so a clip that starts dilated does not
     * play its first frame at full speed and get corrected on the next one.
     */
    readonly speed?: number;
}

/** One clip in flight on a backend. */
export interface ClipPlayback {
    /** Which clip this playback drives; a backend may hold several at once. */
    readonly clipName: AnimationClipName;
    /** The playhead right now. Pure — sampling never advances anything. */
    sample(): PlayheadSample;
    /**
     * Re-target the speed multiplier. Per-playback rather than folded into the
     * backend's `advance` delta: the multiplicative speed stack resolves to one
     * number per clip, and applying it to the shared delta would re-pace every
     * other clip on the same mixer with it.
     */
    setSpeed(speed: number): void;
    /** Release this playback. Idempotent. */
    stop(): void;
    /**
     * End this playback while leaving what it poses on screen.
     *
     * Terminal exactly as {@link ClipPlayback.stop} is — the playhead freezes,
     * the sample latches `ended`, and nothing re-targets it — but the pose stays:
     * a mesh action keeps its last frame under `clampWhenFinished`, a sprite quad
     * keeps its last cell. It exists because a `'once'` clip that reaches its end
     * should stay on that last frame rather than flash the model's original state
     * on the same tick its `clip-end` handler runs.
     *
     * What it does NOT do is release the resources the pose is made of, so a held
     * playback is still the backend's to release: by the next `play` or
     * `crossfadeTo` of the same clip, by `stop()`, or by `dispose()`. Idempotent,
     * and a no-op once the playback is terminal by any route.
     */
    hold(): void;
}

/** A source of clips that can be played and advanced. */
export interface ClipBackend {
    /**
     * The clip's real, loaded length, or `null` if the backend has no such clip.
     * This is the third argument `compileClipTimeline` range-checks against.
     */
    getDurationSeconds(clipName: AnimationClipName): number | null;
    /** Start a clip. `null` when the backend has no such clip, or was disposed. */
    play(clipName: AnimationClipName, options?: ClipPlayOptions): ClipPlayback | null;
    /** Advance every playback this backend owns by `deltaSeconds`. */
    advance(deltaSeconds: number): void;
    /** Release everything the backend owns. Idempotent. */
    dispose(): void;
}

/** A backend that can blend between clips rather than cutting between them. */
export interface SupportsClipBlending extends ClipBackend {
    /**
     * Start `clipName` while fading the current playback out across `fadeSeconds`.
     * `null` on an absent clip, like {@link ClipBackend.play}.
     *
     * A `fadeSeconds` of 0 is a CUT, not a degenerate fade: the incoming clip
     * starts at full weight and the outgoing one is released the way
     * {@link ClipPlayback.stop} releases it. An unusable length is refused with a
     * `RangeError` — see {@link checkedFade} — before the absent-clip guard, so
     * the fail-soft `null` never swallows a caller's sign error.
     */
    crossfadeTo(
        clipName: AnimationClipName,
        fadeSeconds: number,
        options?: ClipPlayOptions,
    ): ClipPlayback | null;
}

/**
 * Whether `backend` can blend. Tests that `crossfadeTo` is CALLABLE rather than
 * merely present: a backend carrying `crossfadeTo: undefined` — which a spread
 * over an optional field produces — would pass an `in` check and then throw at
 * the call site.
 */
export function supportsBlending(backend: ClipBackend): backend is SupportsClipBlending {
    return typeof (backend as Partial<SupportsClipBlending>).crossfadeTo === 'function';
}

/**
 * Rule SPEED-NON-NEGATIVE: `value` if it is a usable multiplier, or a
 * `RangeError`.
 *
 * A negative multiplier is REFUSED rather than clamped. Reverse playback would
 * invert the phase-increase a wrap is read out of, so a sign error must fail
 * where it is written rather than corrupt every mark boundary downstream. It
 * never clamps upwards either — the one ceiling lives on the PRODUCT of the
 * speed stack, and a second one per layer would be invisible behind it.
 *
 * It lives on the seam rather than in each implementation because the shared
 * conformance suite asserts the refusal for the backends it runs against: two
 * copies of the predicate could drift into two different contracts, both green.
 *
 * @param label  Names the layer in the message — a caller with three of them
 *               needs to know which one it wrote.
 */
export function checkedPlaybackSpeed(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(
            `${label} must be a finite number of at least 0, received ${value}; reverse playback is not supported`,
        );
    }
    return value;
}

/**
 * `value` if it is a usable fade length, or a `RangeError`.
 *
 * 0 is ACCEPTED and means a cut, not a fade of no length — see
 * `MeshClipBackend.crossfadeTo` for why a zero fade must not reach the mixer.
 * Negative and non-finite are refused rather than clamped, for the reason
 * {@link checkedPlaybackSpeed} refuses a negative multiplier: a duration is
 * written by a caller, and a sign error must fail where it was written.
 *
 * It lives on the seam rather than inside a backend so that a caller checking a
 * fade length reaches for this rather than writing a second copy: two copies of
 * the predicate could drift into two different contracts, both green.
 */
export function checkedFade(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(
            `crossfade length must be a finite number of at least 0, received ${value}`,
        );
    }
    return value;
}

/**
 * `mode` if it is a loop mode a backend can honour, or a `RangeError`.
 *
 * {@link AnimationLoopMode} spells `'once'` and `'loop'` and nothing else, so
 * this only fires on unsound data — and falling through to a default there would
 * silently decide whether a clip ever ends. {@link PlayheadSample} counts cycles
 * and never signs them, so ping-pong is the mode that must stay unreachable.
 */
export function checkedLoopMode(mode: AnimationLoopMode): AnimationLoopMode {
    if (mode !== 'once' && mode !== 'loop') {
        throw new RangeError(
            `animation loop mode must be 'once' or 'loop', received ${String(mode)}; ping-pong playback is not supported`,
        );
    }
    return mode;
}
