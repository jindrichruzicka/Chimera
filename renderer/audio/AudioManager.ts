import type { AudioClipMetadata } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../assets/AssetManager';
import { AudioBus, type AudioBusId, type AudioBusOptions } from './AudioBus';
import { parseAudioCueSheet, resolveCue, resolveCueWindow } from './audioCueSheet';
import type {
    CrossfadeOptions,
    Cue,
    CueAlignedCrossfadeOptions,
    CueAlignedFadeOutSpec,
    FadeCurve,
    FadeInSpec,
    FadeOutSpec,
    FadeToSpec,
    LoopRegion,
} from './Cue';

import {
    resolveListenerPose,
    resolveSpatialSpec,
    type AudioListenerPose,
    type AudioPosition,
    type ResolvedListenerPose,
    type ResolvedSpatialSpec,
    type SetListenerOptions,
    type SetVoicePositionOptions,
    type SpatialOptions,
} from './Spatial';

import { compileCueSheet, type CueHandlers } from './cueMarkerScheduler.js';
import {
    browserFrameSource,
    CueSampler,
    type FrameSource,
    type VoiceCueReading,
} from './cueSampler.js';
import {
    nextCueContextTime,
    voicePlayheadSeconds,
    type LoopWindowSeconds,
} from './voicePlayhead.js';

export type { AudioBusId } from './AudioBus';

export interface PlayOptions {
    readonly bus?: AudioBusId;
    readonly loop?: boolean;
    readonly volume?: number;
    /**
     * Play the voice positionally, through a `PannerNode` between its stage-1 gain and
     * the bus. Statically validated inside `play()`: distances need no decode, so an
     * already-invalid spec is rejected synchronously — an invalid handle and one
     * warning, before any voice is reserved (Invariant #117). See {@link SpatialOptions}
     * for what rejects.
     */
    readonly spatial?: SpatialOptions;
    /**
     * Rank against the other voices when the pool is saturated: any voice already fading
     * out is reclaimed first, then the lowest priority among the rest, and no class of
     * voice is exempt ({@link voiceHasLowerPreemptionRank}, Invariant #123). Unbounded
     * and defaulted to `0`; music should name {@link MUSIC_PRIORITY}.
     */
    readonly priority?: number;
    /** Play-from-cue; resolves to `start()`'s offset argument. Defaults to `'start'` (0). */
    readonly from?: Cue;
    /**
     * Play-to-cue. On a non-looping voice this bounds a buffer window; on a looping
     * voice it bounds TOTAL ELAPSED PLAY DURATION, not a position within the buffer.
     *
     * Either way `to` resolves as a position on the buffer timeline and is clamped to
     * `[0, duration]` first, so the longest bound it can express is `duration − from`,
     * i.e. at most one pass of the clip. A looping voice cannot be asked to play for
     * longer than its own buffer this way; an over-long `to` clamps silently.
     */
    readonly to?: Cue;
    /** Loop bounds; setting this IMPLIES `loop = true` (Invariant #117). */
    readonly loopRegion?: LoopRegion;
    /**
     * Start-time fade from the curve floor up to `volume`. The ramp is laid down at the
     * voice's REAL start `t0`, which `play()` returns long before — so this is parked on
     * the voice and applied by `startVoice` (Invariant #121). Its end clamps to any
     * scheduled end, truncating rather than steepening: see {@link resolveFadeInRamp}.
     */
    readonly fadeIn?: FadeInSpec;
}

export interface AudioHandle {
    readonly id: string;
    readonly ref: AssetRef<AudioClipAsset>;
    readonly bus: AudioBusId;
    readonly priority: number;
    readonly valid: boolean;
}

export interface AudioManager {
    play(ref: AssetRef<AudioClipAsset>, opts?: PlayOptions): AudioHandle;
    /**
     * Stop a voice at once.
     *
     * Like {@link AudioManager.fadeOut} and {@link AudioManager.fadeTo}, a no-op on an
     * invalid or already-released handle: voice ids are minted monotonically, so a
     * stale handle can never name a live record.
     */
    stop(handle: AudioHandle): void;
    /** Ramp to silence, then stop — `{ overMs }`, `{ toCue }` or `{ toEnd: true }`. */
    fadeOut(handle: AudioHandle, spec: FadeOutSpec): void;
    /** Ramp to an absolute gain and hold there — a dip or a swell, never a release. */
    fadeTo(handle: AudioHandle, spec: FadeToSpec): void;
    /**
     * Start `incoming` and link a fade-out of `outgoing` to the incoming voice's real
     * start; returns the incoming handle. That handle names a voice still LOADING, and one
     * that never plays at all if the play is rejected or the decode fails — see
     * {@link DefaultAudioManager.crossfade} for what each of those leaves audible.
     */
    crossfade(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CrossfadeOptions,
    ): AudioHandle;
    /**
     * Arm a crossfade now and execute it at the outgoing voice's next arrival at
     * `opts.atCue`, sample-accurately: the incoming clip loads immediately and its
     * `source.start` is scheduled for the cue, with both ramps anchored there.
     *
     * Returns the incoming handle, which names a voice that is loading AND scheduled —
     * `valid` is the whole report, and `play` owns the diagnosis of why it declined. See
     * {@link DefaultAudioManager.crossfadeAtCue} for what each fail-soft branch leaves
     * audible.
     */
    crossfadeAtCue(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CueAlignedCrossfadeOptions,
    ): AudioHandle;
    /**
     * Hold a fade-out until this voice's next arrival at `spec.atCue`, then run the
     * authored {@link FadeOutSpec} from there — a fade that STARTS at a cue, where
     * `fadeOut({ toCue })` is one that ENDS at one.
     */
    fadeOutAtCue(handle: AudioHandle, spec: CueAlignedFadeOutSpec): void;
    /**
     * How many seconds until this voice's playhead next reaches `cue`, or `null` when
     * nothing in the voice's schedule brings it there.
     *
     * The read direction of the cue timeline. It resolves the cue exactly as
     * `fadeOut({ toCue })` does and names the same arrival, so a countdown agrees with
     * the transition it is counting down to. The two part company in one place: a voice
     * whose scheduled end comes first. The fade has to fade something, so it clamps its
     * ramp to that end; a query is asked whether the cue is coming, and answers that it
     * is not. RELATIVE by design: a game holds no `AudioContext.currentTime` semantics,
     * and "how long from now" is what a HUD countdown or an "arm the transition yet?"
     * check reads.
     *
     * `null`, never `0` and never negative: an invalid handle, a voice still loading or
     * scheduled to start later, one whose playhead has run off the end, a cue outside
     * the loop window or already passed, and one the voice's own scheduled end arrives
     * before. Silent throughout, unlike the fade — a query changes nothing audible, and
     * one that logged would spam a per-frame caller.
     */
    secondsUntilCue(handle: AudioHandle, cue: Cue): number | null;
    /**
     * Observe this voice's `cue` / `loop` / `end` emissions until the returned
     * unsubscribe is called; a no-op unsubscribe on an invalid or released handle.
     *
     * Frame-sampled, so an emission carries at most one frame of jitter — observation
     * is for reacting to a musical moment (a HUD beat, a flourish, a decision), not for
     * landing one. Anything that must be sample-accurate is scheduled instead, because
     * a callback that fires a frame late and then starts a crossfade puts the
     * transition a frame off the beat.
     *
     * The unsubscribe is the return value rather than a paired `stopObserving(handle)`
     * verb: it makes a React binding a one-line effect, and it leaves no way to name a
     * subscription that has already gone.
     *
     * A voice still LOADING may be observed — that is the order a binding made beside
     * `play()` sees it in — and its scheduler is seated when it starts, at the position
     * it enters the buffer at. Whatever ends the voice ends the observation with one
     * final `end`: a natural finish, `stop`, `stopAll`, preemption, or a load that never
     * produced a source. `dispose()` is the exception and cancels rather than ends.
     */
    observeCues(handle: AudioHandle, handlers: CueHandlers): () => void;
    stopAll(bus?: AudioBusId): void;
    duck(bus: AudioBusId, duckedVolume: number, durationMs: number): void;
    /**
     * Set the app's ONE listener pose — where the ears are (§4.25). The pose is the
     * game's to supply and the engine never derives it from a camera: what the player
     * listens FROM (the focused unit, the board centre, the cursor) is a different
     * concept from what a camera looks at from. There is exactly one listener per
     * app, shared by every canvas — an overlay canvas must not move it.
     *
     * Omitted `forward`/`up` write the Web Audio defaults (`-Z` / `+Y`), so a game
     * that sets nothing keeps exactly today's origin-relative panning. Updates ramp
     * over a short anti-zipper window; `{ immediate: true }` sets instead, for a
     * teleport or a camera cut where a ramp would smear the discontinuity into an
     * audible sweep. Fail-soft throughout: a feature-detected `AudioParam` path with
     * a `setPosition`/`setOrientation` fallback, a non-finite component degrading to
     * its default with one warning, and never a throw into the caller.
     */
    setListener(pose: AudioListenerPose, opts?: SetListenerOptions): void;
    /**
     * Move a spatial voice's source after it starts — the panner position is
     * otherwise written once, at the voice's real start (§4.25). Ramped over the
     * anti-zipper window by default; `{ immediate: true }` sets, for a teleport.
     *
     * Safe in every voice phase. A voice still loading has no panner yet, so the
     * position is parked on its record and applied at `t0` — one slot, a later call
     * superseding an earlier one, the same discipline the pending fades follow
     * (Invariant #121). An invalid or released handle is a silent no-op, exactly as
     * `stop`/`fadeOut`/`fadeTo` — voice ids are minted monotonically, so a stale
     * handle can never name a live record. A voice that was never spatial is a no-op
     * with one warning: a panner cannot be inserted into a running chain without a
     * reconnect, and silently promoting the voice would change its audible level
     * mid-play.
     */
    setVoicePosition(
        handle: AudioHandle,
        position: AudioPosition,
        opts?: SetVoicePositionOptions,
    ): void;
    dispose(): void;
}

export interface AudioManagerOptions {
    readonly audioContext?: AudioContext;
    readonly busOptions?: AudioBusOptions;
    readonly poolSize?: number;
    /**
     * The clock the cue sampler's frame chain runs on. Defaults to
     * `requestAnimationFrame`; injected the same way and for the same reason as
     * {@link audioContext}, so a test drives frames instead of waiting for them.
     */
    readonly frameSource?: FrameSource;
}

/**
 * Where a voice is in its lifecycle. `'loading'` spans `play()` returning to
 * `startVoice` running — a window of at least two microtask hops plus a load and a
 * decode, throughout which `source` and `gainNode` are both null and an op has nothing
 * to write to. `'fading-out'` is written by {@link DefaultAudioManager.fadeOut} and
 * spans its ramp: the voice stays in the pool, valid and re-targetable, until the
 * scheduled stop fires (§4.25, Invariant #119). Voice preemption reads this union twice,
 * splitting it differently each time (Invariant #123): its first term reclaims
 * `'fading-out'` ahead of the other two, while {@link voiceLoops} sets `'loading'` apart
 * from the other two, having no effective loop window to read there yet. So all three
 * phases are distinguished, and the same voice can rank as looping while it loads and as
 * a one-shot once it starts — a bare `loopRegion` that collapses is exactly that voice.
 * A voice given a FUTURE start is `'playing'` from `startVoice` onward, audible or not;
 * see {@link DefaultAudioManager.startVoice} for why no fourth phase marks that.
 *
 * @internal Exported only so tests reading the private `VoiceRecord` bind to this union
 * rather than hand-copying it — a copy would drift silently when a phase is added.
 */
export type VoicePhase = 'loading' | 'playing' | 'fading-out';

/**
 * All start-time / offset / schedule context for a voice. It lives here and never on
 * the public {@link AudioHandle}, whose shape stays frozen (Invariant #126).
 */
interface VoiceRecord {
    readonly handle: ManagedAudioHandle;
    /** The REQUESTED loop intent (`loopRegion` implies `true`). The EFFECTIVE flag is
     * resolved per-start, since a collapsed loop window may disable looping. */
    readonly loop: boolean;
    /**
     * Whether `loop: true` was authored in its own right, rather than implied by
     * `loopRegion`. The two are separate intents: a region that cannot be honoured
     * takes an IMPLIED loop down with it, but must not discard an explicit one.
     */
    readonly loopRequested: boolean;
    /** The resolved spatial spec, already validated by the static tier — or `null` for
     * an ordinary voice. Lives here and never on {@link AudioHandle} (Invariant #126). */
    readonly spatial: ResolvedSpatialSpec | null;
    /**
     * A move requested before `startVoice`, consumed at `t0` in place of the spec's
     * position — one slot with last-write-wins, the pending-fade discipline of
     * Invariant #121 extended to position. Always `null` on a non-spatial voice:
     * the verb refuses those before parking anything.
     */
    pendingPosition: AudioPosition | null;
    readonly sequence: number;
    /**
     * The voice's SETTLED ceiling: the gain a `fadeTo` last named as absolute, or
     * `PlayOptions.volume` if none has. It is what the voice's gain returns to being
     * bounded by once no ramp is in flight — NOT where every ramp lands, since a `fadeOut`
     * lands at `0` and never travels here at all.
     *
     * Rewritten only by {@link applyFadeToRamp} — so by the `fadeTo` verb on both its
     * paths, the live one and the pre-start intent applied at `t0`; every other verb reads
     * it. Not by itself the bound {@link rampDeparture} caps against — read
     * {@link voiceCeiling}, which covers the window in which any ramp is still travelling.
     */
    volume: number;
    /**
     * An upper bound on the gain that outranks {@link volume} until its `until`, or `null`
     * when the two agree. See {@link CeilingHold}.
     */
    ceilingHold: CeilingHold | null;
    /**
     * The gain the stage-1 param holds EXACTLY, or `null` while a ramp is travelling.
     *
     * An instant application lands its target with no ramp at all, so from that moment
     * until the next automation the value is known rather than estimated — and it has to
     * be recorded, because `param.value` reports the start of the current render quantum
     * and so cannot see a write made in this same turn. That gap is not the one-quantum
     * slope error {@link rampDeparture} tolerates: an instant raise moves the gain
     * arbitrarily far in zero time, and capping cannot repair a read that is too LOW.
     *
     * Written only by {@link scheduleVoiceRamp}, which is also the only thing that can
     * invalidate it — so it is exact for exactly as long as it is non-null.
     */
    settledGain: number | null;
    /** The clip's cue sheet, parsed once synchronously at `play()`. */
    readonly sheet: AudioClipMetadata | null;
    readonly from: Cue | null;
    readonly to: Cue | null;
    readonly loopRegion: LoopRegion | null;
    /**
     * A playhead anchor. With {@link startOffsetSeconds} it lets the fade verbs derive
     * a cue's wall-clock position from `AudioContext.currentTime` alone, with no timer.
     * The context time `source.start(when)` was scheduled for — `currentTime` at the
     * call for an ordinary play, a cue-aligned instant AHEAD of it for a scheduled one.
     */
    startedAtContextTime: number | null;
    /** `start()`'s offset argument — the POST-fold entry point into the buffer. */
    startOffsetSeconds: number;
    /**
     * The DECODED buffer's duration — the timeline `startVoice` actually scheduled
     * against, so a later fade resolves a `{ toCue }` against it rather than the
     * authoring sheet's `durationSeconds`, which may overstate the clip. `null` before
     * the voice starts.
     */
    bufferDurationSeconds: number | null;
    /**
     * The EFFECTIVE loop window as started — a whole-buffer loop records
     * `[0, duration]`, since `source.loopStart === loopEnd === 0` is the Web Audio
     * sentinel for it and carries no period. `null` when the voice does not loop.
     *
     * Neither the requested `loop` nor `loopRegion` can stand in for this: a window that
     * collapsed after clamping may disable looping — it does when the region was the
     * whole intent, and degrades to the whole buffer when `loop: true` was authored in
     * its own right — and a region resolves against the decoded duration. Its length is
     * the period {@link nextCueContextTime} wraps by.
     */
    loopWindowSeconds: LoopWindowSeconds | null;
    /**
     * Absolute context time this voice is scheduled to end, or `null` when it has no
     * determinate end (an unbounded loop) or when scheduling the stop failed. A fade
     * clamps its ramp end to this, so it must never name a stop that was not
     * scheduled.
     *
     * `fadeOut` writes its own ramp end here, but only ever `min`-clamped against what
     * this already holds and then floored at `now` — so a later fade can shorten a
     * voice's REMAINING life and never extend it, even though `source.stop()` would
     * itself accept a later time (§4.25). The floor is why "never later than before" is
     * not quite the same claim: a voice whose stop has elapsed but whose `onended` has
     * not yet been delivered records `now`, which is later than the stop it replaces and
     * extends nothing audible.
     */
    scheduledStopAt: number | null;
    phase: VoicePhase;
    /**
     * Precedence step 1 of Invariant #121: a release requested before the voice started.
     * Honoured by short-circuiting `startVoice`, so the source is never created at all.
     * Written by {@link DefaultAudioManager.fadeOut}, whose ramp has nothing to write to
     * while the voice is still loading.
     */
    releaseOnStart: boolean;
    /** Step 2: {@link PlayOptions.fadeIn}, filled by `play` itself rather than by a verb. */
    pendingFadeIn: FadeInSpec | null;
    /**
     * Step 3: a ramp-to-absolute requested pre-start, written by
     * {@link DefaultAudioManager.fadeTo}. One slot, so a later request supersedes an
     * earlier one rather than queueing behind it.
     */
    pendingFadeTo: FadeToSpec | null;
    /**
     * Step 4: a crossfade's linked fade-out of the OUTGOING voice, fired with this
     * voice's real `t0` so both curves are anchored there and authored over the same
     * window — each still clamps its own end against its own voice's scheduled stop, per
     * {@link DefaultAudioManager.crossfade} (§4.25). A thunk rather than a descriptor:
     * this record owns only WHEN the linkage fires, while `linkCrossfade`, which writes
     * it, owns what it does — down to which voice is faded, resolved by handle id at fire
     * time rather than captured.
     *
     * That `t0` is where a cue-aligned crossfade needs no linkage of its own: it is the
     * incoming voice's scheduled start, so it IS the cue, and both curves follow it there
     * with nothing here to change.
     */
    linkedFadeOut: ((startedAt: number) => void) | null;
    source: AudioBufferSourceNode | null;
    gainNode: GainNode | null;
    pannerNode: PannerNode | null;
}

