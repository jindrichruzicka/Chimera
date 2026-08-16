import type { AudioClipMetadata } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../assets/AssetManager';
import { AudioBus, type AudioBusId, type AudioBusOptions } from './AudioBus';
import { parseAudioCueSheet, resolveCue, resolveCueWindow } from './audioCueSheet';
import type {
    CrossfadeOptions,
    Cue,
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
    type SpatialOptions,
} from './Spatial';

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
    dispose(): void;
}

export interface AudioManagerOptions {
    readonly audioContext?: AudioContext;
    readonly busOptions?: AudioBusOptions;
    readonly poolSize?: number;
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
     * `AudioContext.currentTime` at the moment `source.start()` was called.
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
     * {@link DefaultAudioManager.crossfade} (§4.25). A thunk
     * rather than a descriptor: this record owns only WHEN the linkage fires, while
     * {@link DefaultAudioManager.crossfade}, which writes it, owns what it does — down
     * to which voice is faded, resolved by handle id at fire time rather than captured.
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

/** A resolved `[loopStart, loopEnd]` region in buffer-local seconds. */
interface LoopWindowSeconds {
    readonly startSeconds: number;
    readonly endSeconds: number;
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
 * {@link startedVoice}, which returns `null` for the one state where a fade verb has
 * nothing to write to: a voice still `'loading'`, whose `play()` has returned but whose
 * `startVoice` has not run.
 */
interface StartedVoice {
    readonly source: AudioBufferSourceNode;
    readonly gainNode: GainNode;
    readonly startedAtContextTime: number;
    readonly bufferDurationSeconds: number;
}

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
    private disposed = false;
    private nextHandleId = 0;
    private nextSequence = 0;

    public constructor(
        private readonly assetManager: AssetManager,
        options: AudioManagerOptions = {},
    ) {
        this.audioContext = options.audioContext ?? createAudioContext();
        this.poolSize = normalizePoolSize(options.poolSize);
        this.createBuses(options.busOptions);
    }

