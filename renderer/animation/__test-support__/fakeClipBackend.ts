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

import { checkedFade } from '../ClipBackend.js';
import type {
    ClipBackend,
    ClipPlayOptions,
    ClipPlayback,
    PlayheadSample,
    SupportsClipBlending,
} from '../ClipBackend.js';

/** One clip this backend knows how to play. */
export interface FakeClipSpec {
    /** The clip's real, loaded length. What `getDurationSeconds` answers. */
    readonly durationSeconds: number;
    /** The clip's own loop mode, used when a `play` call names none. */
    readonly loop?: AnimationLoopMode;
    /**
     * The phase a `'once'` clip stops and latches `ended` at. Defaults to 1, which
     * is where a mesh mixer's finished action clamps and where the sprite backend
     * clamps its own integrator. A backend that stopped BELOW phase 1 would leave
     * a passage authored to run to the clip end still open when it ended, which is
     * the scheduler's forced-unwind case; this knob is how that case is reached.
     */
    readonly endsAtPhase?: number;
}

/** The {@link ClipBackend} contract plus the handles a test reads. */
export interface FakeClipBackend extends ClipBackend {
    /** Every delta `advance` was called with, in call order. */
    readonly advanceCalls: readonly number[];
    /** Clip names `dispose` or a playback's `stop` released, in call order. */
    readonly stopped: readonly AnimationClipName[];
    /**
     * Clip names a playback's `hold` ended, in call order. Separate from
     * {@link FakeClipBackend.stopped} so an assertion naming one verb cannot pass
     * because the other was called.
     */
    readonly held: readonly AnimationClipName[];
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
    /** The playbacks a `hold` ended: no longer integrating, not yet released. */
    const holding = new Set<LivePlayback>();
    const advanceCalls: number[] = [];
    const stopped: AnimationClipName[] = [];
    const held: AnimationClipName[] = [];
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

    /**
     * End `playback` while leaving what it poses. It stops integrating and its
     * sample stays answerable, but it is still the backend's to release — which
     * is why it moves into `holding` rather than being forgotten.
     */
    function hold(playback: LivePlayback): void {
        if (!live.delete(playback)) {
            return;
        }
        holding.add(playback);
        held.push(playback.clipName);
    }

    /**
     * Release `playback`, whether it was live or holding. A stop AFTER a hold is
     * real work on the backends this doubles — it is what hands a mesh action's
     * binding back — so it is ledgered rather than swallowed as a repeat.
     */
    function stop(playback: LivePlayback): void {
        const wasLive = live.delete(playback);
        const wasHolding = holding.delete(playback);
        if (!wasLive && !wasHolding) {
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
        get held() {
            return [...held];
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
                    stop(playback);
                },
                hold: () => {
                    hold(playback);
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
            for (const playback of [...live, ...holding]) {
                stop(playback);
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

/** One `crossfadeTo` a test can read back. */
export interface CrossfadeCall {
    readonly clipName: AnimationClipName;
    /** The fade length, after {@link checkedFade} accepted it. */
    readonly fadeSeconds: number;
    readonly options: ClipPlayOptions | undefined;
}

/** A {@link FakeClipBackend} that also blends, plus the ledger of what it was asked. */
export interface BlendingFakeClipBackend extends FakeClipBackend, SupportsClipBlending {
    /** Every crossfade this backend accepted, in call order. */
    readonly crossfadeCalls: readonly CrossfadeCall[];
}

/**
 * A blending fake over `clips`, with nothing playing.
 *
 * What it models of {@link SupportsClipBlending} is what the cases in
 * `ClipBackend.test.ts` › `the blending fake` measure. What the weights do
 * during a blend is a mesh concern and is not modelled here — a fake that
 * pretended to interpolate would be asserting three's arithmetic with none of
 * three's code.
 *
 * {@link createFakeClipBackend} deliberately stays non-blending. It is the
 * negative control that keeps `supportsBlending`'s conjunct killable: with only
 * a blending double in the repo, a guard that answered `true` unconditionally
 * would pass every test that uses one.
 */
export function createBlendingFakeClipBackend(
    clips: Readonly<Record<AnimationClipName, FakeClipSpec>>,
): BlendingFakeClipBackend {
    const base = createFakeClipBackend(clips);
    const crossfadeCalls: CrossfadeCall[] = [];
    /**
     * The handles a crossfade may have to release. A set rather than a map keyed
     * by clip name: {@link createFakeClipBackend} keeps two playbacks of one clip
     * live, and keying by name would leave the earlier one integrating.
     */
    const handles = new Set<ClipPlayback>();

    function start(clipName: AnimationClipName, options?: ClipPlayOptions): ClipPlayback | null {
        const playback = base.play(clipName, options);
        if (playback !== null) {
            handles.add(playback);
        }
        return playback;
    }

    // Delegated field by field rather than spread: the ledgers on the base are
    // getters, and a spread would freeze one snapshot of each into this object.
    return {
        get advanceCalls() {
            return base.advanceCalls;
        },
        get stopped() {
            return base.stopped;
        },
        get held() {
            return base.held;
        },
        get disposeCalls() {
            return base.disposeCalls;
        },
        get crossfadeCalls() {
            return [...crossfadeCalls];
        },

        getDurationSeconds: (clipName) => base.getDurationSeconds(clipName),
        play: (clipName, options) => start(clipName, options),
        advance: (deltaSeconds) => {
            base.advance(deltaSeconds);
        },
        dispose: () => {
            base.dispose();
            handles.clear();
        },
        speedOf: (clipName) => base.speedOf(clipName),
        sampleOf: (clipName) => base.sampleOf(clipName),
        jumpTo: (clipName, sample) => {
            base.jumpTo(clipName, sample);
        },

        crossfadeTo(clipName, fadeSeconds, options) {
            // Refused before the absent-clip guard and before anything starts,
            // through the seam's own predicate rather than a copy of it.
            const fadeLength = checkedFade(fadeSeconds);
            const incoming = start(clipName, options);
            if (incoming === null) {
                return null;
            }
            crossfadeCalls.push({ clipName, fadeSeconds: fadeLength, options });
            for (const handle of [...handles]) {
                if (handle.clipName === clipName) {
                    continue;
                }
                handle.stop();
                handles.delete(handle);
            }
            return incoming;
        },
    };
}