/**
 * The gain bound that applies while a ramp is still travelling.
 *
 * {@link VoiceRecord.volume} says where the gain SETTLES, and no ramp is there yet: a
 * `fadeTo` installs its absolute target as the ceiling at ramp START while the gain only
 * arrives at `until`, and a `fadeOut` descends to `0` from wherever it was, on a
 * trajectory that may sit above a ceiling an earlier fade already settled. Either way the
 * voice spends the window legitimately off `volume`, and capping a departure read against
 * it there would name a gain the voice has not reached. That is the very artifact
 * {@link rampDeparture} exists to prevent, pointing the other way: on `equalPower` a step
 * down inside one waypoint, on a platform without `cancelAndHoldAtTime` a hard
 * `setValueAtTime` jump on every curve, and — when the cap reads `0` — an exponential
 * ramp silently degraded to linear by its zero-departure branch.
 *
 * Recorded by {@link scheduleVoiceRamp} rather than by each verb, so the bound cannot fall
 * behind a ramp whose author forgot it. Expiry is by comparison against
 * `AudioContext.currentTime`, like every other schedule fact on the record — no timer
 * holds it (§4.25).
 */
interface CeilingHold {
    /** The highest gain the voice can be at until {@link until}. See {@link scheduleVoiceRamp}. */
    readonly bound: number;
    /** Absolute context time the ramp lands, after which {@link VoiceRecord.volume} governs. */
    readonly until: number;
}

/** A voice's resolved playback schedule, against a decoded buffer's real duration. */
interface VoiceSchedule {
    /** The EFFECTIVE loop flag: `false` when a collapsed window took an IMPLIED loop
     * down with it, still `true` when `loop` was authored in its own right. */
    readonly loop: boolean;
    /** `start()`'s offset argument, after folding into the loop window. */
    readonly entryOffsetSeconds: number;
    /** `to`'s window length, measured from the PRE-FOLD anchor; `null` when unbounded. */
    readonly playDurationSeconds: number | null;
    readonly loopWindow: LoopWindowSeconds | null;
}

/**
 * The nodes and playback timeline a STARTED voice ramps against. Obtained through
 * {@link startedVoice}, which returns `null` for the state where a fade verb has nothing
 * to write to at all: a voice still `'loading'`, whose `play()` has returned but whose
 * `startVoice` has not run. A voice scheduled AHEAD of the clock has every one of these
 * and is not that state; what a verb owes it is the verb's own call — see
 * {@link DefaultAudioManager.applyFadeOut}.
 */
interface StartedVoice {
    readonly source: AudioBufferSourceNode;
    readonly gainNode: GainNode;
    readonly startedAtContextTime: number;
    readonly bufferDurationSeconds: number;
}

/**
 * The two verbs that ARM a cue-aligned op, for the one warning
 * {@link DefaultAudioManager.nextCueArrival} emits.
 */
type CueArmVerb = 'crossfadeAtCue' | 'fadeOutAtCue';

/**
 * The verbs that reach the shared fade-out path, for the diagnostics on it.
 *
 * Every message there is named for the verb the CALLER invoked rather than for the path
 * they meet on, so an operator reading one has a route back to the call that produced it —
 * and a crossfade's linked fade-out, which is no `fadeOut` call at all, names the crossfade
 * verb its caller used. A closed union rather than a `string`, as {@link CueArmVerb} is:
 * a message can only ever name a verb that exists, and an unknown one fails `tsc`.
 *
 * Built ON the arming pair rather than beside it, so a verb added there reaches this
 * without a second edit.
 */
type FadeOutVerb = CueArmVerb | 'crossfade' | 'fadeOut';

/** The unsubscribe {@link DefaultAudioManager.observeCues} hands back when it refuses. */
const NO_CUE_OBSERVATION = (): void => {
    return;
};

const DEFAULT_POOL_SIZE = 32;
const DEFAULT_BUS_ID: AudioBusId = 'sfx';
const DEFAULT_PRIORITY = 0;
/**
 * The RECOMMENDED {@link PlayOptions.priority} for music, and the whole of how music
 * survives a saturated pool (Invariant #123). Nothing applies it implicitly — not
 * `bus: 'music'`, not `loop: true` — because preemption reclaims a looping voice AHEAD of
 * an equal-priority one-shot: a loop typically runs until something else ends it, while
 * the one-shot beside it ends itself and cannot be re-triggered once its moment has
 * passed (see {@link voiceLoops} for what "looping" resolves to). Priority is
 * the tier above that one, so naming this constant is what lifts a music bed out of the
 * comparison entirely.
 *
 * `100` leaves `1`–`99` for a game's own SFX scale below it and room above for a
 * deliberate "outranks the music" tier (an alarm, a line of dialogue).
 *
 * NOT `Infinity`: {@link normalizePriority} maps every non-finite value to
 * {@link DEFAULT_PRIORITY}, so a voice authored at `Infinity` plays at the DEFAULT
 * priority rather than the highest — below every voice the game ranked above `0`, the
 * exact inverse of the intent.
 */
export const MUSIC_PRIORITY = 100;
const DEFAULT_VOLUME = 1;
const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'voice'];
const GAIN_RAMP_EPSILON = 1e-4;
const EQUAL_POWER_WAYPOINTS = 64;
/**
 * The default `curve` for `FadeInSpec`, `FadeOutSpec` and `FadeToSpec` (§4.25).
 *
 * Exported because `useSound` keys an omitted curve through this same value, and the two
 * must move together: were they to disagree, `{ durationMs }` and
 * `{ durationMs, curve: 'linear' }` would share one memo key while naming two different
 * fades, and whichever rendered first would keep playing. The same coupling holds for the
 * other four defaults that hook copies (`bus`, `loop`, `volume`, `priority`); they are
 * still copies, and single-homing them is its own change.
 */
export const DEFAULT_FADE_CURVE: FadeCurve = 'linear';
/**
 * A crossfade's own default, deliberately NOT {@link DEFAULT_FADE_CURVE}. Its two halves
 * are a matched pair rather than one fade: `equalPower`'s `sin`/`cos` quarter-waves keep
 * `g_in² + g_out²` constant where two linear ramps would dip through the middle — for a
 * MATCHED pair, one sharing a window and travelling the same distance. See
 * {@link DefaultAudioManager.crossfade} for both preconditions and what a pair that misses
 * one sounds like (§4.25).
 */
const DEFAULT_CROSSFADE_CURVE: FadeCurve = 'equalPower';
/** The fade-out window substituted when `{ toEnd }` finds no end to ramp to (§4.25). */
const DEFAULT_FADE_OUT_MS = 250;

export class DefaultAudioManager implements AudioManager {
    private readonly audioContext: AudioContext;
    private readonly buses = new Map<AudioBusId, AudioBus>();
    private readonly voices = new Map<string, VoiceRecord>();
    private readonly poolSize: number;
    private readonly cueSampler: CueSampler;
    private disposed = false;
    private nextHandleId = 0;
    private nextSequence = 0;

    public constructor(
        private readonly assetManager: AssetManager,
        options: AudioManagerOptions = {},
    ) {
        this.audioContext = options.audioContext ?? createAudioContext();
        this.poolSize = normalizePoolSize(options.poolSize);
        this.cueSampler = new CueSampler({
            frameSource: options.frameSource ?? browserFrameSource,
            readVoice: (voiceId) => this.readCuePlayhead(voiceId),
        });
        this.createBuses(options.busOptions);
    }

    public play(ref: AssetRef<AudioClipAsset>, opts: PlayOptions = {}): AudioHandle {
        return this.playVoice(ref, opts);
    }

    /**
     * The one path every play takes, the ordinary verb and both crossfades alike.
     *
     * `resolveStart` names the context time the voice is to start at, and is handed on
     * unevaluated — omitted, or `undefined` from it, means "as soon as possible", which is
     * what every play but a cue-aligned crossfade asks for. A resolver rather than a number
     * because the instant it names is a fact about ANOTHER voice's playhead, and that
     * playhead moves while this one loads: resolved at the call it could only ever name an
     * arrival the decode might already have missed, and `startVoice` would floor it at the
     * clock and fire at once. `startVoice` owns WHEN it runs, which is late, for reasons
     * stated there.
     */
    private playVoice(
        ref: AssetRef<AudioClipAsset>,
        opts: PlayOptions,
        resolveStart?: (now: number) => number | undefined,
    ): AudioHandle {
        const bus = opts.bus ?? DEFAULT_BUS_ID;
        const priority = normalizePriority(opts.priority);
        const handle = new ManagedAudioHandle(this.createHandleId(), ref, bus, priority);

        if (this.disposed) {
            handle.invalidate();
            return handle;
        }

        // Static tier: both bounds knowable without the buffer AND already out of
        // order. Runs BEFORE reserveVoiceSlot() so a rejected play neither preempts a
        // live voice nor starts a load (Invariant #117).
        const sheet = this.readCueSheet(ref);
        const staticRejection = findStaticCueRejection(opts, sheet);
        if (staticRejection !== null) {
            console.warn(staticRejection);
            handle.invalidate();
            return handle;
        }

        // The spatial half of the same static tier: distances are synchronously
        // knowable, so an already-invalid spec rejects here by the same provenance
        // rule — before any slot is reserved, with one warning (Invariant #117).
        let spatial: ResolvedSpatialSpec | null = null;
        if (opts.spatial !== undefined) {
            const resolution = resolveSpatialSpec(opts.spatial);
            if (resolution.kind === 'rejected') {
                console.warn(resolution.warning);
                handle.invalidate();
                return handle;
            }
            spatial = resolution.spec;
        }

        this.reserveVoiceSlot();
        if (this.voices.size >= this.poolSize) {
            handle.invalidate();
            return handle;
        }

        const record: VoiceRecord = {
            handle,
            loop: opts.loopRegion !== undefined || (opts.loop ?? false),
            loopRequested: opts.loop ?? false,
            spatial,
            pendingPosition: null,
            sequence: this.nextSequence,
            volume: clampUnit(opts.volume ?? DEFAULT_VOLUME),
            ceilingHold: null,
            settledGain: null,
            sheet,
            from: opts.from ?? null,
            to: opts.to ?? null,
            loopRegion: opts.loopRegion ?? null,
            startedAtContextTime: null,
            startOffsetSeconds: 0,
            bufferDurationSeconds: null,
            loopWindowSeconds: null,
            scheduledStopAt: null,
            phase: 'loading',
            releaseOnStart: false,
            pendingFadeIn: opts.fadeIn ?? null,
            pendingFadeTo: null,
            linkedFadeOut: null,
            source: null,
            gainNode: null,
            pannerNode: null,
        };
        this.nextSequence += 1;
        this.voices.set(handle.id, record);

        let loadPromise: Promise<ResolvedAsset<AudioClipAsset>>;
        try {
            loadPromise = this.assetManager.load<AudioClipAsset>(ref);
        } catch {
            this.releaseVoice(record, { stopSource: false });
            return handle;
        }

        void loadPromise
            .then((asset) => {
                if (this.disposed || !record.handle.valid || !this.voices.has(record.handle.id)) {
                    return null;
                }

                return this.toAudioBuffer(asset);
            })
            .then((buffer) => {
                if (buffer === null) {
                    this.releaseVoice(record, { stopSource: false });
                    return;
                }
                this.startVoice(record, buffer, resolveStart);
            })
            .catch(() => {
                this.releaseVoice(record, { stopSource: false });
            });

        return handle;
    }

    public stop(handle: AudioHandle): void {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            return;
        }