    public play(ref: AssetRef<AudioClipAsset>, opts: PlayOptions = {}): AudioHandle {
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
                this.startVoice(record, buffer);
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
     * The release is realised ONLY by `source.stop(rampEnd)`, so the native
     * `source.onended` handler installed at `startVoice` stays the sole `releaseVoice`
     * path and no wall-clock timer ever schedules one. The voice therefore stays in the
     * pool with `handle.valid === true` for the whole ramp (phase `'fading-out'`), and
     * `valid` flips false exactly once, under `releaseVoice`'s `voices.delete` guard.
     *
     * A no-op on an invalid or already-released handle. A fade arriving before the
     * voice has started parks {@link VoiceRecord.releaseOnStart} instead, so the source
     * is never created at all (Invariant #121).
     */
    public fadeOut(handle: AudioHandle, spec: FadeOutSpec): void {
        const record = this.voices.get(handle.id);
        if (record === undefined) {
            return;
        }

        this.applyFadeOut(record, spec, this.audioContext.currentTime);
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
     * Those two are the same instant whenever a linkage fires — `startVoice` reads `t0` from
     * `currentTime` and is synchronous and non-reentrant, so the clock cannot advance before
     * the intents are applied, which is also what keeps {@link scheduleGainRamp}'s
     * not-in-the-future precondition satisfied. Re-reading the clock here would therefore
     * produce the same number today. Taking it as an argument is what stops "one shared
     * window" from resting on that: it becomes a fact of the code rather than of the call
     * stack, and it survives a caller that reaches this from anywhere else.
     */
    private applyFadeOut(record: VoiceRecord, spec: FadeOutSpec, now: number): void {
        const started = startedVoice(record);
        if (started === null) {
            // Still loading: there is no gain to ramp and no source to stop, so the
            // release is parked rather than applied — step 1 of Invariant #121.
            record.releaseOnStart = true;
            return;
        }

        const { rampEnd, deferredWarning } = resolveFadeOutRampEnd(record, started, spec, now);

        try {
            started.source.stop(rampEnd);
        } catch {
            // The ramp's whole safety rests on the release it hands off to. Without a
            // scheduled stop the voice would sit silent and unreleased forever, holding
            // a pool slot, so it is stopped now — and the cut is said out loud rather
            // than left as an unexplained missing fade.
            console.warn(
                `Audio fadeOut could not schedule its stop at ${rampEnd}s; the fade is dropped and the voice is stopped immediately.`,
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
            rampDeparture(record, started.gainNode.gain, now),
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
     * A no-op on an invalid or already-released handle. A fade arriving before the voice
     * has started is parked on {@link VoiceRecord.pendingFadeTo} instead — step 3 of
     * Invariant #121 — and applied at the real `t0`.
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
     * Stateless sugar over `play` and the fade-out path, holding no crossfade state of its
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
        // Rest rather than a field-by-field forward, so a `PlayOptions` field added later
        // reaches `play` without a second edit here — which is what
        // `CrossfadeOptions extends Omit<PlayOptions, 'fadeIn'>` already promises. Excess
        // properties are still rejected where `opts` is authored.
        const { durationMs, curve = DEFAULT_CROSSFADE_CURVE, ...playOptions } = opts;
        const handle = this.play(incoming, { ...playOptions, fadeIn: { durationMs, curve } });

        const incomingRecord = this.voices.get(handle.id);
        // The outgoing voice is checked AFTER the play, not before: a saturated pool
        // reclaims a voice to host the incoming one, and the one it reclaims may well be
        // this outgoing one. A linkage parked against it would fire onto a record that has
        // already left the pool.
        if (incomingRecord === undefined || !this.voices.has(outgoing.id)) {
            return handle;
        }

        incomingRecord.linkedFadeOut = (startedAt): void => {
            // Resolved by handle id when the linkage FIRES, never captured as a record:
            // the voice may have been stopped, preempted or have reached its own end in
            // the meantime, and a captured record would still accept the write — silently,
            // since a released one has no nodes left to ramp.
            const outgoingRecord = this.voices.get(outgoing.id);
            if (outgoingRecord === undefined) {
                return;
            }

            this.applyFadeOut(outgoingRecord, { overMs: durationMs, curve }, startedAt);
        };

        return handle;
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

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
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

    private startVoice(record: VoiceRecord, buffer: AudioBuffer): void {
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
        // One `t0`, read once and used for the gain floor, the start, the stop maths and
        // every pending ramp — "applied atomically at t0" is only true if there is a
        // single t0 to apply them at.
        const startedAt = this.audioContext.currentTime;
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
                source.start(0, schedule.entryOffsetSeconds, schedule.playDurationSeconds);
            } else {
                source.start(0, schedule.entryOffsetSeconds);
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
        setPannerPosition(pannerNode, record.spatial.position, this.audioContext.currentTime);
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
 * `AudioContext.currentTime`. The re-anchor reads `param.value`, which is the value
 * at `currentTime`, so a future `startTime` would anchor the curve at a stale
 * departure. Callers pass `audioContext.currentTime`, as {@link AudioBus.duck} does.
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
 * Two callers know better, for different reasons: one just WROTE the value (the fade-in
 * at `t0` passes the floor it laid down), and one can BOUND it ({@link rampDeparture}
 * caps the read at the voice's ceiling, since a stale read reports a gain the voice
 * cannot be at). Omit it only when neither holds and the departure is genuinely unknown.
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
 * The gain a fade verb on a LIVE voice departs from: what the param reports, capped at the
 * voice's own ceiling — or {@link VoiceRecord.settledGain} outright, on the one path where
 * the gain is known rather than estimated. Shared by {@link DefaultAudioManager.fadeOut}
 * and {@link DefaultAudioManager.fadeTo}; the ramps laid down at `t0` need none of it,
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
     * Held for {@link DefaultAudioManager.fadeOut} to print once `source.stop(rampEnd)` is
     * accepted, because it narrates a fade the refusal path cancels. A diagnosis that
     * survives that path is printed where it is found instead: the unreachable-cue warning
     * names an immediate stop, which is what the refusal does too.
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
    now: number,
): FadeOutRamp {
    const { rampEnd: authoredEnd, deferredWarning } = resolveAuthoredFadeOutEnd(
        record,
        started,
        spec,
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

/** The ramp end each variant ASKS for, before clamping. May be non-finite. */
function resolveAuthoredFadeOutEnd(
    record: VoiceRecord,
    started: StartedVoice,
    spec: FadeOutSpec,
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
            deferredWarning: `Audio fadeOut { toEnd } found no scheduled end on this voice; fading out over ${DEFAULT_FADE_OUT_MS}ms instead.`,
        };
    }

    // `{ toCue }` — an end-point by nature, so it clamps to `[0, duration]` and never
    // abandons, exactly as `play()` resolves its `to`.
    const resolution = resolveCue(spec.toCue, {
        sheet: record.sheet,
        duration: started.bufferDurationSeconds,
        role: 'endpoint',
    });
    // An endpoint never abandons; the fallback keeps the union exhaustive for TS.
    const cueSeconds =
        resolution.kind === 'resolved' ? resolution.seconds : started.bufferDurationSeconds;

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
        `Audio fadeOut cue ${describeCue(spec.toCue)} resolved to ${cueSeconds}s, which this voice never reaches again (${describeVoiceTimeline(record)}); silencing and stopping the voice immediately.`,
    );
    // Printed here, not deferred: it names an immediate stop, which is exactly what the
    // refusal path performs as well, so it stays true whichever way the stop goes.
    return { rampEnd: now, deferredWarning: null };
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
 * The context time the playhead NEXT reaches `cueSeconds`, or `null` when it never will
 * — Invariant #122. Derived from `startedAtContextTime`, `startOffsetSeconds` and the
 * effective loop window at a fixed `playbackRate` of 1, so it needs no timer and no
 * sampling of where the playhead currently is.
 *
 * A looping voice runs its ENTRY pass from `startOffsetSeconds` out to the window end,
 * then repeats `[loopStart, loopEnd]` forever, so a cue is reached in the entry pass,
 * on some later pass, or never. "Never" covers a cue that has gone by on a non-looping
 * voice, one before `loopStart` that only the intro played, and one past `loopEnd` — all
 * the same thing from the caller's side, and all answered with `null`.
 *
 * The window is treated as CLOSED at `loopEnd`: that is where the playhead wraps, so a
 * cue there is reached once per pass rather than never — which is what makes
 * `{ toCue: 'end' }` on a whole-buffer loop a fade over the current pass instead of an
 * instant cut.
 */
function nextCueContextTime(
    record: VoiceRecord,
    started: StartedVoice,
    cueSeconds: number,
    now: number,
): number | null {
    const startedAt = started.startedAtContextTime;
    const entrySeconds = record.startOffsetSeconds;
    const window = record.loopWindowSeconds;

    if (window === null) {
        // No loop: every position is passed exactly once. A cue BEHIND the entry point
        // needs no test of its own — it lands before `startedAtContextTime`, which is
        // necessarily behind `now`, so the one comparison covers both ways of missing.
        const reachedAt = startedAt + (cueSeconds - entrySeconds);
        return reachedAt > now ? reachedAt : null;
    }

    const { startSeconds: loopStart, endSeconds: loopEnd } = window;
    const period = loopEnd - loopStart;

    if (cueSeconds > loopEnd) {
        // Past the window: the entry pass runs out to `loopEnd` and every pass after it
        // wraps there, so the playhead never gets this far.
        return null;
    }

    // A cue BEHIND the entry point is not in the entry pass at all, and needs no branch
    // of its own: this lands it before `startedAtContextTime` — necessarily behind
    // `now` — so it falls through to the period advance below, which puts it exactly one
    // period on, at `(loopEnd − entry) + (cue − loopStart)`. The two are the same
    // instant, and naming the wrap separately would only compute it twice.
    const reachedAt = startedAt + (cueSeconds - entrySeconds);
    if (reachedAt > now) {
        return reachedAt;
    }

    // At or behind the playhead: the NEXT pass over it, if the loop returns there at
    // all. A cue before `loopStart` was in the intro and is never replayed; a degenerate
    // zero-length window replays nothing. `floor(…) + 1` rather than `ceil`, so a cue
    // the playhead is sitting exactly on waits a whole period — a looping voice always
    // has a next arrival, and fading over it beats the cut that a cue which never comes
    // back has to take.
    const repeats = cueSeconds >= loopStart && period > 0;
    return repeats ? reachedAt + period * (Math.floor((now - reachedAt) / period) + 1) : null;
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
 * every positional `AudioParam` write that is not anchoring a fresh voice (the
 * listener pose today). A step change
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
 * Write a panner's position at a voice's start — immediate, since there is nothing
 * audible yet to zipper. Takes the same feature-detected path as the listener pose,
 * so a platform without positional `AudioParam`s reaches its deprecated
 * `setPosition` for both.
 */
function setPannerPosition(
    pannerNode: PannerNode,
    position: AudioPosition,
    currentTime: number,
): void {
    const params = [pannerNode.positionX, pannerNode.positionY, pannerNode.positionZ];
    if (params.every(isWritableAudioParam)) {
        try {
            params.forEach((param, index) => {
                writePositionalParam(param, position[index] ?? 0, currentTime, true);
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
