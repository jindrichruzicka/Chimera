import type { AudioClipMetadata } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../assets/AssetManager';
import { AudioBus, type AudioBusId, type AudioBusOptions } from './AudioBus';
import { parseAudioCueSheet, resolveCue, resolveCueWindow } from './audioCueSheet';
import type { Cue, FadeCurve, FadeInSpec, FadeToSpec, LoopRegion } from './Cue';

export type { AudioBusId } from './AudioBus';

type AudioPosition = readonly [number, number, number];

export interface PlayOptions {
    readonly bus?: AudioBusId;
    readonly loop?: boolean;
    readonly volume?: number;
    readonly position?: AudioPosition;
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
    stop(handle: AudioHandle): void;
    stopAll(bus?: AudioBusId): void;
    duck(bus: AudioBusId, duckedVolume: number, durationMs: number): void;
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
 * to write to. `'fading-out'` is written by `fadeOut` in a later task; it is declared
 * here because the phase set is what the ramp verbs and voice preemption discriminate
 * on (§4.25, Invariants #119/#123), not because anything sets it yet.
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
    readonly position: AudioPosition | null;
    readonly sequence: number;
    readonly volume: number;
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
     * Absolute context time this voice is scheduled to end, or `null` when it has no
     * determinate end (an unbounded loop) or when scheduling the stop failed. A fade
     * clamps its ramp end to this, so it must never name a stop that was not
     * scheduled.
     */
    scheduledStopAt: number | null;
    phase: VoicePhase;
    /**
     * Precedence step 1 of Invariant #121: a release requested before the voice started.
     * Honoured by short-circuiting `startVoice`, so the source is never created at all.
     * Written by `fadeOut` in a later task, when a pre-start fade has nothing to ramp.
     */
    releaseOnStart: boolean;
    /** Step 2: {@link PlayOptions.fadeIn}, the one intent with a writer today. */
    pendingFadeIn: FadeInSpec | null;
    /** Step 3: a ramp-to-absolute requested pre-start. Written by `fadeTo` in a later task. */
    pendingFadeTo: FadeToSpec | null;
    /**
     * Step 4: a crossfade's linked fade-out of the OUTGOING voice, fired with this
     * voice's real `t0` so both curves cover the identical window (§4.25). A thunk
     * rather than a descriptor: this record owns only WHEN the linkage fires, while
     * `crossfade` — a later task — owns what it does.
     */
    linkedFadeOut: ((startedAt: number) => void) | null;
    source: AudioBufferSourceNode | null;
    gainNode: GainNode | null;
    pannerNode: PannerNode | null;
}

/** A voice's resolved playback schedule, against a decoded buffer's real duration. */
interface VoiceSchedule {
    /** The EFFECTIVE loop flag: `false` when a requested loop window collapsed. */
    readonly loop: boolean;
    /** `start()`'s offset argument, after folding into the loop window. */
    readonly entryOffsetSeconds: number;
    /** `to`'s window length, measured from the PRE-FOLD anchor; `null` when unbounded. */
    readonly playDurationSeconds: number | null;
    readonly loopWindow: { readonly startSeconds: number; readonly endSeconds: number } | null;
}

const DEFAULT_POOL_SIZE = 32;
const DEFAULT_BUS_ID: AudioBusId = 'sfx';
const DEFAULT_PRIORITY = 0;
const DEFAULT_VOLUME = 1;
const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'voice'];
const GAIN_RAMP_EPSILON = 1e-4;
const EQUAL_POWER_WAYPOINTS = 64;
const DEFAULT_FADE_CURVE: FadeCurve = 'linear';

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

        this.reserveVoiceSlot();
        if (this.voices.size >= this.poolSize) {
            handle.invalidate();
            return handle;
        }

        const record: VoiceRecord = {
            handle,
            loop: opts.loopRegion !== undefined || (opts.loop ?? false),
            loopRequested: opts.loop ?? false,
            position: opts.position ?? null,
            sequence: this.nextSequence,
            volume: clampUnit(opts.volume ?? DEFAULT_VOLUME),
            sheet,
            from: opts.from ?? null,
            to: opts.to ?? null,
            loopRegion: opts.loopRegion ?? null,
            startedAtContextTime: null,
            startOffsetSeconds: 0,
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

        const candidate = this.findLowestPriorityVoice();
        if (candidate !== null) {
            this.releaseVoice(candidate, { stopSource: true });
        }
    }

    private findLowestPriorityVoice(): VoiceRecord | null {
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

        record.startOffsetSeconds = schedule.entryOffsetSeconds;
        record.startedAtContextTime = startedAt;

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
        // write made in this same turn. The first ramp consumes it — after that the param
        // is mid-curve and its own held value is the only truth.
        let departure: number | undefined = initialVoiceGain(record);

        const fadeIn = record.pendingFadeIn;
        if (fadeIn !== null) {
            record.pendingFadeIn = null;
            const curve = fadeIn.curve ?? DEFAULT_FADE_CURVE;
            const ramp = resolveFadeInRamp(record, fadeIn.durationMs, startedAt, curve);
            scheduleGainRamp(gainNode.gain, ramp.target, startedAt, ramp.endTime, curve, departure);
            departure = undefined;
        }

        const fadeTo = record.pendingFadeTo;
        if (fadeTo !== null) {
            record.pendingFadeTo = null;
            // Only the WINDOW clamps here, deliberately unlike the fade-in above: `to` is
            // an absolute ceiling the caller named, so lowering it would silently rewrite
            // the request, whereas a fade-in's target is derived from `volume` and its
            // authored quantity is the rate.
            const endTime = clampRampEnd(record, startedAt + fadeTo.durationMs / 1000);
            scheduleGainRamp(
                gainNode.gain,
                fadeTo.to,
                startedAt,
                endTime,
                fadeTo.curve ?? DEFAULT_FADE_CURVE,
                departure,
            );
        }

        const linkedFadeOut = record.linkedFadeOut;
        if (linkedFadeOut !== null) {
            record.linkedFadeOut = null;
            try {
                linkedFadeOut(startedAt);
            } catch {
                // A crossfade's outgoing voice is not this voice's problem to die over,
                // but the containment must still name what survived rather than hide it.
                console.warn(
                    'Audio linked fade-out failed and was skipped; the incoming voice started normally, so the outgoing one keeps playing unfaded.',
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

        if (record.position === null) {
            gainNode.connect(busGainNode);
            return;
        }

        const pannerNode = this.audioContext.createPanner();
        record.pannerNode = pannerNode;
        setPannerPosition(pannerNode, record.position, this.audioContext.currentTime);
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

function voiceHasLowerPreemptionRank(candidate: VoiceRecord, selected: VoiceRecord): boolean {
    if (candidate.handle.priority !== selected.handle.priority) {
        return candidate.handle.priority < selected.handle.priority;
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
 * @internal Stage-1 gain-ramp primitive shared by the fade verbs (§4.25, Invariant #120).
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
 * Pass `departure` when the caller ITSELF just wrote the value the ramp must leave from.
 * `param.value` reports `[[current value]]` — the parameter's value at the start of the
 * current render quantum — and a `setValueAtTime` scheduled in this same turn does not
 * move it, so reading it back would anchor at the node's previous gain (a fresh
 * `GainNode` reports its `defaultValue` of 1). That misread is silent for a `linear`
 * ramp on the `cancelAndHoldAtTime` path, but `equalPower` derives every waypoint from
 * the departure and the fallback path writes it as an explicit anchor — so a fade-in
 * from silence would invert into a ramp down from full gain. Omit it whenever the
 * departure is genuinely unknown, such as over a ramp already in flight.
 */
export function scheduleGainRamp(
    param: AudioParam,
    target: number,
    startTime: number,
    endTime: number,
    curve: FadeCurve = 'linear',
    departure?: number,
): void {
    if (!Number.isFinite(startTime) || startTime < 0) {
        // No usable anchor time — a spec-compliant AudioParam throws RangeError for a
        // negative or non-finite time on every automation method, including the
        // cancel calls the reanchor would make, so write nothing at all.
        return;
    }

    const held = reanchorGain(param, startTime, departure);
    const clampedTarget = clampUnit(target);

    if (!Number.isFinite(endTime) || endTime <= startTime) {
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
 * Clamp a ramp end to the voice's scheduled end. The authored bound is authoritative and
 * a fade never extends it (§4.25); a voice with no determinate end — an unbounded loop —
 * has nothing to clamp against.
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

function setPannerPosition(
    pannerNode: PannerNode,
    position: AudioPosition,
    currentTime: number,
): void {
    const [positionX, positionY, positionZ] = position;
    pannerNode.positionX.setValueAtTime(positionX, currentTime);
    pannerNode.positionY.setValueAtTime(positionY, currentTime);
    pannerNode.positionZ.setValueAtTime(positionZ, currentTime);
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