        this.releaseVoice(record, { stopSource: true });
    }

    /**
     * Ramp a live voice's stage-1 gain to `0` per `spec`, then stop it — Invariant #119.
     *
     * A voice that is ramping is released by `source.stop(rampEnd)` through the native
     * `source.onended` handler installed at `startVoice`, and no wall-clock timer ever
     * schedules one. So the voice stays in the pool with `handle.valid === true` for the
     * whole ramp (phase `'fading-out'`), and `valid` flips false exactly once, under
     * `releaseVoice`'s `voices.delete` guard.
     *
     * A no-op on an invalid or already-released handle. What a fade does to a voice that
     * is not sounding yet — still `'loading'`, or scheduled ahead of the clock — is
     * decided in {@link DefaultAudioManager.applyFadeOut}, against the anchor it is handed.
     */
    public fadeOut(handle: AudioHandle, spec: FadeOutSpec): void {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            return;
        }

        this.applyFadeOut(record, spec, 'fadeOut', this.audioContext.currentTime);
    }

    /**
     * The one path every fade-out takes, live verb and crossfade linkage alike, so an
     * obligation added to one cannot be forgotten by the other.
     *
     * `now` is the ANCHOR, passed rather than read here: {@link DefaultAudioManager.fadeOut}
     * supplies `currentTime`, while a crossfade supplies the incoming voice's real `t0`, so
     * both halves of the pair START together and author the same window (§4.25). Only the
     * start is shared by this: the end is resolved below against THIS voice's own scheduled
     * stop, and the incoming half's against its own.
     *
     * Those two are the same instant whenever an ordinary play's linkage fires — `startVoice`
     * resolves `t0` from `currentTime` and is synchronous and non-reentrant, so the clock
     * cannot advance before the intents are applied, and re-reading the clock here would
     * produce the same number. Taking it as an argument is what stops "one shared window"
     * from resting on that: it becomes a fact of the code rather than of the call stack, and
     * it survives a caller that reaches this from anywhere else. A `t0` that is a cue AHEAD
     * of the clock — what {@link DefaultAudioManager.fadeOutAtCue} and a cue-aligned
     * crossfade's linkage both hand over — needs one thing more than a correctly authored
     * window: the gain the ramp DEPARTS from is a fact about that anchor rather than about
     * `currentTime`, and {@link fadeOutDeparture} is where the two are told apart.
     *
     * `verb` is passed for the same reason, and threaded on down to
     * {@link resolveAuthoredFadeOutEnd} — see {@link FadeOutVerb}.
     */
    private applyFadeOut(
        record: VoiceRecord,
        spec: FadeOutSpec,
        verb: FadeOutVerb,
        now: number,
    ): void {
        const started = startedVoice(record);
        if (started === null) {
            // Still loading: there is no gain to ramp and no source to stop, so the
            // release is parked rather than applied — step 1 of Invariant #121.
            record.releaseOnStart = true;
            return;
        }

        if (now < started.startedAtContextTime) {
            // Scheduled but not yet begun: nothing is audible to ramp, and a fade over
            // `[now, rampEnd]` would run to completion before the voice's first sample —
            // the mirror of a fade-in anchored at the call. So the voice is CUT, reaching
            // the outcome the `'loading'` park above reaches: it never becomes audible.
            // Released here rather than through `source.stop(rampEnd)` and the native
            // `onended` the ordinary path hands off to, because that route rests on a
            // source which never plays still reporting an end — and a voice whose end is
            // never reported would hold its pool slot for good.
            this.releaseVoice(record, { stopSource: true });
            return;
        }

        const { rampEnd, deferredWarning } = resolveFadeOutRampEnd(
            record,
            started,
            spec,
            verb,
            now,
        );

        try {
            started.source.stop(rampEnd);
        } catch {
            // The ramp's whole safety rests on the release it hands off to. Without a
            // scheduled stop the voice would sit silent and unreleased forever, holding
            // a pool slot, so it is stopped now — and the cut is said out loud rather
            // than left as an unexplained missing fade.
            console.warn(
                `Audio ${verb} could not schedule its stop at ${rampEnd}s; the fade is dropped and the voice is stopped immediately.`,
            );
            this.releaseVoice(record, { stopSource: true });
            return;
        }

        if (deferredWarning !== null) {
            // Only now that the fade it narrates is going to happen. A voice reaches
            // `{ toEnd }` with no scheduled end two ways, and ONE of them is a platform
            // that refuses `stop(when)` — which refuses the stop above as well. Printed
            // eagerly, the message would promise a substituted fade one statement before
            // the message saying the fade was dropped (Invariant #118 specifies one).
            console.warn(deferredWarning);
        }

        // Only now that the release exists. `rampEnd` was clamped against any stop
        // already scheduled and then floored at `now`, so this write can only shorten
        // the voice's remaining life.
        record.scheduledStopAt = rampEnd;
        record.phase = 'fading-out';
        scheduleVoiceRamp(
            record,
            started.gainNode.gain,
            0,
            now,
            rampEnd,
            spec.curve ?? DEFAULT_FADE_CURVE,
            fadeOutDeparture(record, started.gainNode.gain, now, this.audioContext.currentTime),
        );
    }

    /**
     * Ramp a live voice's stage-1 gain to the ABSOLUTE `spec.to` and hold it there — a dip
     * or a swell, never a release (§4.25).
     *
     * Nothing about the voice's death moves: no `source.stop` is scheduled, `phase` and
     * {@link VoiceRecord.scheduledStopAt} are left exactly as they were, and the ramp
     * WINDOW — not its target — is what clamps against any stop already scheduled. So a
     * voice already `'fading-out'` is re-targetable (Invariant #119) yet still dies on
     * time, and its ramp is COMPRESSED into what remains rather than truncated the way a
     * fade-in is: it reaches the full `to` at the clamped end. `fadeTo({ to: 1 })` on a
     * dying voice therefore peaks at full gain on the exact sample `source.stop` fires — a
     * hard cut, and the honest one, since Web Audio cannot un-schedule that stop and
     * lowering the target would silently rewrite what the caller asked for.
     *
     * `to` becomes the voice's new ceiling, which is what keeps a later fade's departure
     * bound honest (see {@link rampDeparture} and {@link CeilingHold}).
     *
     * A no-op on an invalid or already-released handle. A fade arriving while the voice is
     * still `'loading'` is parked on {@link VoiceRecord.pendingFadeTo} instead — step 3 of
     * Invariant #121 — and applied at the real `t0`.
     *
     * A voice SCHEDULED ahead of the clock is not that state: it has a gain to write to,
     * so the ramp is laid from `now`, and the `cancelAndHoldAtTime` that anchors it
     * retires both the floor written at the scheduled start and any fade-in laid over it —
     * so such a voice begins at `to` rather than fading to it. That is the deliberate
     * answer rather than an oversight, and {@link DefaultAudioManager.crossfadeAtCue} is
     * what makes it a state a game can reach: a live `fadeTo` on the handle it returns
     * lands here. `fadeOut` is the verb the same state needed handling for, because its
     * ramp ends in a release and a ramp that finishes before the first sample would leave
     * a voice silent and unreleased; a dip that arrives early is only a dip.
     */
    public fadeTo(handle: AudioHandle, spec: FadeToSpec): void {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            return;
        }

        const started = startedVoice(record);
        if (started === null) {
            // Still loading: there is no gain to ramp, so the request is parked. One slot,
            // so a later fadeTo supersedes an earlier one rather than queueing behind it —
            // two ramps over the same window would fight at `t0`.
            record.pendingFadeTo = spec;
            return;
        }

        const now = this.audioContext.currentTime;
        const gain = started.gainNode.gain;
        applyFadeToRamp(record, gain, spec, now, rampDeparture(record, gain, now));
    }

    /**
     * Start `incoming` with a fade-in and link a fade-out of `outgoing` to it, both
     * anchored to the incoming voice's REAL start `t0` and both authored over
     * `[t0, t0 + durationMs]` (§4.25). Returns the incoming handle.
     *
     * Stateless sugar over the play and fade-out paths, holding no crossfade state of its
     * own: the linkage lives on the incoming {@link VoiceRecord} as step 4 of Invariant
     * #121's precedence order, and fires once, at `t0`. The shared ANCHOR is unconditional
     * and is the whole point — until the incoming voice actually starts, the outgoing one
     * keeps playing at full volume rather than fading into a gap.
     *
     * Constant POWER across the pair — `g_in² + g_out²` unchanging, no mid-fade dip — is
     * narrower than either, and needs two things this verb supplies neither of by force:
     *
     * 1. One shared window. `durationMs` is what each half AUTHORS; each then clamps its own
     *    end against its OWN voice's scheduled stop ({@link clampRampEnd}), which this verb
     *    neither reads across nor equalises. When one clamps, they cover different windows
     *    and the sum diverges over the difference. An outgoing voice bounded before
     *    `t0 + durationMs` reaches silence early — a dip, with the incoming voice still
     *    rising into it. An incoming one bounded there is worse than a dip: its fade-in
     *    truncates below `volume` AND its source ends, so it is released mid-fade and the
     *    crossfade finishes on the outgoing tail and then on silence — the one shape in
     *    which the fail-soft promise below does not hold. Equalising the two would mean
     *    overriding a `to`/`toEnd` bound the caller authored on one voice because of the
     *    other.
     * 2. Equal distances. `equalPower` traces `V·sin θ` rising against `G·cos θ` falling, and
     *    those squares sum to a constant only when `V === G` — the incoming `volume` equals
     *    the gain the outgoing voice is at when the linkage fires. A quieter incoming voice
     *    leaves both curves correctly SHAPED while the pair sums to a slope, ending at `V²`.
     *    Scaling either one to match would silently rewrite an authored `volume`.
     *
     * Both hold by default — two full-volume voices that outlive the fade — which is the
     * case the curve is chosen for. Neither is enforced, because enforcing either means
     * overriding something the caller asked for.
     *
     * Fail-soft throughout, and every branch keeps SOMETHING audible:
     *
     * - An incoming voice that never starts — a decode failure, or a play `play` rejected —
     *   leaves the outgoing one playing unfaded, because the linkage dies with the record
     *   that held it, and returns an invalid handle.
     * - An outgoing voice already gone takes no linkage at all; the incoming one still fades
     *   in, and its handle is valid.
     * - A SATURATED POOL is the reverse case, and the reason the outgoing voice is re-checked
     *   after the play below: `reserveVoiceSlot` may reclaim it to host the incoming one. The
     *   incoming voice then starts normally with a valid handle and no linkage, and the
     *   outgoing one is already stopped rather than faded.
     * - One still loading when the linkage fires has no gain to ramp, so it parks a release
     *   instead and never becomes audible.
     *
     * None of those adds a warning here. Where a diagnosis exists `play` has already emitted
     * it — a statically rejected cue warns there, so a second message naming the outcome
     * would put two on one defect (Invariant #118). A decode failure is silent in `play`
     * itself, so there the invalid handle is the only signal at all.
     */
    public crossfade(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CrossfadeOptions,
    ): AudioHandle {
        return this.linkCrossfade(outgoing, incoming, opts, null);
    }

    /**
     * Arm a crossfade now and execute it at the outgoing voice's next arrival at
     * `opts.atCue`: the incoming voice is `source.start`ed at that instant and BOTH ramps
     * are anchored there, so the pair lands on the sample rather than on whichever frame a
     * callback happened to fire in (§4.25). Everything else — the shared window, the two
     * preconditions behind constant power, the per-voice clamp — is
     * {@link DefaultAudioManager.crossfade}'s, unchanged.
     *
     * The load starts at once and the arrival is read when the buffer is in hand, not at
     * the call. That ordering is what makes the fail-soft branches below reachable at all,
     * since every one of them is a fact about the outgoing voice that can change while the
     * incoming clip decodes.
     *
     * Fail-soft throughout, and every branch keeps SOMETHING audible:
     *
     * - **The decode lands after the cue.** The arrival is re-read there, so a looping bed
     *   simply hands over on its NEXT pass. Only a voice with no next arrival falls to the
     *   branch below.
     * - **The cue is one the voice never reaches again** — past `loopEnd`, already gone on
     *   a non-looping voice, or beyond the voice's own scheduled end. One warning, and the
     *   swap happens immediately: the same answer `fadeOut({ toCue })` gives an
     *   unreachable cue, and for the same reason — the transition was asked for, only its
     *   alignment is impossible.
     * - **The outgoing voice is gone, or still loading, when the decode lands.** There is
     *   no timeline to align to, so the swap is immediate and silent. A voice already gone
     *   also takes no linkage at all, exactly as `crossfade` leaves one.
     * - **The incoming decode fails.** The arm dies with the record that held it, so the
     *   outgoing voice keeps playing UNFADED and its own natural life — and no second
     *   diagnosis is added beside whatever `play` already emitted (Invariant #118).
     *
     * The returned handle names a voice that is loading AND scheduled. `valid` is the
     * whole report: a play that `play` rejected returns an invalid one having warned there,
     * so a message here would put two warnings on one defect.
     */
    public crossfadeAtCue(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CueAlignedCrossfadeOptions,
    ): AudioHandle {
        const { atCue, ...crossfadeOptions } = opts;
        return this.linkCrossfade(outgoing, incoming, crossfadeOptions, atCue);
    }

    /**
     * The one path both crossfade verbs take, so an obligation added to either cannot be
     * forgotten by the other — {@link DefaultAudioManager.crossfade} owns what the pair
     * does, {@link DefaultAudioManager.crossfadeAtCue} what the cue adds.
     *
     * `atCue` is the whole difference: `null` starts the incoming voice as soon as it
     * decodes, a cue schedules it for the outgoing voice's next arrival there. The linkage
     * needs no branch of its own either way, because it already takes the incoming voice's
     * real `t0` as its argument and that `t0` IS the cue.
     */
    private linkCrossfade(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CrossfadeOptions,
        atCue: Cue | null,
    ): AudioHandle {
        // Rest rather than a field-by-field forward, so a `PlayOptions` field added later
        // reaches `play` without a second edit here — which is what
        // `CrossfadeOptions extends Omit<PlayOptions, 'fadeIn'>` already promises. Excess
        // properties are still rejected where `opts` is authored.
        const { durationMs, curve = DEFAULT_CROSSFADE_CURVE, ...playOptions } = opts;
        const handle = this.playVoice(
            incoming,
            { ...playOptions, fadeIn: { durationMs, curve } },
            atCue === null
                ? undefined
                : (now): number | undefined => this.cueAlignedStart(outgoing, atCue, now),
        );

        const incomingRecord = this.voices.get(handle.id);
        // The outgoing voice is checked AFTER the play, not before: a saturated pool
        // reclaims a voice to host the incoming one, and the one it reclaims may well be
        // this outgoing one. A linkage parked against it would fire onto a record that has
        // already left the pool.
        if (incomingRecord === undefined || !this.voices.has(outgoing.id)) {
            return handle;
        }

        const verb: FadeOutVerb = atCue === null ? 'crossfade' : 'crossfadeAtCue';
        incomingRecord.linkedFadeOut = (startedAt): void => {
            // Resolved by handle id when the linkage FIRES, never captured as a record:
            // the voice may have been stopped, preempted or have reached its own end in
            // the meantime, and a captured record would still accept the write — silently,
            // since a released one has no nodes left to ramp.
            const outgoingRecord = this.voices.get(outgoing.id);
            if (outgoingRecord === undefined) {
                return;
            }

            this.applyFadeOut(outgoingRecord, { overMs: durationMs, curve }, verb, startedAt);
        };

        return handle;
    }

    /**
     * The context time a cue-aligned crossfade's incoming voice starts at, resolved when
     * its buffer is in hand and that voice is going to play — or `undefined` for "as soon
     * as possible", which every fail-soft branch of
     * {@link DefaultAudioManager.crossfadeAtCue} lands on.
     *
     * Resolved by handle id here, never captured as a record, for the reason the linkage
     * is: the outgoing voice may have been stopped, preempted or reached its own end while
     * the incoming clip decoded, and a captured record would answer for a voice that has
     * left the pool.
     *
     * `now` is the incoming voice's own `t0` clock read, handed down rather than re-read,
     * so the arrival is measured against the same instant the start is floored at.
     */
    private cueAlignedStart(outgoing: AudioHandle, cue: Cue, now: number): number | undefined {
        const record = this.voices.get(outgoing.id);
        if (record === undefined) {
            return undefined;
        }

        return this.nextCueArrival(record, cue, 'crossfadeAtCue', now) ?? undefined;
    }

    /**
     * Hold `spec.fade` until this voice's next arrival at `spec.atCue`, then run it from
     * there — the simple half of the cue-aligned pair, and deliberately not reducible to
     * `fadeOut({ toCue })`, which ramps TO a cue over the window ending at one (§4.25).
     *
     * Nothing is deferred by a timer: the ramp is written now, over a window that OPENS at
     * the cue, and the release rides the `source.stop(rampEnd)` every fade-out schedules
     * (Invariant #119). So the voice is `'fading-out'` and condemned from this call even
     * though it plays on at full volume until the cue — the phase names the schedule, not
     * the audible descent, and preemption ranks it accordingly (Invariant #123).
     *
     * The whole {@link FadeOutSpec} vocabulary resolves against the cue rather than the
     * call, so `{ overMs }` is a window opening there, `{ toCue }` names the NEXT arrival
     * after it, and `{ toEnd: true }` ramps from it to the voice's scheduled end.
     *
     * Fail-soft, like every other cue op:
     *
     * - **A cue the voice never reaches again** gets one warning, and the fade then falls
     *   back to `now` — so it is whatever a bare `fadeOut` would have done from here. The
     *   fade was asked for; only its alignment is impossible.
     * - **A voice still loading** has no timeline to align to and no gain to ramp, so the
     *   release is parked and it never becomes audible: exactly what a bare `fadeOut`
     *   leaves, and the fade is lost rather than deferred (Invariant #121).
     * - **An invalid or already-released handle** is a silent no-op, as `stop`, `fadeOut`
     *   and `fadeTo` are.
     *
     * A voice whose own start is still AHEAD of the clock is where this CAN part company
     * with `fadeOut`, which cuts one outright because a ramp from `now` would finish before
     * its first sample. An arrival at a cue is at or after the start it is measured from,
     * so a reachable cue gives such a voice something to fade and the ordinary ramp runs.
     * An unreachable one falls back to `now` under the first bullet and cuts it just the
     * same; both are measured.
     */
    public fadeOutAtCue(handle: AudioHandle, spec: CueAlignedFadeOutSpec): void {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            return;
        }

        const now = this.audioContext.currentTime;
        const arrival = this.nextCueArrival(record, spec.atCue, 'fadeOutAtCue', now);
        this.applyFadeOut(record, spec.fade, 'fadeOutAtCue', arrival ?? now);
    }

    /**
     * The context time this voice's playhead next reaches `cue` — the instant a cue-aligned
     * op is armed for — or `null` when nothing in its schedule brings it there.
     *
     * Derived from the recorded schedule facts through {@link nextCueContextTime}, so no
     * playhead is sampled and no timer is consulted (Invariant #122), and the cue resolves
     * under the same END-POINT rules `fadeOut({ toCue })` and `secondsUntilCue` use.
     *
     * `now` is supplied rather than read, so an arm and the start it is resolved for are
     * measured against one instant.
     *
     * `verb` names the caller in the one warning this emits (Invariant #118). It is a
     * closed union rather than a `string`, so the message can only ever name a verb that
     * exists — see {@link FadeOutVerb}, which is built on it. A voice still
     * `'loading'` is NOT that diagnosis: it has no timeline to align to yet, which is a
     * fact about how early the call came rather than a defect in it, so it returns `null`
     * silently.
     */
    private nextCueArrival(
        record: VoiceRecord,
        cue: Cue,
        verb: CueArmVerb,
        now: number,
    ): number | null {
        const started = startedVoice(record);
        if (started === null) {
            return null;
        }

        const cueSeconds = resolveEndpointCueSeconds(record, started, cue);
        const arrival = nextCueContextTime(record, started, cueSeconds, now);
        // The voice's own scheduled end bounds the arrival, exactly as it bounds
        // `secondsUntilCue` — and closed at the stop, as the loop window is closed at
        // `loopEnd`. `fadeOut({ toCue })` meets the same fact and CLAMPS to it instead,
        // because it still has to fade something; an arm has to say the cue is not coming,
        // for two reasons at once. Nothing would be there to hear it: the incoming half
        // would start after the outgoing voice had gone silent. And the fade-out's ramp
        // end is floored at its own anchor, so an anchor past the stop would push
        // `source.stop` LATER than the one already booked — the one thing a re-target must
        // never do (§4.25).
        const stopAt = record.scheduledStopAt;
        if (arrival === null || (stopAt !== null && arrival > stopAt)) {
            console.warn(
                `Audio ${verb} cue ${describeCue(cue)} resolved to ${cueSeconds}s, which nothing in this voice's schedule brings it to (${describeVoiceTimeline(record)}); beginning the transition immediately.`,
            );
            return null;
        }

        return arrival;
    }

    /**
     * Invariant #122's read direction, layered on the same two functions the fade verbs
     * use: {@link voicePlayheadSeconds} decides whether this voice HAS a playhead at all,
     * and {@link nextCueContextTime} says when that playhead next reaches the cue.
     *
     * The playhead gate is not redundant with the arrival maths: a voice whose scheduled
     * start is still ahead has no playhead, and answering a countdown for one is a policy
     * this verb settles rather than an error it corrects — see `answers no cue countdown
     * while the scheduled start is still ahead`.
     *
     * The cue resolves under END-POINT rules, exactly as `fadeOut({ toCue })` resolves
     * its own, so a name absent from the sheet clamps to the decoded end rather than
     * abandoning. Sharing the resolution is what makes this the fade's dual rather than a
     * second opinion about the same cue.
     */
    public secondsUntilCue(handle: AudioHandle, cue: Cue): number | null {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            return null;
        }

        const started = startedVoice(record);
        if (started === null) {
            return null;
        }

        const now = this.audioContext.currentTime;
        if (voicePlayheadSeconds(record, started, now) === null) {
            return null;
        }

        const cueSeconds = resolveEndpointCueSeconds(record, started, cue);
        const cueContextTime = nextCueContextTime(record, started, cueSeconds, now);
        if (cueContextTime === null) {
            return null;
        }

        // The voice's own end bounds the arrival, and the buffer timeline cannot see it:
        // a `to`-bounded voice stops before its buffer runs out, and a voice already
        // fading out has had its end rewritten to the ramp end. Closed at the stop, as
        // the loop window is closed at `loopEnd`. `fadeOut({ toCue })` meets this same
        // fact one line later and CLAMPS to it instead — it still has to fade something,
        // while a query has to say the cue is not coming.
        const scheduledStopAt = record.scheduledStopAt;
        if (scheduledStopAt !== null && cueContextTime > scheduledStopAt) {
            return null;
        }

        return cueContextTime - now;
    }

    /**
     * The observation half of the cue timeline, sampled once per frame by
     * {@link CueSampler} — which owns the chain, and exists only while an observation
     * does. Nothing is scheduled here: a cue firing changes no audio.
     *
     * Refused for a handle that names no live voice, exactly as `stop`, `fadeOut` and
     * `setVoicePosition` refuse one, and silently for the same reason — a stale handle is
     * an ordinary thing for a caller to hold, not a defect worth a warning.
     */
    public observeCues(handle: AudioHandle, handlers: CueHandlers): () => void {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            return NO_CUE_OBSERVATION;
        }

        // Compiled lazily: the sheet is a property of the CLIP, so the second observer of
        // a voice joins the list the first one's compile produced.
        return this.cueSampler.observe(handle.id, () => compileCueSheet(record.sheet), handlers);
    }

    /**
     * Where one observed voice's playhead is, for the frame being sampled — or `null`
     * when there is nothing to sample.
     *
     * The scheduler steps on the UNWRAPPED position: the entry point plus elapsed context
     * time, which {@link voicePlayheadSeconds} computes and then FOLDS into the loop
     * window. The fold is the one thing a cue step must not be handed, so the timeline
     * facts are read here directly, and the two bounds that decide whether there is a
     * playhead at all are applied as the manager's own:
     *
     * - A start still AHEAD of the clock has none. Subtracting anyway would report a
     *   position behind the entry point, and the first real step would then sweep a
     *   stretch of buffer the voice was never in.
     * - The voice's SCHEDULED end is where it stops sounding, so it is where observation
     *   ends. {@link voicePlayheadSeconds} deliberately leaves that bound to whoever owns
     *   it, and this is that owner: it is an absolute context time the manager writes and
     *   rewrites — a `to` bound at the start, a fade-out's ramp end later — rather than a
     *   fact about the buffer. `secondsUntilCue` applies the same one, so a countdown and
     *   the emission it counts down to agree about when the voice is over. It also covers
     *   the decoded buffer's own end, which every non-looping voice is given a scheduled
     *   stop at — so a cue an authoring sheet places past the decode is never swept.
     */
    private readCuePlayhead(voiceId: string): VoiceCueReading | null {
        const record = this.voices.get(voiceId);
        if (record === undefined) {
            return null;
        }

        const started = startedVoice(record);
        if (started === null) {
            return null; // Still loading: nothing to seat a scheduler from yet.
        }

        const startedAt = started.startedAtContextTime;
        const now = this.audioContext.currentTime;
        if (now < startedAt) {
            return null;
        }

        const stopAt = record.scheduledStopAt;
        // Closed at the stop, as the loop window is closed at `loopEnd`: the playhead
        // reaches that position, so a cue sitting exactly on it sounds on the step that
        // ends the voice.
        const reachedStop = stopAt !== null && now >= stopAt;
        const at = reachedStop ? stopAt : now;
        return {
            sample: {
                unwrappedSeconds: record.startOffsetSeconds + (at - startedAt),
                ended: reachedStop,
            },
            loopWindow: record.loopWindowSeconds,
        };
    }

    public stopAll(bus?: AudioBusId): void {
        const records = Array.from(this.voices.values()).filter(
            (record) => bus === undefined || record.handle.bus === bus,
        );
        for (const record of records) {
            this.releaseVoice(record, { stopSource: true });
        }
    }

    public duck(bus: AudioBusId, duckedVolume: number, durationMs: number): void {
        if (this.disposed) {
            return;
        }

        this.getBus(bus).duck(duckedVolume, durationMs);
    }

    public setListener(pose: AudioListenerPose, opts: SetListenerOptions = {}): void {
        if (this.disposed) {
            return;
        }

        const resolved = resolveListenerPose(pose);
        if (resolved.degraded) {
            console.warn(
                'Audio setListener pose has a non-finite component; writing the default component in its place.',
            );
        }

        const listener = this.audioContext.listener;
        const now = this.audioContext.currentTime;
        const immediate = opts.immediate ?? false;
        const params = [
            listener.positionX,
            listener.positionY,
            listener.positionZ,
            listener.forwardX,
            listener.forwardY,
            listener.forwardZ,
            listener.upX,
            listener.upY,
            listener.upZ,
        ];
        const values = [...resolved.position, ...resolved.forward, ...resolved.up];
        if (params.every(isWritableAudioParam)) {
            try {
                params.forEach((param, index) => {
                    writePositionalParam(param, values[index] ?? 0, now, immediate);
                });
                return;
            } catch {
                // Present but unusable on this platform — degrade to the legacy path,
                // exactly as an absent param does. The legacy write below re-states the
                // WHOLE pose, so any params already written before the throw are simply
                // written again rather than left disagreeing with the rest.
            }
        }

        setListenerPoseLegacy(listener, resolved);
    }

    public setVoicePosition(
        handle: AudioHandle,
        position: AudioPosition,
        opts: SetVoicePositionOptions = {},
    ): void {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            // Silent, matching stop/fadeOut/fadeTo: ids are minted monotonically, so
            // a stale handle can never name a live record.
            return;
        }

        if (record.spatial === null) {
            console.warn(
                'Audio setVoicePosition called on a non-spatial voice; ignoring the call — a panner cannot be inserted into a running chain, and promoting the voice would change its audible level mid-play.',
            );
            return;
        }

        const [x, y, z] = position;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            // No default to degrade to here — the voice's CURRENT position is the
            // panner's own state, so the move is dropped whole rather than half-moved.
            console.warn(
                `Audio setVoicePosition position [${x}, ${y}, ${z}] has a non-finite component; dropping the move.`,
            );
            return;
        }

        const pannerNode = record.pannerNode;
        if (pannerNode === null) {
            // Still loading: the panner does not exist yet, so the position is parked
            // and consumed by startVoice at t0 — one slot, last write wins
            // (Invariant #121).
            record.pendingPosition = position;
            return;
        }

        setPannerPosition(
            pannerNode,
            position,
            this.audioContext.currentTime,
            opts.immediate ?? false,
        );
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        // Before the releases below, which is what makes disposal cancel the sampler
        // rather than end every observation through it: the voices did not finish, and
        // an observer being torn down alongside the manager has nothing to do with an
        // `end`. `stopAll()`, the session-end call an observer outlives, still emits one.
        this.cueSampler.dispose();
        this.stopAll();
        for (const busId of BUS_IDS) {
            this.getBus(busId).dispose();
        }
        void this.audioContext.close();
    }

    private createBuses(options?: AudioBusOptions): void {
        for (const busId of BUS_IDS) {
            this.buses.set(busId, new AudioBus(busId, this.audioContext, options));
        }

        const masterBus = this.getBus('master');
        masterBus.gainNode.connect(this.audioContext.destination);

        for (const busId of BUS_IDS) {
            if (busId === 'master') {
                continue;
            }

            this.getBus(busId).gainNode.connect(masterBus.gainNode);
        }
    }

    private reserveVoiceSlot(): void {
        if (this.voices.size < this.poolSize) {
            return;
        }

        const candidate = this.findWorstStandingVoice();
        if (candidate !== null) {
            this.releaseVoice(candidate, { stopSource: true });
        }
    }

    /**
     * The voice to reclaim, ranked by {@link voiceHasLowerPreemptionRank}.
     *
     * The scan is deliberately UNFILTERED — no `continue`, no skip predicate — because
     * that shape is what "no voice class is hard-exempt" amounts to in code: a saturated
     * pool always yields a candidate, so it cannot deadlock a higher-priority request
     * however uniformly it is filled (Invariant #123). Music survives by ranking, via
     * {@link MUSIC_PRIORITY}, never by being skipped here.
     */
    private findWorstStandingVoice(): VoiceRecord | null {
        let selected: VoiceRecord | null = null;
        for (const record of this.voices.values()) {
            if (selected === null || voiceHasLowerPreemptionRank(record, selected)) {
                selected = record;
            }
        }
        return selected;
    }

    /**
     * Read and validate the clip's cue sheet. Synchronous and side-effect free (no
     * decode, no load), so it can run inside `play()` before any voice is reserved.
     * A delegating or game-supplied AssetManager must never throw out of `play()`.
     */
    private readCueSheet(ref: AssetRef<AudioClipAsset>): AudioClipMetadata | null {
        try {
            return parseAudioCueSheet(this.assetManager.getManifestMetadata(ref));
        } catch {
            return null;
        }
    }

    /**
     * The DYNAMIC validation tier: resolve every cue against the decoded buffer,
     * clamping to `[0, duration]`. Returns `null` when a load-bearing anchor could
     * not resolve and the play must be abandoned (Invariant #118); warnings are
     * emitted here, one per defect.
     */
    private resolveVoiceSchedule(record: VoiceRecord, duration: number): VoiceSchedule | null {
        const sheet = record.sheet;

        // `from` is a load-bearing anchor: unresolvable abandons the play.
        const anchor = resolveCue(record.from ?? 'start', { sheet, duration, role: 'anchor' });
        if (anchor.kind === 'abandon') {
            console.warn(anchor.warning);
            return null;
        }
        const anchorSeconds = anchor.seconds;

        // The loop region resolves BEFORE `to`, because it is the other operation that
        // can abandon. Resolving `to` first would let a dropped window log "continuing
        // playback" moments before the region abandoned the play — two warnings, the
        // first contradicting the outcome (Invariant #118 specifies one).
        let loop = record.loop;
        let loopWindow: VoiceSchedule['loopWindow'] = null;
        if (loop) {
            const resolvedLoop = resolveLoopWindow(record, record.loopRequested, {
                sheet,
                duration,
            });
            if (resolvedLoop === null) {
                return null;
            }
            loop = resolvedLoop.loop;
            loopWindow = resolvedLoop.window;
        }

        // `to` is an end-point: it clamps and never abandons. A window that collapses
        // only AFTER clamping drops just that bound — the anchor already resolved, so
        // playback continues from it.
        let playDurationSeconds: number | null = null;
        if (record.to !== null) {
            const end = resolveCue(record.to, { sheet, duration, role: 'endpoint' });
            // An endpoint never abandons; the fallback keeps the union exhaustive for TS.
            const endSeconds = end.kind === 'resolved' ? end.seconds : duration;
            if (endSeconds <= anchorSeconds) {
                // What survives differs by branch, so the message must too: a bounded
                // non-loop voice falls back to its natural end, but a looping one is
                // left with NO determinate end at all, which is worth saying out loud.
                const outcome = loop
                    ? 'the voice will loop with no scheduled end'
                    : 'playback continues to the natural end of the clip';
                console.warn(
                    `Audio play bound to=${endSeconds}s is at or before from=${anchorSeconds}s after clamping to [0, ${duration}s]; dropping the bound — ${outcome}.`,
                );
            } else {
                playDurationSeconds = endSeconds - anchorSeconds;
            }
        }

        // Entering at or past the loop window folds back into it, so an over-long
        // `from` lands inside the loop rather than past its end. The guard is what
        // keeps the fold off an anchor BEFORE the window: JS `%` keeps the dividend's
        // sign, so folding one anyway adds a negative remainder to `loopStart`. It
        // changes the result once the anchor is a full period or more early
        // (`loopStart - anchor >= period`) — e.g. `from: 0` with `[3, 5]` would give
        // `3 + (-3 % 2)` = 2, silently skipping the intro. Nearer anchors happen to
        // fold to themselves, so the guard states the intent rather than patching a
        // single case.
        let entryOffsetSeconds = anchorSeconds;
        if (loopWindow !== null && anchorSeconds >= loopWindow.startSeconds) {
            const period = loopWindow.endSeconds - loopWindow.startSeconds;
            entryOffsetSeconds =
                loopWindow.startSeconds + ((anchorSeconds - loopWindow.startSeconds) % period);
        }

        return { loop, entryOffsetSeconds, playDurationSeconds, loopWindow };
    }

    /**
     * Create a voice's nodes and start it — at the time `resolveStart` names, or as soon as
     * possible when it names none. A scheduled start is what makes a cue-aligned transition
     * native rather than timed: `source.start(when)` lands on the sample, where a callback
     * firing a frame late would put the same transition a frame off the beat.
     *
     * The start arrives as a RESOLVER rather than a number, and is called late — after the
     * release check and the schedule resolution below, and against the one `now` this reads.
     * Both matter. Naming a cue-aligned arrival emits its own fail-soft warning, and a voice
     * about to be torn down or abandoned would make that warning a lie, which is the rule
     * the release check already states for the schedule's own messages. And a resolver that
     * read the clock itself would be reading a second instant, when everything below is
     * derived from one.
     *
     * A voice awaiting a future start is `'playing'` with a `startedAtContextTime` still
     * ahead of the clock, and no fourth {@link VoicePhase} marks it: a fourth phase would
     * move {@link voiceLoops} and Invariant #123's four-key ranking, and nothing here
     * bounds how long the state lasts, so it is recorded rather than engineered away —
     * such a voice ranks as playing for preemption while still inaudible, so a saturated
     * pool reclaims a live voice already fading out ahead of it.
     */
    private startVoice(
        record: VoiceRecord,
        buffer: AudioBuffer,
        resolveStart?: (now: number) => number | undefined,
    ): void {
        if (this.disposed || !record.handle.valid || !this.voices.has(record.handle.id)) {
            return;
        }

        // Precedence step 1 of Invariant #121. This runs BEFORE schedule resolution, not
        // merely before node creation: resolving emits cue warnings that narrate what
        // playback does next, and a voice that is about to be torn down would make every
        // one of them a lie.
        if (record.releaseOnStart) {
            this.releaseVoice(record, { stopSource: false });
            return;
        }

        // Resolve before creating any node, so an abandoned play leaves no orphan.
        const schedule = this.resolveVoiceSchedule(record, buffer.duration);
        if (schedule === null) {
            this.releaseVoice(record, { stopSource: false });
            return;
        }

        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        record.source = source;
        record.gainNode = gainNode;

        source.buffer = buffer;
        source.loop = schedule.loop;
        if (schedule.loopWindow !== null) {
            source.loopStart = schedule.loopWindow.startSeconds;
            source.loopEnd = schedule.loopWindow.endSeconds;
        }
        source.onended = () => {
            this.releaseVoice(record, { stopSource: false });
        };
        // One `t0`, resolved once and used for the gain floor, the start, the stop maths
        // and every pending ramp — "applied atomically at t0" is only true if there is a
        // single t0 to apply them at, and that stays true when the t0 is a cue rather than
        // now. A `when` already behind the clock is floored: `source.start()` treats a past
        // time as "now" anyway, but the record must not advertise a start that never
        // happened, since every cue answer this voice gives is derived from it. The finite
        // test is what makes that a floor for EVERY non-finite input rather than for two of
        // the three: `NaN` and `-Infinity` fail the comparison on their own, while
        // `+Infinity` passes it and would put a non-finite time into the `setValueAtTime`
        // below — a `RangeError` from outside the try that guards `source.start`, on a path
        // that is otherwise fail-soft throughout. The resolver takes `now` and is optional
        // rather than defaulted at the signature, so the clock is read exactly ONCE: a
        // resolver reading it, or a default expression plus the floor here, would read it
        // twice, and two reads are two instants on a clock that advances between them.
        const now = this.audioContext.currentTime;
        const when = resolveStart?.(now);
        const startedAt = when !== undefined && Number.isFinite(when) && when > now ? when : now;
        // A fade-in departs from its curve's floor rather than from `volume`, and this
        // write is also what anchors the ramp: `scheduleGainRamp` re-anchors at the value
        // the param holds.
        gainNode.gain.setValueAtTime(initialVoiceGain(record), startedAt);
        this.connectVoice(record, source, gainNode);

        // The playhead timeline half of what {@link startedVoice} narrows on; the two
        // nodes above are the other half. What makes "started" a single state rather than
        // four independent ones is that this whole block is synchronous and non-reentrant
        // — no caller can observe the half-written record between the two writes, and a
        // throw in `connectVoice` reaches the load `.catch`, which releases the record out
        // of the pool before anything can read it.
        record.startOffsetSeconds = schedule.entryOffsetSeconds;
        record.startedAtContextTime = startedAt;
        record.bufferDurationSeconds = buffer.duration;
        record.loopWindowSeconds = schedule.loop
            ? (schedule.loopWindow ?? { startSeconds: 0, endSeconds: buffer.duration })
            : null;

        try {
            if (!schedule.loop && schedule.playDurationSeconds !== null) {
                source.start(startedAt, schedule.entryOffsetSeconds, schedule.playDurationSeconds);
            } else {
                source.start(startedAt, schedule.entryOffsetSeconds);
            }
        } catch {
            this.releaseVoice(record, { stopSource: false });
            // A source that never started cannot be stopped; scheduling one throws.
            return;
        }

        // Only now — a voice whose `start()` was refused never played.
        record.phase = 'playing';

        if (schedule.playDurationSeconds !== null) {
            const stopAt = startedAt + schedule.playDurationSeconds;
            if (schedule.loop) {
                // On a looping voice `to` bounds ELAPSED PLAY DURATION, so the stop is
                // anchored to the real start — never `start()`'s third argument, whose
                // meaning under `loop` is not portable.
                try {
                    source.stop(stopAt);
                    record.scheduledStopAt = stopAt;
                } catch {
                    // Unschedulable on this platform. `scheduledStopAt` stays null so it
                    // never advertises an end that was not scheduled — but the caller
                    // asked for a bounded loop and is getting an unbounded one, so say
                    // so rather than letting the containment hide it.
                    console.warn(
                        `Audio voice could not schedule its stop at ${stopAt}s; the requested play bound is dropped and the voice will loop with no scheduled end.`,
                    );
                }
            } else {
                record.scheduledStopAt = stopAt;
            }
        } else if (!schedule.loop) {
            record.scheduledStopAt = startedAt + (buffer.duration - schedule.entryOffsetSeconds);
        }

        // Last, because every ramp below clamps against `scheduledStopAt`.
        this.applyPendingIntents(record, gainNode, startedAt);
    }

    /**
     * Precedence steps 2–4 of Invariant #121, at the voice's real start `t0`. Takes the
     * stage-1 `gainNode` as an argument rather than reading `record.gainNode`, so "no
     * ramp is ever scheduled against a null source" holds by construction rather than by
     * a guard someone could later drop. Each slot is cleared as it is consumed, so the
     * record never advertises an intent that has already been laid down.
     */
    private applyPendingIntents(record: VoiceRecord, gainNode: GainNode, startedAt: number): void {
        // The gain `startVoice` just wrote at `t0`. It has to be handed to the ramps
        // explicitly: `param.value` reports the last rendered quantum, so it cannot see a
        // write made in this same turn, and at `t0` the node has rendered nothing at all
        // and still reports its default of 1. Reading it back here is never an option, so
        // the value is threaded THROUGH each ramp rather than dropped after the first.
        let departure = initialVoiceGain(record);

        const fadeIn = record.pendingFadeIn;
        if (fadeIn !== null) {
            record.pendingFadeIn = null;
            const curve = fadeIn.curve ?? DEFAULT_FADE_CURVE;
            const ramp = resolveFadeInRamp(record, fadeIn.durationMs, startedAt, curve);
            scheduleVoiceRamp(
                record,
                gainNode.gain,
                ramp.target,
                startedAt,
                ramp.endTime,
                curve,
                departure,
            );
            // A ramp has not progressed at its own start time, so the gain the NEXT ramp
            // departs from is still the floor this one left — unless the fade-in named no
            // window at all, in which case it `setValueAtTime`s its target right there and
            // that target is the departure. Getting this backwards inverts the next curve.
            if (isInstantRamp(startedAt, ramp.endTime)) {
                departure = clampUnit(ramp.target);
            }
        }

        const fadeTo = record.pendingFadeTo;
        if (fadeTo !== null) {
            record.pendingFadeTo = null;
            // SUPERSEDES the fade-in rather than composing with it. Both ramps anchor at
            // the same `startedAt`, so this one's cancel-and-reanchor wipes the curve just
            // scheduled and the fade-in survives only as the gain this departs from: a
            // 2000 ms `fadeIn` followed by a pre-start `fadeTo` of 100 ms is a 100 ms ramp
            // from silence, not a 2000 ms one interrupted. That is what "applied in
            // precedence order" means here — later wins, on one shared `t0`.
            applyFadeToRamp(record, gainNode.gain, fadeTo, startedAt, departure);
        }

        const linkedFadeOut = record.linkedFadeOut;
        if (linkedFadeOut !== null) {
            record.linkedFadeOut = null;
            try {
                linkedFadeOut(startedAt);
            } catch {
                // A crossfade's outgoing voice is not this voice's problem to die over,
                // but the containment must still name what survived rather than hide it —
                // and it cannot promise an unfaded voice outright. `applyFadeOut` schedules
                // the stop and records it BEFORE laying the ramp, so a failure in the ramp
                // leaves a voice that is both unfaded and already cut short. The message
                // covers the outcome from either side of that line.
                console.warn(
                    'Audio linked fade-out failed and was skipped; the incoming voice started normally, so the outgoing one is left unfaded — cut at any stop the attempt had already rescheduled, otherwise playing on.',
                );
            }
        }
    }

    private releaseVoice(record: VoiceRecord, options: { readonly stopSource: boolean }): void {
        if (!this.voices.delete(record.handle.id) && !record.handle.valid) {
            return;
        }

        record.handle.invalidate();
        const source = record.source;
        if (source !== null) {
            source.onended = null;
            if (options.stopSource) {
                stopSource(source);
            }
            disconnectNode(source);
            record.source = null;
        }

        const gainNode = record.gainNode;
        if (gainNode !== null) {
            disconnectNode(gainNode);
            record.gainNode = null;
        }

        const pannerNode = record.pannerNode;
        if (pannerNode !== null) {
            disconnectNode(pannerNode);
            record.pannerNode = null;
        }

        // Last, and here rather than in each verb: this is the one release path every
        // way of ending a voice funnels through (Invariant #119), so it is the one place
        // an observation can be ended exactly once — and the graph is fully torn down
        // before a game handler runs, so an `onEnd` that plays another voice cannot find
        // this one half-disconnected.
        this.cueSampler.endVoice(record.handle.id);
    }

    private connectVoice(
        record: VoiceRecord,
        source: AudioBufferSourceNode,
        gainNode: GainNode,
    ): void {
        const busGainNode = this.getBus(record.handle.bus).gainNode;
        source.connect(gainNode);

        if (record.spatial === null) {
            gainNode.connect(busGainNode);
            return;
        }

        const pannerNode = this.audioContext.createPanner();
        record.pannerNode = pannerNode;
        configurePannerFromSpec(pannerNode, record.spatial);
        // A move parked while the voice loaded supersedes the authored start position
        // (Invariant #121); the slot is cleared as it is consumed, like the fades'.
        const startPosition = record.pendingPosition ?? record.spatial.position;
        record.pendingPosition = null;
        setPannerPosition(pannerNode, startPosition, this.audioContext.currentTime, true);
        gainNode.connect(pannerNode);
        pannerNode.connect(busGainNode);
    }

    private async toAudioBuffer(asset: ResolvedAsset<AudioClipAsset>): Promise<AudioBuffer | null> {
        if (isAudioBuffer(asset)) {
            return asset;
        }

        if (asset instanceof ArrayBuffer) {
            return this.audioContext.decodeAudioData(asset.slice(0));
        }

        return null;
    }

    private getBus(id: AudioBusId): AudioBus {
        const bus = this.buses.get(id);
        if (bus === undefined) {
            throw new Error(`AudioBus '${id}' is not registered.`);
        }
        return bus;
    }

    private createHandleId(): string {
        const id = `audio-${this.nextHandleId}`;
        this.nextHandleId += 1;
        return id;
    }
}

