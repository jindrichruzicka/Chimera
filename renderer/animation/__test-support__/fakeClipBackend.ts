/**
 * renderer/animation/__test-support__/fakeClipBackend.ts
 *
 * A {@link ClipBackend} that is a deterministic integrating clock and nothing
 * else: no three.js, no `AnimationMixer`, no jsdom, no Canvas. It exists so the
 * marker scheduler and `ClipPlayer` can be driven with exact deltas and
 * inspected sample by sample.
 *
 * It models the one property that makes the seam interesting — a single
 * {@link ClipBackend.advance} moves EVERY playback the backend owns, each by the
 * delta scaled by its OWN speed — plus enough bookkeeping for a test to see what
 * the player did: the deltas it advanced with, the speeds it set, and the
 * playbacks it stopped.
 *
 * Feature reference: F82 — Animation System,
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 */

import type { AnimationLoopMode } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';
import type { AnimationClipName } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import type { ClipBackend, ClipPlayOptions, ClipPlayback, PlayheadSample } from '../ClipBackend.js';

/** One clip this backend knows how to play. */
export interface FakeClipSpec {
    /** The clip's real, loaded length. What `getDurationSeconds` answers. */
    readonly durationSeconds: number;
    /** The clip's own loop mode, used when a `play` call names none. */
    readonly loop?: AnimationLoopMode;
    /**
     * The phase a `'once'` clip stops and latches `ended` at. Defaults to 1, which
     * is where a mesh mixer's finished action clamps. A sprite backend stops on
     * the START of its last cell instead, so a `'once'` clip can genuinely end
     * BELOW phase 1 — and a passage authored to run to the clip end is then still
     * open when it does.
     */
    readonly endsAtPhase?: number;
}

/** The {@link ClipBackend} contract plus the handles a test reads. */
export interface FakeClipBackend extends ClipBackend {
    /** Every delta `advance` was called with, in call order. */
    readonly advanceCalls: readonly number[];
    /** Clip names `dispose` or a playback's `stop` released, in call order. */
    readonly stopped: readonly AnimationClipName[];
    /** How many times `dispose` was called — not whether it ever was. */
    readonly disposeCalls: number;
    /** The speed last set on this clip's live playback, or `null` when none is live. */
    speedOf(clipName: AnimationClipName): number | null;
    /** This clip's live playhead, or `null` when none is live. */
    sampleOf(clipName: AnimationClipName): PlayheadSample | null;
    /** Move a live playhead without advancing, as a crossfade or a seek would. */
    jumpTo(clipName: AnimationClipName, sample: PlayheadSample): void;
}

interface LivePlayback {
    readonly clipName: AnimationClipName;
    readonly durationSeconds: number;
    /** Seconds into the clip at which a `'once'` playback stops. */
    readonly endsAtSeconds: number;
    loop: AnimationLoopMode;
    /** Seconds into the CURRENT cycle. */
    elapsedSeconds: number;
    cycle: number;
    ended: boolean;
    speed: number;
}

/**
 * A backend over `clips`, with nothing playing.
 *
 * @param clips  Clip name → its spec. A name absent from the record is a clip
 *               the backend does not have, which `getDurationSeconds` and `play`
 *               both answer `null` for.
 */
export function createFakeClipBackend(
    clips: Readonly<Record<AnimationClipName, FakeClipSpec>>,
): FakeClipBackend {
    const live = new Set<LivePlayback>();
    const advanceCalls: number[] = [];
    const stopped: AnimationClipName[] = [];
    let disposeCalls = 0;

    /** The most recently started live playback for `clipName`. */
    function latest(clipName: AnimationClipName): LivePlayback | null {
        let found: LivePlayback | null = null;
        for (const playback of live) {
            if (playback.clipName === clipName) {
                found = playback;
            }
        }
        return found;
    }

    function sampleOfPlayback(playback: LivePlayback): PlayheadSample {
        return {
            phase: playback.elapsedSeconds / playback.durationSeconds,
            cycle: playback.cycle,
            ended: playback.ended,
        };
    }

    function release(playback: LivePlayback): void {
        if (!live.delete(playback)) {
            return;
        }
        stopped.push(playback.clipName);
    }

    const backend: FakeClipBackend = {
        get advanceCalls() {
            return [...advanceCalls];
        },
        get stopped() {
            return [...stopped];
        },
        get disposeCalls() {
            return disposeCalls;
        },

        getDurationSeconds(clipName) {
            return clips[clipName]?.durationSeconds ?? null;
        },

        play(clipName, options?: ClipPlayOptions) {
            const spec = clips[clipName];
            if (spec === undefined) {
                return null;
            }
            const playback: LivePlayback = {
                clipName,
                durationSeconds: spec.durationSeconds,
                endsAtSeconds: spec.durationSeconds * (spec.endsAtPhase ?? 1),
                loop: options?.loop ?? spec.loop ?? 'once',
                elapsedSeconds: 0,
                cycle: 0,
                ended: false,
                speed: options?.speed ?? 1,
            };
            live.add(playback);

            const handle: ClipPlayback = {
                clipName,
                sample: () => sampleOfPlayback(playback),
                setSpeed: (speed) => {
                    playback.speed = speed;
                },
                stop: () => {
                    release(playback);
                },
            };
            return handle;
        },

        advance(deltaSeconds) {
            advanceCalls.push(deltaSeconds);
            for (const playback of live) {
                // No skip for an already-ended playback: a `'once'` clip that has
                // ended is clamped at `endsAtSeconds`, and advancing it again
                // re-clamps it to the same place.
                const moved = playback.elapsedSeconds + deltaSeconds * playback.speed;
                if (playback.loop === 'once') {
                    if (moved >= playback.endsAtSeconds) {
                        playback.elapsedSeconds = playback.endsAtSeconds;
                        playback.ended = true;
                    } else {
                        playback.elapsedSeconds = moved;
                    }
                    continue;
                }
                // Arithmetic rather than a subtract-until loop, so a delta worth
                // a thousand cycles costs the same as one worth a tenth.
                const cycles = Math.floor(moved / playback.durationSeconds);
                playback.cycle += cycles;
                playback.elapsedSeconds = moved - cycles * playback.durationSeconds;
            }
        },

        dispose() {
            disposeCalls += 1;
            for (const playback of [...live]) {
                release(playback);
            }
        },

        speedOf(clipName) {
            return latest(clipName)?.speed ?? null;
        },

        sampleOf(clipName) {
            const playback = latest(clipName);
            return playback === null ? null : sampleOfPlayback(playback);
        },

        jumpTo(clipName, sample) {
            const playback = latest(clipName);
            if (playback === null) {
                return;
            }
            playback.elapsedSeconds = sample.phase * playback.durationSeconds;
            playback.cycle = sample.cycle;
            playback.ended = sample.ended;
        },
    };

    return backend;
}