export function createAudioManager(
    assetManager: AssetManager,
    options?: AudioManagerOptions,
): AudioManager {
    return new DefaultAudioManager(assetManager, options);
}

class ManagedAudioHandle implements AudioHandle {
    private isValid = true;

    public constructor(
        public readonly id: string,
        public readonly ref: AssetRef<AudioClipAsset>,
        public readonly bus: AudioBusId,
        public readonly priority: number,
    ) {}

    public get valid(): boolean {
        return this.isValid;
    }

    public invalidate(): void {
        this.isValid = false;
    }
}

/**
 * Seconds knowable WITHOUT the decoded buffer: a finite raw number, `'start'`, or a
 * `{ name }` present in the parsed sheet. `null` means "defer to the dynamic tier" —
 * `'end'`, an absent cue name, or a non-finite number (Invariant #117).
 */
function resolveCueStatically(cue: Cue, sheet: AudioClipMetadata | null): number | null {
    if (cue === 'start') {
        return 0;
    }
    if (cue === 'end') {
        return null;
    }
    if (typeof cue === 'number') {
        return Number.isFinite(cue) ? cue : null;
    }

    const cues = sheet?.cues;
    if (cues === undefined) {
        return null;
    }
    // `cues` is a plain object, so a bare index reaches Object.prototype: `{ name:
    // 'constructor' }` hands back a FUNCTION through a `number`-typed slot. That is
    // corrective, not cosmetic — relational comparison of two functions ToPrimitives
    // BOTH to strings, so `constructor <= constructor` is TRUE and the order gate
    // below would statically reject a play that must defer. (A prototype name against
    // a real number mixes types and is always false, so only a same-kind pair shows it.)
    //
    // An own-key check is the only filter that ALSO survives a prototype polluted with
    // a numeric property — a `typeof`/`isFinite` test would happily return that — so it
    // is the one guard here rather than one of two. Own values need no further
    // validation: `parseAudioCueSheet` has already proved every one finite and in range.
    return Object.hasOwn(cues, cue.name) ? (cues[cue.name] ?? null) : null;
}

/**
 * Compare a pair of bounds on RAW, unclamped seconds. Clamping is monotone on every
 * live branch (`x < 0 → 0`, `x ∈ [0, d] → x`, `x > d → d` or abandon), so a raw
 * `end <= start` can never become a valid window once the buffer is known — which is
 * what makes the reject sound without `buffer.duration`. Comparing raw values is also
 * what keeps `[-3, 0]` out of the static tier: it is not ALREADY out of order.
 */
function staticOrderViolation(
    start: Cue,
    end: Cue,
    sheet: AudioClipMetadata | null,
): string | null {
    const startSeconds = resolveCueStatically(start, sheet);
    const endSeconds = resolveCueStatically(end, sheet);
    if (startSeconds === null || endSeconds === null) {
        return null;
    }
    return endSeconds <= startSeconds ? `[${startSeconds}s, ${endSeconds}s]` : null;
}

/** The static-tier verdict: a warning to log before rejecting, or `null` to proceed. */
function findStaticCueRejection(opts: PlayOptions, sheet: AudioClipMetadata | null): string | null {
    if (opts.to !== undefined) {
        // The `?? 'start'` default matters: without it `{ to: 0 }` escapes the gate.
        const violation = staticOrderViolation(opts.from ?? 'start', opts.to, sheet);
        if (violation !== null) {
            return `Audio play window ${violation} is already out of order; rejecting play().`;
        }
    }

    const region = opts.loopRegion;
    if (region !== undefined) {
        const violation = staticOrderViolation(region.start, region.end, sheet);
        if (violation !== null) {
            return `Audio loop region ${violation} is already out of order; rejecting play().`;
        }
    }

    return null;
}

/**
 * Resolve a looping voice's `[loopStart, loopEnd)` region. `null` abandons the play.
 *
 * Failure consequence is scoped by PROVENANCE, and the two authored intents are kept
 * separate. An explicit `loopRegion` is authored intent, so its load-bearing start
 * anchor abandons the play when unresolvable (Invariant #118). A collapsed region
 * cannot be honoured, but whether the voice still LOOPS depends on where the loop
 * intent came from: an explicit `loop: true` survives as a whole-buffer loop, while a
 * loop implied only by the region goes away with it. A sheet-supplied
 * `defaultLoopRegion` is an engine default the caller never asked for — it degrades to
 * a whole-buffer loop and can never silence a play the author only marked `loop`.
 *
 * @param loopRequestedExplicitly whether the caller passed `loop: true` in its own
 *   right, as opposed to `loop` being implied by `loopRegion`.
 */
function resolveLoopWindow(
    record: VoiceRecord,
    loopRequestedExplicitly: boolean,
    ctx: { readonly sheet: AudioClipMetadata | null; readonly duration: number },
): { readonly loop: boolean; readonly window: VoiceSchedule['loopWindow'] } | null {
    const region = record.loopRegion;
    if (region !== null) {
        const resolved = resolveCueWindow(region.start, region.end, ctx);
        if (resolved.kind === 'abandon') {
            // The play really is abandoned, so the resolver's outcome wording is
            // accurate; only its subject is missing, and with `from` also in play the
            // operator needs to know which bound failed.
            console.warn(`Audio loop region is unresolvable. ${resolved.warning}`);
            return null;
        }
        if (resolved.kind === 'dropped') {
            // The resolver's "dropping the window" wording describes a PLAY window. The
            // outcome here is narrower and must be named, along with which bounds
            // collapsed — the resolver's `dropped` variant carries no seconds back, so
            // re-resolve the end-point to report it.
            const end = resolveCue(region.end, { ...ctx, role: 'endpoint' });
            const endSeconds = end.kind === 'resolved' ? end.seconds : ctx.duration;
            const outcome = loopRequestedExplicitly
                ? 'looping the whole buffer instead'
                : 'disabling looping';
            console.warn(
                `Audio loop region end ${endSeconds}s is at or before its start after clamping to [0, ${ctx.duration}s]; ${outcome} and continuing playback.`,
            );
            return { loop: loopRequestedExplicitly, window: null };
        }
        return { loop: true, window: resolved };
    }

    const names = ctx.sheet?.defaultLoopRegion;
    if (names === undefined) {
        return { loop: true, window: null };
    }

    const resolved = resolveCueWindow({ name: names[0] }, { name: names[1] }, ctx);
    if (resolved.kind !== 'window') {
        // NEVER re-log the resolver's message here: its `abandon` variant says
        // "abandoning playback", and this path does the opposite. The caller asked only
        // for `loop: true`, so an engine-supplied default that no longer fits the
        // decoded clip degrades instead of silencing the play.
        console.warn(
            `Audio clip's defaultLoopRegion ["${names[0]}", "${names[1]}"] does not fit the decoded buffer [0, ${ctx.duration}s]; looping the whole buffer instead.`,
        );
        return { loop: true, window: null };
    }
    return { loop: true, window: resolved };
}

/**
 * Whether the voice STARTED with a loop window — the effective stand-in for "runs until
 * something else ends it", which is the property the preemption loop term is about. It
 * is a stand-in rather than the property itself: a `to`-bounded loop carries a window and
 * also schedules its own end, and counts as looping here regardless.
 *
 * Reading the effective window rather than {@link VoiceRecord.loop} is what keeps an
 * IMPLIED loop honest — a bare `loopRegion` that collapsed after clamping leaves the
 * requested intent `true` on a voice that plays once through and frees its slot, while an
 * explicit `loop: true` survives the same collapse as a whole-buffer loop and is reported
 * as looping (the provenance rule in {@link resolveLoopWindow}). Invariant #122 draws the
 * same effective-versus-requested distinction for fade timing.
 *
 * `loopWindowSeconds` is written by {@link DefaultAudioManager.startVoice}, so during
 * `'loading'` there is no effective answer yet and the requested intent stands in.
 * Treating that window as non-looping instead would misfile every voice still decoding —
 * and the longest decodes are exactly the music beds the term is named after, so a
 * voice's rank would turn on file size.
 */
function voiceLoops(record: VoiceRecord): boolean {
    return record.phase === 'loading' ? record.loop : record.loopWindowSeconds !== null;
}

/**
 * Order two voices for reclamation, worst standing first (Invariant #123): true when
 * `candidate` should be taken ahead of `selected`.
 *
 * Four terms, lexicographic:
 *
 * 1. `'fading-out'` — already dying, so cutting its tail costs the least. It partitions
 *    rather than flattens: the remaining terms still rank inside each half.
 * 2. Lower priority.
 * 3. Looping per {@link voiceLoops}, at EQUAL priority only. A loop runs until something
 *    else ends it, while an equally-important one-shot ends itself and cannot be
 *    re-triggered once its moment passes.
 * 4. Older sequence.
 *
 * Term 3 sits BELOW priority deliberately, and that placement is what makes
 * {@link MUSIC_PRIORITY} work: above it, no priority a game could name would lift a music
 * bed clear of a one-shot, and the constant the invariant names as the mechanism for
 * music continuity would be inert.
 *
 * Lexicographic over four per-record keys, so this is a strict total order — load-bearing,
 * because {@link DefaultAudioManager.findWorstStandingVoice} is a single-pass min-scan
 * over a `Map` that iterates in ascending `sequence`. Leave any pair incomparable and the
 * scan quietly promotes age to the deciding term, making the victim follow the play order.
 *
 * Term 1 is the PHASE, not "is this voice doomed": a voice carrying `releaseOnStart` is
 * condemned too — cheaper still, having never made a sound — but it is `'loading'` and
 * ranks as an ordinary voice. Invariant #123 names the phase and only the phase, so a
 * `crossfade` that condemned a {@link MUSIC_PRIORITY} bed before it started leaves that
 * bed outranking a live SFX voice right up until `t0` kills it anyway. Folding
 * `releaseOnStart` in would be a wider claim than the invariant makes.
 */
function voiceHasLowerPreemptionRank(candidate: VoiceRecord, selected: VoiceRecord): boolean {
    const candidateDying = candidate.phase === 'fading-out';
    const selectedDying = selected.phase === 'fading-out';
    if (candidateDying !== selectedDying) {
        return candidateDying;
    }

    if (candidate.handle.priority !== selected.handle.priority) {
        return candidate.handle.priority < selected.handle.priority;
    }

    const candidateLoops = voiceLoops(candidate);
    const selectedLoops = voiceLoops(selected);
    if (candidateLoops !== selectedLoops) {
        return candidateLoops;
    }

    return candidate.sequence < selected.sequence;
}

function normalizePoolSize(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
        return DEFAULT_POOL_SIZE;
    }

    return Math.max(1, Math.floor(value));
}

function normalizePriority(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
        return DEFAULT_PRIORITY;
    }

    return value;
}

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(1, Math.max(0, value));
}

/**
 * @internal The raw gain-ramp automation writer (§4.25, Invariant #120).
 *
 * A ramp on a VOICE's stage-1 gain goes through {@link scheduleVoiceRamp} instead, which
 * wraps this and records the bound that ramp travels within. Calling this directly on a
 * voice gain leaves {@link voiceCeiling} behind the automation, and the next fade departs
 * from a gain the voice is not at — the defect the wrapper exists to make unreachable.
 * Reach for this one only where there is no `VoiceRecord` to bound: the exported surface
 * is for the tests that drive the primitive's own curve and platform-degrade behaviour.
 *
 * Cancels any prior automation and re-anchors at the held value — preferring
 * `cancelAndHoldAtTime`, falling back to `cancelScheduledValues` + `setValueAtTime`
 * (the pattern {@link AudioBus.duck} uses) — then schedules a ramp to `target` over
 * `[startTime, endTime]` in the requested {@link FadeCurve}. It writes ONLY the passed
 * `AudioParam`; callers pass a voice's own stage-1 gain, so the per-bus and master
 * gains are never touched (Invariant #116). The `exponential` curve degrades to
 * linear when the platform lacks `exponentialRampToValueAtTime` or throws from it;
 * `equalPower` is composed from `linearRampToValueAtTime`, so it has nothing to
 * detect. The helper never throws: a `startTime` that is negative or non-finite is
 * a no-op, a non-finite or backwards `endTime` applies the target instantly, and a
 * `target` that is non-finite or outside `[0, 1]` is clamped into range. Both time
 * guards exist because a spec-compliant `AudioParam` throws `RangeError` on a
 * negative or non-finite time, and the fade verbs derive their times from authored
 * cue metadata.
 *
 * Precondition: `startTime` must not be in the future relative to
 * `AudioContext.currentTime` unless the caller KNOWS the departure independently. The
 * re-anchor reads `param.value`, which is the value at `currentTime`, so a future
 * `startTime` otherwise anchors the curve at a stale departure. A caller ramping from now
 * satisfies it by passing `audioContext.currentTime`, as {@link AudioBus.duck} does; the
 * ramps laid at a voice's own `t0` satisfy it by passing the gain they wrote there, which
 * holds however far ahead that `t0` is ({@link DefaultAudioManager.applyPendingIntents}).
 * A departure merely READ at `currentTime` and handed on — {@link rampDeparture} — does
 * not satisfy it: it is the same stale value arriving by another route.
 *
 * Pass `departure` whenever the caller knows the gain better than the getter can report
 * it. `param.value` reports `[[current value]]` — the parameter's value at the start of
 * the current render quantum — and a `setValueAtTime` scheduled in this same turn does
 * not move it, so reading it back anchors at the node's previous gain (a fresh
 * `GainNode` reports its `defaultValue` of 1). That misread is silent for a `linear`
 * ramp on the `cancelAndHoldAtTime` path, but `equalPower` derives every waypoint from
 * the departure and the fallback path writes it as an explicit anchor — so a fade-in
 * from silence would invert into a ramp down from full gain.
 *
 * A caller may know better for either of two reasons: it just WROTE the value (the fade-in
 * at `t0` passes the floor it laid down), or it can BOUND it ({@link rampDeparture} caps
 * the read at the voice's ceiling, since a stale read reports a gain the voice cannot be
 * at; {@link fadeOutDeparture} drops the read entirely for a ramp starting at a cue, where
 * it answers about the wrong instant rather than a stale quantum). Omit it only when
 * neither holds and the departure is genuinely unknown.
 */
export function scheduleGainRamp(
    param: AudioParam,
    target: number,
    startTime: number,
    endTime: number,
    curve: FadeCurve = 'linear',
    departure?: number,
): void {
    if (!isSchedulableStart(startTime)) {
        return;
    }

    const held = reanchorGain(param, startTime, departure);
    const clampedTarget = clampUnit(target);

    if (isInstantRamp(startTime, endTime)) {
        // Empty or backwards window: jump straight to the target, no ramp.
        param.setValueAtTime(clampedTarget, startTime);
        return;
    }

    if (curve === 'exponential' && typeof param.exponentialRampToValueAtTime === 'function') {
        try {
            scheduleExponentialRamp(param, held, clampedTarget, startTime, endTime);
            return;
        } catch {
            // Present but unusable on this platform — degrade to linear exactly as a
            // failed feature-detect does. Anything already written is a departure
            // anchor at startTime, which the linear ramp below then ramps away from.
        }
    }

    if (curve === 'equalPower') {
        scheduleEqualPowerRamp(param, held, clampedTarget, startTime, endTime);
        return;
    }

    // `linear`, plus the degrade path for an `exponential` ramp this platform cannot run.
    param.linearRampToValueAtTime(clampedTarget, endTime);
}

/**
 * Whether `startTime` is an anchor the automation methods will accept. A spec-compliant
 * `AudioParam` throws `RangeError` for a negative or non-finite time on every one of them,
 * including the cancel calls a reanchor makes, so {@link scheduleGainRamp} writes nothing
 * at all for such a time — and {@link scheduleVoiceRamp} records nothing for it either.
 * Shared so the write and the bookkeeping that describes it cannot disagree about which
 * times are real.
 */
function isSchedulableStart(startTime: number): boolean {
    return Number.isFinite(startTime) && startTime >= 0;
}

/**
 * Whether a window names no ramp at all, so {@link scheduleGainRamp} applies its target
 * instantly with a `setValueAtTime` at `startTime` instead. Shared with the callers that
 * need to know which gain the param ends up holding there — a ramp leaves its departure
 * behind at `startTime`, an instant application leaves its target.
 */
function isInstantRamp(startTime: number, endTime: number): boolean {
    return !Number.isFinite(endTime) || endTime <= startTime;
}

/**
 * Cancels prior automation and returns the held departure value. Prefers
 * `cancelAndHoldAtTime` (which holds the running curve's value); if it is absent
 * or throws, falls back to `cancelScheduledValues` + an explicit `setValueAtTime`
 * anchor — matching {@link AudioBus.duck}. A caller-supplied `departure` wins over
 * `param.value` on BOTH paths: the getter cannot see automation scheduled in this same
 * turn, and the fallback path's `cancelScheduledValues` would in any case drop the
 * caller's own anchor event before it could take effect.
 */
function reanchorGain(param: AudioParam, startTime: number, departure?: number): number {
    if (typeof param.cancelAndHoldAtTime === 'function') {
        try {
            param.cancelAndHoldAtTime(startTime);
            return departure ?? param.value;
        } catch {
            // Unsupported on this platform — fall through to the manual reanchor.
        }
    }

    param.cancelScheduledValues(startTime);
    const held = departure ?? param.value;
    param.setValueAtTime(held, startTime);
    return held;
}

/**
 * Exponential ramp with both endpoints clamped off zero to {@link GAIN_RAMP_EPSILON},
 * because exponential automation is undefined through zero — the curve is defined by
 * a ratio, so neither endpoint can be 0. A legitimately-zero departure therefore falls
 * back to linear (nothing can leave zero exponentially); a legitimately-zero target
 * ramps to the epsilon then hard-sets true zero, which is inaudible but exact.
 */
function scheduleExponentialRamp(
    param: AudioParam,
    held: number,
    target: number,
    startTime: number,
    endTime: number,
): void {
    if (held <= 0) {
        // Departure is legitimately 0 — an exponential ramp cannot start from zero.
        param.linearRampToValueAtTime(target, endTime);
        return;
    }

    if (held < GAIN_RAMP_EPSILON) {
        param.setValueAtTime(GAIN_RAMP_EPSILON, startTime);
    }

    if (target <= 0) {
        param.exponentialRampToValueAtTime(GAIN_RAMP_EPSILON, endTime);
        param.setValueAtTime(0, endTime);
        return;
    }

    param.exponentialRampToValueAtTime(Math.max(target, GAIN_RAMP_EPSILON), endTime);
}

/**
 * Equal-power ramp as a piecewise-linear quarter-wave of
 * {@link EQUAL_POWER_WAYPOINTS} `linearRampToValueAtTime` waypoints — never
 * `setValueCurveAtTime`, which does not compose with cancellation. The waypoints
 * depart from the re-anchored `held` value, so the curve is click-free after a
 * cancel-and-reanchor, and the final waypoint lands exactly on `target`/`endTime`.
 */
function scheduleEqualPowerRamp(
    param: AudioParam,
    held: number,
    target: number,
    startTime: number,
    endTime: number,
): void {
    const span = endTime - startTime;
    const rising = target >= held;
    for (let waypoint = 1; waypoint <= EQUAL_POWER_WAYPOINTS; waypoint += 1) {
        const progress = waypoint / EQUAL_POWER_WAYPOINTS;
        const value =
            waypoint === EQUAL_POWER_WAYPOINTS
                ? target
                : equalPowerValue(held, target, rising, progress);
        param.linearRampToValueAtTime(value, startTime + span * progress);
    }
}

/**
 * The equal-power quarter-wave sample at `progress` ∈ (0, 1): `sin` easing for a
 * rising fade-in, `cos` easing for a falling fade-out. Direction-awareness is what
 * makes a symmetric crossfade complementary — incoming `sin` and outgoing `cos`
 * keep `g_in² + g_out²` constant with no mid-fade dip (§4.25, Invariant #120).
 */
function equalPowerValue(held: number, target: number, rising: boolean, progress: number): number {
    const quarter = (progress * Math.PI) / 2;
    return rising
        ? held + (target - held) * Math.sin(quarter)
        : target + (held - target) * Math.cos(quarter);
}

/** A voice's stage-1 gain at `t0`: its `volume`, or a fade-in's {@link fadeInFloor}. */
function initialVoiceGain(record: VoiceRecord): number {
    const fadeIn = record.pendingFadeIn;
    return fadeIn === null ? record.volume : fadeInFloor(fadeIn.curve ?? DEFAULT_FADE_CURVE);
}

/**
 * The gain a fade-in departs from. Exponential automation is defined by a ratio and so
 * cannot leave zero — {@link scheduleGainRamp} falls back to linear when the departure
 * is 0, which would silently discard an authored `exponential` fade-in. That curve
 * therefore departs from the same `1e-4` epsilon (−80 dB, inaudible) the primitive
 * already clamps its endpoints to; every other curve departs from true silence.
 */
function fadeInFloor(curve: FadeCurve): number {
    return curve === 'exponential' ? GAIN_RAMP_EPSILON : 0;
}

/**
 * The gain a fade-out departs from, for a ramp starting at `startTime` against a clock
 * reading `now`. The two coincide for every fade-out taken at the call; a cue-aligned one
 * puts `startTime` AHEAD of the clock, and that is the whole reason this exists.
 *
 * At a future anchor `AudioParam.value` answers about the wrong INSTANT, not merely about a
 * stale quantum: it reports where the gain is now, while the ramp departs from where the
 * gain will be at the cue. Mixing it in is the under-estimate {@link rampDeparture}'s cap
 * exists to prevent, arriving by the other route — a voice one second into a five-second
 * fade-in would have its cue-aligned fade-out depart from near the floor and step DOWN to
 * it, from a gain that will by then have climbed to `volume`.
 *
 * So the param is dropped there and the bound that applies AT the anchor is taken instead:
 * a {@link CeilingHold} still travelling then, otherwise the settled ceiling. Exact for an
 * ordinary voice and for any ramp that has landed by the cue, and a bounded OVER-estimate
 * for one still in flight — the only safe direction, and the same trade
 * {@link rampDeparture} makes for its own read. {@link VoiceRecord.settledGain} needs no
 * arm of its own here: every instant application that writes it leaves it at or below the
 * ceiling this returns.
 */
function fadeOutDeparture(
    record: VoiceRecord,
    gain: AudioParam,
    startTime: number,
    now: number,
): number {
    return startTime > now
        ? voiceCeiling(record, startTime)
        : rampDeparture(record, gain, startTime);
}

/**
 * The gain a fade verb on a LIVE voice departs from: what the param reports, capped at the
 * voice's own ceiling — or {@link VoiceRecord.settledGain} outright, on the one path where
 * the gain is known rather than estimated. Reached by {@link DefaultAudioManager.fadeTo}
 * directly and by every fade-out through {@link fadeOutDeparture}, which answers for a
 * ramp starting at a cue itself; the ramps laid down at `t0` need none of it,
 * because they know the gain written there exactly — {@link initialVoiceGain} as
 * `startVoice` set it, or an instant fade-in's own target where one landed over it.
 *
 * The cap is not defensive. `AudioParam.value` reports `[[current value]]` — the value
 * at the START of the current render quantum — so a gain written in this same one is
 * invisible to it, and a `GainNode` that has not yet rendered reports its `defaultValue`
 * of 1. `cancelAndHoldAtTime` pins the PARAM's own value correctly and cannot help:
 * `equalPower` derives every waypoint from this number JS-side, and the fallback
 * re-anchor writes it as an explicit `setValueAtTime`. Left uncapped, a fade-OUT of a
 * `volume: 0.5` voice would ramp UP to ~1.0 in its first waypoint before falling — a
 * swell to double the requested volume — and on a platform without
 * `cancelAndHoldAtTime` it would step there outright, on every curve.
 *
 * A voice's stage-1 gain never exceeds {@link voiceCeiling} — above the `1e-4` epsilon
 * floor, which {@link fadeInFloor} and {@link scheduleExponentialRamp} may write over a
 * smaller ceiling, inaudibly at −80 dB. So capping the read is exact whenever the param can
 * see the truth and a bounded OVER-estimate when it cannot. Over-estimating is the only
 * safe direction: it degrades into the artifact below, whereas an under-estimate is a step
 * DOWN to a gain the voice was never at, which is what this exists to prevent.
 *
 * The residual it does NOT fix: inside the first quantum of a fade-in the voice's real
 * gain is the curve's floor while the param still reports 1, so a fade departing there
 * starts from the ceiling and moves to it first — a smaller version of the same artifact,
 * bounded now by what the caller asked for rather than by the node's default of 1. Passing
 * `record.volume` unconditionally would cause that on EVERY mid-fade voice, which is why
 * this reads the param first and only caps it.
 *
 * What keeps the cap honest across a ceiling CHANGE is split in two.
 * {@link DefaultAudioManager.fadeTo} installs its absolute target as the new `volume`,
 * after computing this, so the cap still names the ceiling being replaced; and
 * {@link scheduleVoiceRamp} records a {@link CeilingHold} for every non-instant ramp, in
 * either direction and whichever verb wrote it, so the window before that ramp lands is
 * never capped against a gain the voice has not reached.
 */
function rampDeparture(record: VoiceRecord, gain: AudioParam, now: number): number {
    // Nothing to estimate while the last write was an instant one: `settledGain` IS the
    // gain, and reading the param instead would take a value from before that write.
    return record.settledGain ?? Math.min(gain.value, voiceCeiling(record, now));
}

/**
 * The highest stage-1 gain the voice can be at `now`: an unexpired {@link CeilingHold}
 * while a ramp is in flight, otherwise its settled ceiling.
 *
 * Pure expiry — the hold wins OUTRIGHT rather than through a `max` against `volume`,
 * because it names the in-flight ramp's own two endpoints and is therefore a complete
 * bound by itself; `volume` is simply not the operative fact until it expires. Nor would a
 * `max` be merely redundant: a hold can legitimately sit BELOW the settled ceiling — a
 * truncated fade-in climbs to less than `volume` — and there the tighter bound is the
 * point, so a `max` would discard it.
 */
function voiceCeiling(record: VoiceRecord, now: number): number {
    const hold = record.ceilingHold;
    return hold === null || now >= hold.until ? record.volume : hold.bound;
}

/**
 * The one write both `fadeTo` paths make: ramp `gain` to the clamped absolute target over
 * the resolved window, and install that target as the voice's new ceiling (§4.25).
 *
 * Only the WINDOW clamps against the voice's scheduled end, never the target — the reason
 * is authored surface and lives on {@link FadeToSpec} and
 * {@link DefaultAudioManager.fadeTo}.
 *
 * `departure` is a parameter rather than something this derives, and that is the point: it
 * has to name the gain the voice is at under the ceiling being REPLACED. Computed against
 * the one installed below, {@link rampDeparture}'s cap would rise with the target and let a
 * stale `param.value` through on every swell — the voice would start its ramp already at
 * `to`. Taking it as an argument is what forces every caller to read it first.
 */
function applyFadeToRamp(
    record: VoiceRecord,
    gain: AudioParam,
    spec: FadeToSpec,
    startTime: number,
    departure: number,
): void {
    const target = clampUnit(spec.to);
    const endTime = resolveFadeToRampEnd(record, spec.durationMs, startTime);
    // The ceiling moves at ramp start while the GAIN only arrives at it at `endTime`;
    // recording the window it travels in is `scheduleVoiceRamp`'s job. But it describes
    // that ramp as much as the bound does, so it moves only once the ramp is real — a
    // ceiling LOWERED for automation that was never written would tighten the cap onto a
    // gain the voice is still above.
    const written = scheduleVoiceRamp(
        record,
        gain,
        target,
        startTime,
        endTime,
        spec.curve ?? DEFAULT_FADE_CURVE,
        departure,
    );
    if (written) {
        record.volume = target;
    }
}

/**
 * Schedule a stage-1 ramp on a live voice and record the bound it travels within — the one
 * entry point every voice ramp goes through, so {@link voiceCeiling} cannot fall behind a
 * verb that forgot to update it (§4.25, Invariant #120).
 *
 * The bound is the higher of the ramp's two endpoints, which is exact because every curve
 * {@link scheduleGainRamp} writes is monotonic between them. Taking both ends rather than
 * the departure alone is what makes it complete in either direction: a RISING ramp is above
 * its departure for the whole window exactly as a falling one is above its target.
 *
 * An instant application bounds nothing, because there is no window to bound — and its
 * `endTime` may be `+Infinity`, a deadline no `currentTime` ever passes, which would leave
 * the headroom in place for the life of the voice. It records the opposite instead: the
 * gain it lands is EXACT until the next automation, and this is the only place that can
 * know it, since `param.value` cannot see a write made in this same turn.
 *
 * Being the single writer of both fields is what keeps each one true for exactly as long
 * as it is set: every ramp invalidates the settled value, and every instant application
 * retires the bound.
 *
 * Returns whether the automation was written. Both fields DESCRIBE that write, so an
 * unschedulable `startTime` — which {@link scheduleGainRamp} declines entirely — records
 * neither and reports `false`, leaving the caller's own bookkeeping to stand down too. The
 * settled gain is the reason this cannot be left to the callee's silent no-op: it is
 * believed OUTRIGHT by the next departure rather than merely capping a read, so one
 * booked against automation that never happened would swell the next fade to it.
 */
function scheduleVoiceRamp(
    record: VoiceRecord,
    gain: AudioParam,
    target: number,
    startTime: number,
    endTime: number,
    curve: FadeCurve,
    departure: number,
): boolean {
    if (!isSchedulableStart(startTime)) {
        return false;
    }

    if (isInstantRamp(startTime, endTime)) {
        record.ceilingHold = null;
        record.settledGain = target;
    } else {
        record.ceilingHold = { bound: Math.max(departure, target), until: endTime };
        record.settledGain = null;
    }
    scheduleGainRamp(gain, target, startTime, endTime, curve, departure);
    return true;
}

/**
 * The absolute context time a `fadeTo` ramp reaches its target. A non-finite window names
 * no fade at all and is handed straight to {@link scheduleGainRamp}'s own guard, which
 * applies the target instantly — resolved BEFORE the clamp, which is what would otherwise
 * split the two non-finite inputs apart: `NaN` falls through to that instant application
 * while `+Infinity` clamps to a bounded voice's scheduled end and becomes a full-length
 * fade. Same garbage input, opposite outcomes.
 *
 * No floor at `now`, unlike a fade-out's: this time never reaches `source.stop`, and a
 * window that resolves behind `startTime` is an instant application by the same guard.
 */
function resolveFadeToRampEnd(record: VoiceRecord, durationMs: number, startTime: number): number {
    const authoredEnd = startTime + durationMs / 1000;
    return Number.isFinite(authoredEnd) ? clampRampEnd(record, authoredEnd) : authoredEnd;
}

/**
 * The nodes and timeline a fade verb writes against, or `null` while the voice is still
 * `'loading'`. All four fields are `null` until `startVoice` writes them in one block at
 * `t0`, and a record whose nodes have been dropped was deleted from `voices` first — so
 * this is ONE state test, spelled four ways because TypeScript needs each narrowed.
 */
function startedVoice(record: VoiceRecord): StartedVoice | null {
    const { source, gainNode, startedAtContextTime, bufferDurationSeconds } = record;
    if (
        source === null ||
        gainNode === null ||
        startedAtContextTime === null ||
        bufferDurationSeconds === null
    ) {
        return null;
    }

    return { source, gainNode, startedAtContextTime, bufferDurationSeconds };
}

/** A fade-out's ramp end, with any message that must not be printed before its stop is. */
interface FadeOutRamp {
    /** The absolute context time the ramp reaches `0`. */
    readonly rampEnd: number;
    /**
     * Held for {@link DefaultAudioManager.applyFadeOut} to print once `source.stop(rampEnd)`
     * is accepted, because it narrates a fade the refusal path cancels. A diagnosis that
     * survives that path is printed where it is found instead — see
     * {@link resolveAuthoredFadeOutEnd} for the one that does.
     */
    readonly deferredWarning: string | null;
}

/**
 * The absolute context time a fade-out ramps to, for every {@link FadeOutSpec} variant.
 * `min`-clamped against the voice's scheduled end and then floored at `now`, in that
 * order, so it is never `NaN` and never in the past — the value goes straight to
 * `source.stop`, which a spec-compliant node refuses for a negative or non-finite time.
 *
 * Three inputs fade over an empty window — an instant silence — and none of them lengthens
 * the voice's remaining life. They do not all need the floor: a `{ toCue }` the playhead
 * will not reach again and a zero `overMs` land ON `now` unaided, so the floor merely ties
 * them. What it rescues is the two that resolve strictly BEHIND `now` — a negative `overMs`
 * and a scheduled stop that has elapsed without its `onended` having been delivered yet.
 */
function resolveFadeOutRampEnd(
    record: VoiceRecord,
    started: StartedVoice,
    spec: FadeOutSpec,
    verb: FadeOutVerb,
    now: number,
): FadeOutRamp {
    const { rampEnd: authoredEnd, deferredWarning } = resolveAuthoredFadeOutEnd(
        record,
        started,
        spec,
        verb,
        now,
    );
    if (!Number.isFinite(authoredEnd)) {
        // A non-finite window names no fade at all, so the voice is silenced and
        // stopped now. Handled BEFORE the clamp, which is what would otherwise split
        // the two non-finite inputs apart: `NaN` falls through to an instant stop while
        // `+Infinity` clamps to a bounded voice's scheduled end and becomes a
        // full-length fade — same garbage input, opposite outcomes.
        return { rampEnd: now, deferredWarning };
    }

    // `max(now, …)` rather than a second guard: a negative `overMs` and a scheduled end
    // already behind us mean the same thing here as a cue that has passed.
    return { rampEnd: Math.max(now, clampRampEnd(record, authoredEnd)), deferredWarning };
}

/**
 * The ramp end each variant ASKS for, before clamping. May be non-finite.
 *
 * `verb` names the caller in the two diagnostics below — see {@link FadeOutVerb}.
 */
function resolveAuthoredFadeOutEnd(
    record: VoiceRecord,
    started: StartedVoice,
    spec: FadeOutSpec,
    verb: FadeOutVerb,
    now: number,
): FadeOutRamp {
    if ('overMs' in spec) {
        return { rampEnd: now + spec.overMs / 1000, deferredWarning: null };
    }

    if ('toEnd' in spec) {
        const scheduledStopAt = record.scheduledStopAt;
        if (scheduledStopAt !== null) {
            return { rampEnd: scheduledStopAt, deferredWarning: null };
        }
        // No scheduled end, so there is nothing to ramp to. Substituting a short fade is
        // the fail-soft outcome, but a caller who asked to fade "to the end" is getting
        // something else entirely, so say which. The message states the observable fact
        // and does not name a cause: an unbounded loop reaches this, and so does a
        // BOUNDED loop whose `source.stop` `startVoice` could not schedule — that voice
        // warned once already, and guessing between the two here would name the wrong one
        // half the time.
        //
        // DEFERRED rather than printed here, because that second cause is a platform that
        // refuses `stop(when)` — and it will refuse this fade's stop too, cancelling the
        // substitution this message promises.
        return {
            rampEnd: now + DEFAULT_FADE_OUT_MS / 1000,
            deferredWarning: `Audio ${verb} { toEnd } found no scheduled end on this voice; fading out over ${DEFAULT_FADE_OUT_MS}ms instead.`,
        };
    }

    // `{ toCue }` — an end-point by nature, so it clamps to `[0, duration]` and never
    // abandons, exactly as `play()` resolves its `to`.
    const cueSeconds = resolveEndpointCueSeconds(record, started, spec.toCue);
    const cueContextTime = nextCueContextTime(record, started, cueSeconds, now);
    if (cueContextTime !== null) {
        return { rampEnd: cueContextTime, deferredWarning: null };
    }

    // Both the AUTHORED cue and what it resolved to, because they can differ: an absent
    // `{ name }` degrades to the buffer end without a warning of its own (Invariant
    // #118). That end stays REACHABLE on a non-looping voice and on a whole-buffer loop,
    // where a typo is therefore a silent full-length fade that never arrives here; it
    // arrives only on a voice whose loop window is shorter than its buffer, where the
    // degraded end lands past `loopEnd`. There a message naming only the seconds would
    // leave the operator no way back to the call that caused it.
    console.warn(
        `Audio ${verb} cue ${describeCue(spec.toCue)} resolved to ${cueSeconds}s, which this voice never reaches again (${describeVoiceTimeline(record)}); silencing and stopping the voice without a fade.`,
    );
    // Printed here, not deferred: it names no instant, so it stays true whichever way the
    // stop goes — the refusal path stops the voice at once, and a cue-aligned fade begins
    // the whole empty window ahead of the clock.
    return { rampEnd: now, deferredWarning: null };
}

/**
 * A cue resolved on THIS voice's decoded timeline under END-POINT rules: it clamps to
 * `[0, duration]` and never abandons, so an absent `{ name }` degrades to the decoded end
 * rather than taking the op down with it (Invariant #118).
 *
 * Shared, so that a cue named to two verbs resolves to one number rather than to opinions
 * that happen to agree today.
 */
function resolveEndpointCueSeconds(record: VoiceRecord, started: StartedVoice, cue: Cue): number {
    const resolution = resolveCue(cue, {
        sheet: record.sheet,
        duration: started.bufferDurationSeconds,
        role: 'endpoint',
    });
    // An endpoint never abandons; the fallback keeps the union exhaustive for TS.
    return resolution.kind === 'resolved' ? resolution.seconds : started.bufferDurationSeconds;
}

/**
 * An authored {@link Cue} as written at the call site, for a warning — each variant
 * rendered in its own source syntax so the text can be searched for verbatim. A numeric
 * cue reads back redundantly when nothing clamped it (`cue 4s resolved to 4s`); that is
 * the point, since the pair is what shows whether resolution moved it.
 */
function describeCue(cue: Cue): string {
    if (typeof cue === 'number') {
        return `${cue}s`;
    }
    return typeof cue === 'string' ? `'${cue}'` : `{ name: "${cue.name}" }`;
}

/** The schedule facts that decide whether a cue is still ahead, for a warning. */
function describeVoiceTimeline(record: VoiceRecord): string {
    const window = record.loopWindowSeconds;
    const entry = `entered at ${record.startOffsetSeconds}s`;
    return window === null
        ? `${entry}, not looping`
        : `${entry}, loop window [${window.startSeconds}s, ${window.endSeconds}s]`;
}

/**
 * Clamp a ramp end to the voice's scheduled end. The authored bound is authoritative and
 * a fade never extends it (§4.25); a voice with no scheduled end — an unbounded loop, or
 * a bounded one whose stop could not be scheduled — has nothing to clamp against.
 */
function clampRampEnd(record: VoiceRecord, rampEnd: number): number {
    const scheduledStopAt = record.scheduledStopAt;
    return scheduledStopAt === null ? rampEnd : Math.min(rampEnd, scheduledStopAt);
}

/**
 * A fade-in's window and target, TRUNCATED rather than compressed when it outlasts the
 * voice's scheduled end. What a fade-in authors is a RATE, so a shorter window has to
 * lower the target — the alternative, holding the target at `volume`, would steepen the
 * curve into a faster fade the caller never asked for and reach full volume at the exact
 * instant the source stops. A truncated fade-in may therefore never reach `volume`
 * (§4.25, Invariant #121).
 */
function resolveFadeInRamp(
    record: VoiceRecord,
    durationMs: number,
    startedAt: number,
    curve: FadeCurve,
): { readonly endTime: number; readonly target: number } {
    const authoredEnd = startedAt + durationMs / 1000;
    if (!Number.isFinite(authoredEnd)) {
        // A non-finite duration names no window at all, so it is not a fade — hand the
        // non-finite end straight to scheduleGainRamp's own guard, which applies the
        // target instantly. Handled BEFORE the clamp, because clamping is what would
        // otherwise split the two non-finite inputs apart: `NaN` falls through to an
        // instant full-volume set, while `+Infinity` on a bounded voice clamps to zero
        // progress and holds the floor for the voice's whole life. Same garbage input,
        // opposite outcomes, one of them silence.
        return { endTime: authoredEnd, target: record.volume };
    }

    const clampedEnd = clampRampEnd(record, authoredEnd);
    if (clampedEnd >= authoredEnd) {
        return { endTime: authoredEnd, target: record.volume };
    }

    // Reaching here means the scheduled end fell strictly inside the authored window, so
    // the span below is positive — every writer of `scheduledStopAt` puts it at or after
    // the start. `clampUnit` is what keeps a future writer that broke that from producing
    // a nonsense target rather than a crash.
    const progress = clampUnit((clampedEnd - startedAt) / (authoredEnd - startedAt));
    return {
        endTime: clampedEnd,
        target: fadeCurveValue(curve, fadeInFloor(curve), record.volume, progress),
    };
}

/**
 * The value a fade curve holds `progress` of the way from `from` to `to`. Used to
 * truncate a clamped fade-in along the curve it authored rather than along a straight
 * line through it.
 *
 * What this fixes exactly is the ENDPOINT — the gain the voice has reached when it is
 * cut off. `linear` and `exponential` are self-similar under the shortened window, so
 * the truncated ramp also traces the authored path; an `equalPower` quarter-wave is not,
 * so it re-eases over the shorter window to the same endpoint. Matching the path there
 * too would need a sub-curve `scheduleGainRamp` has no way to express, and the pairing
 * that makes `equalPower` worth having is a crossfade's two curves, not one fade's tail.
 *
 * The `to > 0` condition on the exponential branch mirrors the target half of
 * {@link scheduleExponentialRamp}'s own zero handling, so the truncated target and the
 * ramp actually scheduled agree in shape. Its departure half needs no mirror here: the
 * only departure this is ever called with is {@link fadeInFloor}, which for
 * `exponential` is the non-zero epsilon precisely so that ramp cannot degrade. The two
 * can still diverge on a platform where `exponentialRampToValueAtTime` is present but
 * throws; the endpoint stays below `volume` either way, which is the property that
 * matters.
 */
function fadeCurveValue(curve: FadeCurve, from: number, to: number, progress: number): number {
    if (curve === 'equalPower') {
        return equalPowerValue(from, to, to >= from, progress);
    }

    if (curve === 'exponential' && to > 0) {
        // Geometric interpolation — the shape `exponentialRampToValueAtTime` traces.
        return from * Math.pow(to / from, progress);
    }

    return from + (to - from) * progress;
}

function isAudioBuffer(value: unknown): value is AudioBuffer {
    if (typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer) {
        return true;
    }

    if (!isRecord(value) || value instanceof ArrayBuffer) {
        return false;
    }

    return (
        typeof value['duration'] === 'number' &&
        typeof value['length'] === 'number' &&
        typeof value['numberOfChannels'] === 'number' &&
        typeof value['sampleRate'] === 'number' &&
        typeof value['getChannelData'] === 'function'
    );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function stopSource(source: AudioBufferSourceNode): void {
    try {
        source.stop();
    } catch {
        // Stopping an already-ended source may throw; teardown remains best-effort.
    }
}

function disconnectNode(node: AudioNode): void {
    try {
        node.disconnect();
    } catch {
        // Disconnecting an already-detached node may throw; teardown remains best-effort.
    }
}

/**
 * Write the resolved spatial spec onto the panner, field for field — the resolver
 * already mapped the authored options into the panner's own vocabulary, so nothing
 * here computes anything. Every distance attribute is written unconditionally, the
 * `distanceModel` included: the ENGINE default is `'linear'` while `createPanner()`
 * starts at `'inverse'`, so leaving an attribute to the platform would silently ship
 * the divergence this feature exists to avoid (see {@link SpatialOptions.falloff}).
 *
 * `panningModel` is PINNED to `'equalpower'` rather than resolved from anything:
 * {@link SpatialOptions} deliberately cannot name it. HRTF costs convolution per voice
 * against a 32-voice pool and buys little for a top-down or side-on camera, so the pin
 * is written explicitly — never left to the platform default it happens to equal —
 * and the option surface keeps it unauthorable.
 *
 * Spatial attenuation is the panner's own gain, sitting between stage 1 and stage 2 of
 * the voice chain: nothing here writes any gain-stage `AudioParam`, so every fade,
 * duck and cue op behaves identically with a panner in the chain (Invariant #116).
 */
function configurePannerFromSpec(pannerNode: PannerNode, spec: ResolvedSpatialSpec): void {
    pannerNode.panningModel = 'equalpower';
    pannerNode.distanceModel = spec.distanceModel;
    pannerNode.refDistance = spec.refDistance;
    pannerNode.maxDistance = spec.maxDistance;
    pannerNode.rolloffFactor = spec.rolloffFactor;
}

/**
 * Seconds a RAMPED positional write travels over — the anti-zipper window shared by
 * every positional `AudioParam` write that is not anchoring a fresh voice. A step change
 * to a position modulates the panner's gains discontinuously, which is audible as a
 * zipper/click; a ramp this short is not audible as movement. A power-of-two
 * fraction (2^-4 = 62.5 ms), so `now + POSITIONAL_RAMP_SECONDS` is exact in double
 * precision and tests pin ramp ends against literals.
 */
const POSITIONAL_RAMP_SECONDS = 2 ** -4;

/**
 * Feature-detect one positional `AudioParam`. The DOM lib types these as always
 * present, but runtimes differ — older WebKit listeners carry only the deprecated
 * verbs — so presence AND all three methods the writes use are checked; a
 * half-present shim degrades to the legacy path exactly like a missing param.
 */
function isWritableAudioParam(value: AudioParam | undefined): value is AudioParam {
    return (
        typeof value?.setValueAtTime === 'function' &&
        typeof value.linearRampToValueAtTime === 'function' &&
        typeof value.cancelScheduledValues === 'function'
    );
}

/**
 * One positional `AudioParam` write: cancel prior automation, then ramp to `value`
 * over {@link POSITIONAL_RAMP_SECONDS} — or set it at `now` when `immediate`, for a
 * teleport where a ramp would smear the discontinuity into an audible sweep.
 *
 * The ramp anchors at `param.value`, which cannot see a write made in this same turn
 * — the staleness the GAIN tier goes to lengths to cap ({@link rampDeparture}).
 * Positional params tolerate it: a stale anchor puts the ramp's START a hair off
 * while its END lands exactly, no curve derives waypoints from the departure here,
 * and the next quantum's rendered position converges on the target regardless.
 */
function writePositionalParam(
    param: AudioParam,
    value: number,
    now: number,
    immediate: boolean,
): void {
    param.cancelScheduledValues(now);
    if (immediate) {
        param.setValueAtTime(value, now);
        return;
    }
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + POSITIONAL_RAMP_SECONDS);
}

/**
 * The deprecated listener verbs, for platforms without positional `AudioParam`s.
 * Both wrapped: `setPosition`/`setOrientation` may themselves be missing or throw,
 * and `setListener` promises never to throw into the caller — a platform with no
 * writable path at all degrades to a silent no-op, there being nothing left to
 * degrade to.
 */
function setListenerPoseLegacy(listener: AudioListener, pose: ResolvedListenerPose): void {
    const legacyListener = listener as AudioListener & {
        readonly setPosition?: (x: number, y: number, z: number) => void;
        readonly setOrientation?: (
            x: number,
            y: number,
            z: number,
            upX: number,
            upY: number,
            upZ: number,
        ) => void;
    };
    try {
        legacyListener.setPosition?.(...pose.position);
        legacyListener.setOrientation?.(...pose.forward, ...pose.up);
    } catch {
        // Nothing left to degrade to; the pose is dropped rather than thrown.
    }
}

/**
 * Write a panner's position — immediate at a voice's start (nothing audible yet to
 * zipper) and for a teleport, ramped over the anti-zipper window when a live source
 * moves. Takes the same feature-detected path as the listener pose, so a platform
 * without positional `AudioParam`s reaches its deprecated `setPosition` for both.
 * The legacy verb has no ramp to offer, so a ramped move degrades to a step there —
 * the platform's own limitation, not a new behaviour.
 */
function setPannerPosition(
    pannerNode: PannerNode,
    position: AudioPosition,
    currentTime: number,
    immediate: boolean,
): void {
    const params = [pannerNode.positionX, pannerNode.positionY, pannerNode.positionZ];
    if (params.every(isWritableAudioParam)) {
        try {
            params.forEach((param, index) => {
                writePositionalParam(param, position[index] ?? 0, currentTime, immediate);
            });
            return;
        } catch {
            // Present but unusable — fall through to the deprecated verb.
        }
    }

    const legacyPanner = pannerNode as PannerNode & {
        readonly setPosition?: (x: number, y: number, z: number) => void;
    };
    try {
        legacyPanner.setPosition?.(...position);
    } catch {
        // A panner with no writable position stays at the origin rather than throwing
        // out of startVoice.
    }
}

function createAudioContext(): AudioContext {
    const AudioContextConstructor = getAudioContextConstructor();
    if (AudioContextConstructor === null) {
        throw new Error('AudioContext is not available in this environment.');
    }

    return new AudioContextConstructor();
}

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
    const audioGlobal = globalThis as typeof globalThis & {
        readonly AudioContext?: AudioContextConstructor;
        readonly webkitAudioContext?: AudioContextConstructor;
    };

    return audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext ?? null;
}
