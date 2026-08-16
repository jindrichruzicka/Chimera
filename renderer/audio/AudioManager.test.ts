/**
 * renderer/audio/AudioManager.test.ts
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * Invariants upheld:
 *   #116 — every fade, crossfade and cue op writes exclusively to a voice's own
 *          stage-1 gain; the bus and master gains are never written by one.
 *   #117 — provenance-scoped two-tier cue validation; `loopRegion` implies `loop`;
 *          a looping `to` bounds elapsed play duration, not a buffer wrap. Spatial
 *          distances join the static tier by the same provenance rule: they need no
 *          decode, so an already-invalid spec rejects synchronously inside `play()`
 *          (the resolver's own case matrix lives in `Spatial.test.ts`).
 *   #118 — cue resolution is fail-soft: it never throws into a caller, an
 *          unresolvable load-bearing anchor abandons with one warning, end-point
 *          cues clamp, and a post-clamp-collapsed window is dropped.
 *   #119 — a scheduled stop drives release through the native `onended` handler,
 *          never a wall-clock timer; a fade-out keeps the handle valid across the
 *          whole ramp and invalidates it exactly once, under `voices.delete`.
 *   #120 — every stage-1 ramp cancels and re-anchors first; an exponential fade
 *          cannot depart from zero, so its floor is the epsilon, not silence.
 *   #121 — ops requested before `startVoice` are parked on the `VoiceRecord` and
 *          applied atomically at `t0` in the order `releaseOnStart` →
 *          `pendingFadeIn` → `pendingFadeTo` → `linkedFadeOut`; no ramp is ever
 *          scheduled against a null source.
 *   #122 — cue-relative fade timing is derived from `startedAtContextTime`,
 *          `startOffsetSeconds`, the decoded duration and the effective loop window,
 *          never from a wall-clock timer.
 *   #123 — preemption reclaims a `'fading-out'` voice first, then the lowest
 *          priority, then — at equal priority — a looping voice before a one-shot,
 *          then the oldest; no voice class is hard-exempt.
 *   #124 — the cue sheet is read only through `getManifestMetadata` and parsed
 *          only here, in `renderer/audio`.
 *   #126 — the public `AudioHandle` gains no fields and is never spread-built.
 *
 * Written test-first. The load-bearing red is the static-rejection case: against an
 * `AudioManager` that ignores `from`/`to`/`loopRegion` such a play reserves a voice,
 * preempts a live one, and starts a load. The deferral and no-warning cases are
 * deliberately green against that same baseline — they exist to bound the guards, not
 * to drive them. The `AudioHandle` type pin is red at `tsc` rather than in vitest
 * (`expectTypeOf` is erased at runtime), so both gates must run.
 *
 * For #121 the load-bearing red is the precedence order itself. Every slot has a
 * production writer (`PlayOptions.fadeIn`, `fadeOut`, `fadeTo` and `crossfade`); the
 * ordering test still parks `linkedFadeOut` through {@link writeVoiceIntents}, because a
 * real linkage ramps ANOTHER voice's gain and so says nothing about where in the order it
 * fired, and the ordering is asserted from the voice gain's own call log rather than a
 * global invocation index.
 *
 * For #119 the fade-out tests were written against a `fadeOut` with an empty body, so
 * every red is behavioural rather than "fadeOut is not a function". The load-bearing
 * ones are the timer-free release (a stray `setTimeout` shows in `vi.getTimerCount()`,
 * since fake timers are installed for the whole file), the ramp-end arithmetic, and the
 * refused-stop fallback — the reachability and clamp cases exist to bound them.
 *
 * `crossfade` was written against a body that plays the incoming voice with its fade-in but
 * parks no linkage. Running the block against that baseline puts 18 red and 7 green, and the
 * seven bound the guards rather than drive them, for four different reasons: the option
 * forwarding asserts nothing about the outgoing voice at all; an already-invalid outgoing
 * voice, a saturated pool, a statically rejected incoming play and a disposed manager park
 * no linkage to begin with; a decode that fails parks one on a live voice that then never
 * fires, because the incoming voice never starts; and an outgoing voice released before `t0`
 * fires one that finds its target gone. Each is indistinguishable from the baseline, which is
 * the point — they fence the guards in rather than prove them.
 *
 * The load-bearing reds are the linkage itself: both halves anchored to one `t0`, the
 * constant-power `equalPower` pair over the window they author, and the two preconditions
 * that pair rests on — the per-voice clamp that can make the windows diverge, and the equal
 * distances that `volume` can break. The anchor needs a clock that ADVANCES on every read
 * ({@link driftAudioClock}) — under the frozen double, "anchored to the `t0` it was handed"
 * and "re-read the clock and got the same number" are indistinguishable, and every other
 * test in that block passes under either.
 *
 * For #123 the preemption block was written against the two-tier ranker (priority, then
 * age) — the `MUSIC_PRIORITY` constant landed first, being a value rather than the
 * ranking — so its reds are behavioural. Where a red drives one term, it is built so the
 * other terms point at the wrong voice; each test says which it is doing. The fences
 * cover what no ranking term can be red about alone: the tier ORDER, the unfiltered
 * SHAPE of the scan, and the constant's value.
 *
 * Tier 4 is an equivalent mutation, and deliberately so: `voices` iterates in ascending
 * `sequence` and the min-scan keeps its incumbent on a tie, so the oldest voice wins with
 * or without the term. It is there to make the relation total and independent of the
 * container, not to change an outcome — no test here pins it, and none can.
 *
 * `fadeTo` was likewise written against an empty body. Its load-bearing reds are the HOLD
 * (no stop, no phase change, no rewritten end), the ceiling rewrite — pinned through the
 * fade-out that departs from it, not just by reading the field — and the two departure
 * orderings: capping against the ceiling being REPLACED, and taking the exact gain the
 * param holds at `t0` rather than what it reports there. Those last three run on
 * {@link FakeQuantizedAudioParam} with `equalPower`, because the write-through double and
 * a `linear` ramp each hide the whole defect class on their own.
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    expectTypeOf,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import {
    buildAssetRef,
    type AssetKind,
    type AssetRef,
    type AudioClipAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../assets/AssetManager';
import { useSettingsStore } from '../state/settingsStore';
import {
    createAudioManager,
    DefaultAudioManager,
    MUSIC_PRIORITY,
    scheduleGainRamp,
    type AudioHandle,
    type AudioManagerOptions,
    type PlayOptions,
    type VoicePhase,
} from './AudioManager';
import type { FadeInSpec, FadeToSpec } from './Cue';

interface ScheduledGainCall {
    readonly method:
        | 'cancelScheduledValues'
        | 'setValueAtTime'
        | 'linearRampToValueAtTime'
        | 'cancelAndHoldAtTime'
        | 'exponentialRampToValueAtTime';
    readonly value?: number;
    readonly time: number;
}

interface DeferredValue<TValue> {
    readonly promise: Promise<TValue>;
    resolve(value: TValue): void;
    reject(error: unknown): void;
}

class FakeAudioParam {
    public value = 1;
    public readonly calls: ScheduledGainCall[] = [];

    public cancelScheduledValues(time: number): this {
        this.calls.push({ method: 'cancelScheduledValues', time });
        return this;
    }

    public setValueAtTime(value: number, time: number): this {
        this.value = value;
        this.calls.push({ method: 'setValueAtTime', value, time });
        return this;
    }

    public linearRampToValueAtTime(value: number, time: number): this {
        this.value = value;
        this.calls.push({ method: 'linearRampToValueAtTime', value, time });
        return this;
    }

    public cancelAndHoldAtTime(time: number): this {
        this.calls.push({ method: 'cancelAndHoldAtTime', time });
        return this;
    }

    public exponentialRampToValueAtTime(value: number, time: number): this {
        this.value = value;
        this.calls.push({ method: 'exponentialRampToValueAtTime', value, time });
        return this;
    }
}

/**
 * Models the one thing every other double here gets wrong: a real `AudioParam.value`
 * reports `[[current value]]` — the value at the START of the current render quantum —
 * so automation scheduled in this same JS turn is INVISIBLE to it. The write-through
 * `value` on {@link FakeAudioParam} is a convenience for seeding a departure, and it
 * silently makes any "write the value, then read it back" bug look correct. A caller
 * that just wrote its own departure must pass it, not re-read it.
 */
class FakeQuantizedAudioParam extends FakeAudioParam {
    public override setValueAtTime(value: number, time: number): this {
        this.calls.push({ method: 'setValueAtTime', value, time });
        return this;
    }
}

/** Models an AudioParam on a platform lacking `cancelAndHoldAtTime` and
 * `exponentialRampToValueAtTime`, so the ramp helper must feature-detect and
 * degrade to linear (cancelScheduledValues + setValueAtTime + linearRamp). */
class FakeLinearOnlyAudioParam {
    public value = 1;
    public readonly calls: ScheduledGainCall[] = [];

    public cancelScheduledValues(time: number): this {
        this.calls.push({ method: 'cancelScheduledValues', time });
        return this;
    }

    public setValueAtTime(value: number, time: number): this {
        this.value = value;
        this.calls.push({ method: 'setValueAtTime', value, time });
        return this;
    }

    public linearRampToValueAtTime(value: number, time: number): this {
        this.value = value;
        this.calls.push({ method: 'linearRampToValueAtTime', value, time });
        return this;
    }
}

/** `cancelAndHoldAtTime` is present but throws (some browsers), so the helper's
 * try/catch must fall back to cancelScheduledValues + setValueAtTime. */
class FakeThrowingCancelHoldAudioParam extends FakeAudioParam {
    public override cancelAndHoldAtTime(): never {
        throw new Error('cancelAndHoldAtTime is unsupported on this platform.');
    }
}

/** `exponentialRampToValueAtTime` is present but throws, the same platform-defect
 * shape `FakeThrowingCancelHoldAudioParam` models for the reanchor: a feature-detect
 * alone cannot see it, so the helper must catch and degrade to linear. */
class FakeThrowingExponentialAudioParam extends FakeAudioParam {
    public override exponentialRampToValueAtTime(): never {
        throw new Error('exponentialRampToValueAtTime is unsupported on this platform.');
    }
}

/** Models a spec-compliant AudioParam's TIME constraints: every automation method
 * throws `RangeError` when the time is negative or non-finite. The plain fakes accept
 * any number, so only this one can prove the helper never sends an unschedulable time
 * into a real param. Value constraints are pinned separately, by the exact-value
 * assertions on the clamping tests. */
class FakeStrictTimeAudioParam extends FakeAudioParam {
    public override cancelScheduledValues(time: number): this {
        assertSchedulableTime(time);
        return super.cancelScheduledValues(time);
    }

    public override setValueAtTime(value: number, time: number): this {
        assertSchedulableTime(time);
        return super.setValueAtTime(value, time);
    }

    public override linearRampToValueAtTime(value: number, time: number): this {
        assertSchedulableTime(time);
        return super.linearRampToValueAtTime(value, time);
    }

    public override cancelAndHoldAtTime(time: number): this {
        assertSchedulableTime(time);
        return super.cancelAndHoldAtTime(time);
    }

    public override exponentialRampToValueAtTime(value: number, time: number): this {
        assertSchedulableTime(time);
        return super.exponentialRampToValueAtTime(value, time);
    }
}

function assertSchedulableTime(time: number): void {
    if (!Number.isFinite(time) || time < 0) {
        throw new RangeError(`AudioParam time ${time} is negative or not finite.`);
    }
}

class FakeAudioNode {
    public readonly connections: unknown[] = [];
    public readonly disconnect = vi.fn(() => {
        this.connections.length = 0;
    });

    public connect(destination: AudioNode): AudioNode {
        this.connections.push(destination);
        return destination;
    }
}

class FakeGainNode extends FakeAudioNode {
    public readonly gain: FakeAudioParam;

    public constructor(gain: FakeAudioParam = new FakeAudioParam()) {
        super();
        this.gain = gain;
    }
}

class FakePannerNode extends FakeAudioNode {
    public readonly positionX = new FakeAudioParam();
    public readonly positionY = new FakeAudioParam();
    public readonly positionZ = new FakeAudioParam();
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
    public buffer: AudioBuffer | null = null;
    public loop = false;
    // Web Audio defaults. `loopStart === loopEnd === 0` is the spec's "loop the whole
    // buffer" sentinel, so an untouched pair is itself an assertable state.
    public loopStart = 0;
    public loopEnd = 0;
    public onended: ((this: AudioBufferSourceNode, event: Event) => unknown) | null = null;
    /** Models a platform that accepts a bare `stop()` but refuses a scheduled one. */
    public rejectScheduledStop = false;
    public readonly start = vi.fn<(when?: number, offset?: number, duration?: number) => void>();
    public readonly stop = vi.fn<(when?: number) => void>((when?: number) => {
        if (this.rejectScheduledStop && when !== undefined) {
            throw new Error('stop(when) is unsupported on this platform.');
        }
    });

    public finish(): void {
        this.onended?.call(asAudioNode<AudioBufferSourceNode>(this), new Event('ended'));
    }
}

class FakeAudioContext {
    public currentTime = 10;
    /** Arms every source created from here on to refuse a scheduled stop. */
    public failNextStopSchedule = false;
    /** Hands out {@link FakeQuantizedAudioParam} gains — the spec-faithful `value`. */
    public quantizedGainParams = false;
    public readonly createdGainNodes: FakeGainNode[] = [];
    public readonly createdPannerNodes: FakePannerNode[] = [];
    public readonly createdSources: FakeAudioBufferSourceNode[] = [];
    public readonly destination = asAudioNode<AudioDestinationNode>(new FakeAudioNode());
    public readonly close = vi.fn((): Promise<void> => Promise.resolve());

    public createGain(): GainNode {
        const node = new FakeGainNode(
            this.quantizedGainParams ? new FakeQuantizedAudioParam() : new FakeAudioParam(),
        );
        this.createdGainNodes.push(node);
        return asAudioNode<GainNode>(node);
    }

    public createBufferSource(): AudioBufferSourceNode {
        const source = new FakeAudioBufferSourceNode();
        source.rejectScheduledStop = this.failNextStopSchedule;
        this.createdSources.push(source);
        return asAudioNode<AudioBufferSourceNode>(source);
    }

    public createPanner(): PannerNode {
        const node = new FakePannerNode();
        this.createdPannerNodes.push(node);
        return asAudioNode<PannerNode>(node);
    }
}

class FakeGlobalAudioContext extends FakeAudioContext {
    public static instances: FakeGlobalAudioContext[] = [];

    public constructor() {
        super();
        FakeGlobalAudioContext.instances.push(this);
    }
}

class AssetManagerDouble implements AssetManager {
    public readonly loadCalls: AssetRef<AudioClipAsset>[] = [];

    private readonly assets = new Map<string, Promise<ResolvedAsset<AudioClipAsset>>>();
    private readonly manifestMetadata = new Map<string, unknown>();

    public registerManifest(): void {}

    public async preloadCritical(): Promise<void> {}

    public get<TAssetKind extends AssetKind>(
        _ref: AssetRef<TAssetKind>,
    ): ResolvedAsset<TAssetKind> | null {
        return null;
    }

    /** Mirrors DefaultAssetManager: `undefined` for a ref with no manifest entry. */
    public getManifestMetadata(ref: AssetRef): unknown {
        return this.manifestMetadata.get(ref.toString());
    }

    public load<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>> {
        this.loadCalls.push(ref as AssetRef<AudioClipAsset>);
        const asset = this.assets.get(ref.toString());
        if (asset === undefined) {
            return Promise.reject(new Error(`No test asset registered for '${ref}'.`));
        }
        return asset as Promise<ResolvedAsset<TAssetKind>>;
    }

    public dispose(): void {}

    public resolve(ref: AssetRef<AudioClipAsset>, asset: AudioBuffer): void {
        this.assets.set(ref.toString(), Promise.resolve(asset as ResolvedAsset<AudioClipAsset>));
    }

    public defer(ref: AssetRef<AudioClipAsset>): DeferredValue<ResolvedAsset<AudioClipAsset>> {
        const deferred = createDeferred<ResolvedAsset<AudioClipAsset>>();
        this.assets.set(ref.toString(), deferred.promise);
        return deferred;
    }

    /**
     * Attach an OPAQUE metadata value to a ref, exactly as an
     * `AssetManifestEntry.metadata` slot would (Invariant #124). Deliberately typed
     * `unknown` so tests can register hostile junk as well as a valid cue sheet.
     */
    public registerMetadata(ref: AssetRef<AudioClipAsset>, metadata: unknown): void {
        this.manifestMetadata.set(ref.toString(), metadata);
    }
}

/** An AssetManager whose metadata channel throws, proving `play()` contains it. */
class ThrowingMetadataAssetManagerDouble extends AssetManagerDouble {
    public override getManifestMetadata(): never {
        throw new Error('getManifestMetadata is unavailable.');
    }
}

/**
 * Authoring sheet for a nominally 10 s clip: an intro tail, a `[2, 6)` loop region,
 * and an outro. Tests pair it with a SHORTER decoded buffer to exercise the clamp
 * and drop paths, since the authored `durationSeconds` is never a range gate.
 */
const THEME_CUE_SHEET = {
    cues: { intro: 0, loopStart: 2, chorus: 4, loopEnd: 6, outro: 9 },
    defaultLoopRegion: ['loopStart', 'loopEnd'],
    durationSeconds: 10,
} as const;

/**
 * Three voices whose ranking is order-INDEPENDENT under a total order and order-dependent
 * under a merely partial one. Declared here rather than with the helpers at the foot of
 * the file, where the other fixtures live: an `it.each` table is evaluated when the
 * describe callback runs, which is still inside the temporal dead zone of a `const`
 * declared below it.
 *
 * The correct pick is always `blip` — the lowest priority. Make the loop term DECISIVE,
 * settling every pair whose loop flags differ on the "equal-or-higher priority" gate
 * alone, and `bed`/`blip` and `bed`/`chime` each rank neither way while `blip`/`chime`
 * still ranks. The scan then keeps `bed` whenever it is seeded with it and never
 * displaces it, so leading with `bed` reaches `bed` and the other two orders reach
 * `blip` — one row of the three is red.
 */
const PREEMPTION_BED = { name: 'bed', opts: { loop: true, priority: 5 } } as const;
const PREEMPTION_BLIP = { name: 'blip', opts: { priority: 1 } } as const;
const PREEMPTION_CHIME = { name: 'chime', opts: { priority: 3 } } as const;

const managers: DefaultAudioManager[] = [];

beforeEach(() => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

afterEach(() => {
    for (const manager of managers.splice(0)) {
        manager.dispose();
    }
    useSettingsStore.setState({ settings: {}, activeGameId: null });
    vi.useRealTimers();
});

describe('DefaultAudioManager', () => {
    it('creates master, music, sfx, and voice buses wired through master output', () => {
        const { context } = createManager();

        const masterGain = expectGain(context, 0);
        const musicGain = expectGain(context, 1);
        const sfxGain = expectGain(context, 2);
        const voiceGain = expectGain(context, 3);

        expect(masterGain.connections).toEqual([context.destination]);
        expect(musicGain.connections).toEqual([masterGain]);
        expect(sfxGain.connections).toEqual([masterGain]);
        expect(voiceGain.connections).toEqual([masterGain]);
    });

    it('resolves audio refs through the injected AssetManager and wires playback to the selected bus', async () => {
        const { assetManager, context, manager } = createManager();
        const ref = audioRef('audio/sfx/hit.ogg');
        const buffer = createAudioBuffer('hit');
        assetManager.resolve(ref, buffer);

        const handle = manager.play(ref, { bus: 'voice', loop: true, priority: 7, volume: 0.4 });

        expect(assetManager.loadCalls).toEqual([ref]);
        expect(handle.valid).toBe(true);

        await flushAudioLoad();

        const source = expectSource(context, 0);
        const voiceGain = expectGain(context, 3);
        const sourceGain = expectGain(context, 4);

        expect(source.buffer).toBe(buffer);
        expect(source.loop).toBe(true);
        expect(source.start).toHaveBeenCalledOnce();
        expect(source.connections).toEqual([sourceGain]);
        expect(sourceGain.connections).toEqual([voiceGain]);
        expect(sourceGain.gain.calls.at(-1)).toEqual({
            method: 'setValueAtTime',
            value: 0.4,
            time: 10,
        });
    });

    it('routes positioned audio through a panner node before the selected bus', async () => {
        const { assetManager, context, manager } = createManager();
        const ref = audioRef('audio/sfx/located.ogg');
        assetManager.resolve(ref, createAudioBuffer('located'));

        manager.play(ref, { bus: 'sfx', spatial: { position: [1, -2, 3] }, volume: 0.7 });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        const sourceGain = expectGain(context, 4);
        const sfxGain = expectGain(context, 2);
        const panner = expectPanner(context, 0);

        expect(source.connections).toEqual([sourceGain]);
        expect(sourceGain.connections).toEqual([panner]);
        expect(panner.connections).toEqual([sfxGain]);
        expect(panner.positionX.calls.at(-1)).toEqual({
            method: 'setValueAtTime',
            value: 1,
            time: 10,
        });
        expect(panner.positionY.calls.at(-1)).toEqual({
            method: 'setValueAtTime',
            value: -2,
            time: 10,
        });
        expect(panner.positionZ.calls.at(-1)).toEqual({
            method: 'setValueAtTime',
            value: 3,
            time: 10,
        });
        expect(sourceGain.gain.calls.at(-1)).toEqual({
            method: 'setValueAtTime',
            value: 0.7,
            time: 10,
        });
    });

    it('preempts the lowest-priority voice when the pool is full', async () => {
        const { assetManager, context, manager } = createManager({ poolSize: 2 });
        const lowRef = audioRef('audio/sfx/low.ogg');
        const highRef = audioRef('audio/sfx/high.ogg');
        const newRef = audioRef('audio/sfx/new.ogg');
        assetManager.resolve(lowRef, createAudioBuffer('low'));
        assetManager.resolve(highRef, createAudioBuffer('high'));
        assetManager.resolve(newRef, createAudioBuffer('new'));

        const lowHandle = manager.play(lowRef, { priority: 1 });
        const highHandle = manager.play(highRef, { priority: 10 });
        await flushAudioLoad();

        const lowSource = expectSource(context, 0);
        const highSource = expectSource(context, 1);

        const newHandle = manager.play(newRef, { priority: 5 });
        await flushAudioLoad();

        expect(lowSource.stop).toHaveBeenCalledOnce();
        expect(highSource.stop).not.toHaveBeenCalled();
        expect(lowHandle.valid).toBe(false);
        expect(highHandle.valid).toBe(true);
        expect(newHandle.valid).toBe(true);
        expect(expectSource(context, 2).start).toHaveBeenCalledOnce();
    });

    it('stops and invalidates a single handle', async () => {
        const { assetManager, context, manager } = createManager();
        const ref = audioRef('audio/sfx/click.ogg');
        assetManager.resolve(ref, createAudioBuffer('click'));
        const handle = manager.play(ref);
        await flushAudioLoad();

        const source = expectSource(context, 0);
        const sourceGain = expectGain(context, 4);

        manager.stop(handle);
        manager.stop(handle);

        expect(source.stop).toHaveBeenCalledOnce();
        expect(source.disconnect).toHaveBeenCalledOnce();
        expect(sourceGain.disconnect).toHaveBeenCalledOnce();
        expect(handle.valid).toBe(false);
    });

    it('stops all voices, optionally filtered by bus', async () => {
        const { assetManager, context, manager } = createManager();
        const musicRef = audioRef('audio/music/theme.ogg');
        const sfxRef = audioRef('audio/sfx/explosion.ogg');
        const voiceRef = audioRef('audio/voice/ready.ogg');
        assetManager.resolve(musicRef, createAudioBuffer('music'));
        assetManager.resolve(sfxRef, createAudioBuffer('sfx'));
        assetManager.resolve(voiceRef, createAudioBuffer('voice'));
        const musicHandle = manager.play(musicRef, { bus: 'music' });
        const sfxHandle = manager.play(sfxRef, { bus: 'sfx' });
        const voiceHandle = manager.play(voiceRef, { bus: 'voice' });
        await flushAudioLoad();

        const musicSource = expectSource(context, 0);
        const sfxSource = expectSource(context, 1);
        const voiceSource = expectSource(context, 2);

        manager.stopAll('music');

        expect(musicSource.stop).toHaveBeenCalledOnce();
        expect(sfxSource.stop).not.toHaveBeenCalled();
        expect(voiceSource.stop).not.toHaveBeenCalled();
        expect(musicHandle.valid).toBe(false);
        expect(sfxHandle.valid).toBe(true);
        expect(voiceHandle.valid).toBe(true);

        manager.stopAll();

        expect(sfxSource.stop).toHaveBeenCalledOnce();
        expect(voiceSource.stop).toHaveBeenCalledOnce();
        expect(sfxHandle.valid).toBe(false);
        expect(voiceHandle.valid).toBe(false);
    });

    it('releases a voice when its source ends naturally', async () => {
        const { assetManager, context, manager } = createManager({ poolSize: 1 });
        const firstRef = audioRef('audio/sfx/first.ogg');
        const secondRef = audioRef('audio/sfx/second.ogg');
        assetManager.resolve(firstRef, createAudioBuffer('first'));
        assetManager.resolve(secondRef, createAudioBuffer('second'));
        const firstHandle = manager.play(firstRef);
        await flushAudioLoad();

        const firstSource = expectSource(context, 0);
        firstSource.finish();

        const secondHandle = manager.play(secondRef);
        await flushAudioLoad();

        expect(firstSource.stop).not.toHaveBeenCalled();
        expect(firstHandle.valid).toBe(false);
        expect(secondHandle.valid).toBe(true);
        expect(expectSource(context, 1).start).toHaveBeenCalledOnce();
    });

    it('ducks the requested bus through AudioBus gain automation', () => {
        const { context, manager } = createManager();
        const sfxGain = expectGain(context, 2);
        sfxGain.gain.calls.length = 0;

        manager.duck('sfx', 0.25, 500);

        expect(sfxGain.gain.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 10.05 },
        ]);
    });

    it('disposes active sources, pending handles, and every bus', async () => {
        const { assetManager, context, manager } = createManager();
        const activeRef = audioRef('audio/sfx/active.ogg');
        const pendingRef = audioRef('audio/sfx/pending.ogg');
        assetManager.resolve(activeRef, createAudioBuffer('active'));
        const pending = assetManager.defer(pendingRef);
        const activeHandle = manager.play(activeRef);
        await flushAudioLoad();
        const pendingHandle = manager.play(pendingRef);

        const activeSource = expectSource(context, 0);
        const busGains = context.createdGainNodes.slice(0, 4);

        manager.dispose();
        pending.resolve(createAudioBuffer('pending'));
        await flushAudioLoad();

        expect(activeSource.stop).toHaveBeenCalledOnce();
        expect(activeHandle.valid).toBe(false);
        expect(pendingHandle.valid).toBe(false);
        expect(context.createdSources).toHaveLength(1);
        for (const busGain of busGains) {
            expect(busGain.disconnect).toHaveBeenCalledOnce();
        }
    });

    it('closes the AudioContext when dispose is called', () => {
        const { context, manager } = createManager();

        manager.dispose();

        expect(context.close).toHaveBeenCalledOnce();
    });

    it('creates managers through the public factory', () => {
        const assetManager = new AssetManagerDouble();
        const context = new FakeAudioContext();

        const manager = createAudioManager(assetManager, { audioContext: asAudioContext(context) });
        managers.push(manager as DefaultAudioManager);

        expect(manager).toBeInstanceOf(DefaultAudioManager);
        expect(context.createdGainNodes).toHaveLength(4);
    });

    it('creates a default AudioContext from the global constructor', () => {
        withAudioContextGlobals(
            { AudioContext: asAudioContextConstructor(FakeGlobalAudioContext) },
            () => {
                const assetManager = new AssetManagerDouble();

                const manager = createAudioManager(assetManager);
                managers.push(manager as DefaultAudioManager);

                expect(FakeGlobalAudioContext.instances).toHaveLength(1);
                expect(FakeGlobalAudioContext.instances[0]?.createdGainNodes).toHaveLength(4);
            },
        );
    });

    it('falls back to webkitAudioContext and throws when no global constructor exists', () => {
        withAudioContextGlobals(
            { webkitAudioContext: asAudioContextConstructor(FakeGlobalAudioContext) },
            () => {
                const manager = createAudioManager(new AssetManagerDouble());
                managers.push(manager as DefaultAudioManager);
            },
        );
        expect(FakeGlobalAudioContext.instances).toHaveLength(1);

        withAudioContextGlobals({}, () => {
            expect(() => createAudioManager(new AssetManagerDouble())).toThrow(
                'AudioContext is not available in this environment.',
            );
        });
    });
});

// ─── voice preemption — the reclamation ranking (#123) ──────────────────────────

describe('DefaultAudioManager — voice preemption', () => {
    it('recommends 100 for music, the value §4.25 quotes (#123)', () => {
        // Nothing else pins the exact value: the other tests rank the symbol against
        // literal priorities, which bounds it from below but never fixes it. The docs
        // quote `100`, and the "leaves 1–99 for a game's own scale" reasoning they give
        // holds only at this magnitude.
        expect(MUSIC_PRIORITY).toBe(100);
    });

    it('reclaims a fading-out voice ahead of a live one it outranks and post-dates (#123)', async () => {
        // The load-bearing red for tier 1. Both of the OTHER terms point at the live
        // voice — it is lower priority AND older — so the phase is the only thing that
        // can move the pick onto the tail.
        const created = createManager({ poolSize: 2 });
        const live = playPooledVoice(created, 'live', { priority: 0 });
        const tail = playPooledVoice(created, 'tail', { priority: MUSIC_PRIORITY });
        await flushAudioLoad();

        created.manager.fadeOut(tail, { overMs: 2000 });
        expect(readVoiceRecord(created.manager, tail).phase).toBe('fading-out');

        playPooledVoice(created, 'burst', { priority: 0 });
        await flushAudioLoad();

        expect(tail.valid).toBe(false);
        expect(live.valid).toBe(true);
        expect(expectSource(created.context, 0).stop).not.toHaveBeenCalled();
        expect(expectSource(created.context, 2).start).toHaveBeenCalledOnce();
    });

    it('never treats a LOADING voice as dying, however cheap it would be to reclaim (#123)', async () => {
        // Term 1 is the phase `'fading-out'`, not "is this voice doomed" and not "has
        // this voice made a sound yet". A loading voice has no source and no gain, so
        // reclaiming it truly is cheaper — and it still ranks by priority like any
        // other, which is what keeps a slow-decoding music bed from being the first
        // thing a burst takes.
        //
        // Red against `phase !== 'playing'`, the widening the tier-1 rationale invites.
        const created = createManager({ poolSize: 2 });
        const live = playPooledVoice(created, 'live', { priority: 0 });
        await flushAudioLoad();

        const decoding = playPooledVoice(created, 'decoding', { priority: MUSIC_PRIORITY });
        expect(readVoiceRecord(created.manager, decoding).phase).toBe('loading');

        playPooledVoice(created, 'burst', { priority: 0 });

        expect(live.valid).toBe(false);
        expect(decoding.valid).toBe(true);
    });

    it('ranks a voice condemned by releaseOnStart as an ordinary one (#123, #121)', async () => {
        // The case #123 names: a pre-start `fadeOut` parks `releaseOnStart` and leaves
        // the phase `'loading'`, so the voice is doomed — cheaper still than a tail,
        // having never made a sound — yet outranks a live SFX voice right up until `t0`
        // kills it anyway. The invariant names the phase and only the phase, so this
        // pins the cost of that literalness rather than papering over it.
        const created = createManager({ poolSize: 2 });
        const live = playPooledVoice(created, 'live', { priority: 0 });
        await flushAudioLoad();

        const condemned = playPooledVoice(created, 'condemned', { priority: MUSIC_PRIORITY });
        created.manager.fadeOut(condemned, { overMs: 2000 });
        const record = readVoiceRecord(created.manager, condemned);
        expect(record.releaseOnStart).toBe(true);
        expect(record.phase).toBe('loading');

        playPooledVoice(created, 'burst', { priority: 0 });

        expect(live.valid).toBe(false);
        expect(condemned.valid).toBe(true);
    });

    it('ranks by priority WITHIN the dying set, still ahead of every live voice (#123)', async () => {
        // Tier 1 partitions; it does not flatten. The lower-priority tail goes even
        // though a live voice sits below both of them on priority — so a fading-out
        // voice is not merely "preferred", it is preferred as a GROUP that the
        // remaining terms then rank inside. The victim is also the NEWEST voice while
        // the oldest survives, so this isolates tier 1 from tier 4 as well.
        const created = createManager({ poolSize: 3 });
        const live = playPooledVoice(created, 'live', { priority: 0 });
        const loudTail = playPooledVoice(created, 'loud-tail', { priority: MUSIC_PRIORITY });
        const quietTail = playPooledVoice(created, 'quiet-tail', { priority: 50 });
        await flushAudioLoad();

        created.manager.fadeOut(loudTail, { overMs: 2000 });
        created.manager.fadeOut(quietTail, { overMs: 2000 });
        expect(readVoiceRecord(created.manager, loudTail).phase).toBe('fading-out');
        expect(readVoiceRecord(created.manager, quietTail).phase).toBe('fading-out');

        playPooledVoice(created, 'burst', { priority: 0 });
        await flushAudioLoad();

        expect(quietTail.valid).toBe(false);
        expect(loudTail.valid).toBe(true);
        expect(live.valid).toBe(true);
    });

    it('counts a to-BOUNDED loop as looping, though it schedules its own end (#123, #117)', async () => {
        // The term reads the loop WINDOW, not whether anything will end the voice. A
        // `to` on a looping voice bounds elapsed play duration (#117), so this one has
        // both a window and a scheduled stop — and is still demoted ahead of the older
        // one-shot, which is what makes `voiceLoops` a stand-in for "runs until
        // something else ends it" rather than a computation of it.
        const created = createManager({ poolSize: 2 });
        const blip = playPooledVoice(created, 'blip', { priority: 0 });
        const bounded = playPooledVoice(created, 'bounded', { loop: true, priority: 0, to: 5 });
        await flushAudioLoad();

        const record = readVoiceRecord(created.manager, bounded);
        expect(record.loopWindowSeconds).not.toBeNull();
        expect(record.scheduledStopAt).not.toBeNull();

        playPooledVoice(created, 'burst', { priority: 0 });
        await flushAudioLoad();

        expect(bounded.valid).toBe(false);
        expect(blip.valid).toBe(true);
    });

    it('reclaims a looping voice ahead of an OLDER one-shot at equal priority (#123)', async () => {
        // The load-bearing red for tier 3, and it has to fight tier 4 to be one: the
        // one-shot is older, so age alone reaches the wrong voice. A loop runs until
        // something else ends it; the blip beside it ends itself.
        //
        // The bed is on the MUSIC bus while the blip is not, so this also pins that the
        // bus is no term of its own: #123 puts music continuity on `MUSIC_PRIORITY`
        // alone, and a comparator that protected the music bus would spare the bed here.
        const created = createManager({ poolSize: 2 });
        const blip = playPooledVoice(created, 'blip', { priority: 0 });
        const bed = playPooledVoice(created, 'bed', { bus: 'music', loop: true, priority: 0 });
        await flushAudioLoad();

        playPooledVoice(created, 'burst', { priority: 0 });
        await flushAudioLoad();

        expect(bed.valid).toBe(false);
        expect(blip.valid).toBe(true);
    });

    it('never lets the loop term outrank priority, which is what MUSIC_PRIORITY rests on (#123)', async () => {
        // The mirror of the test above, and the reason tier 3 sits BELOW tier 2: swap
        // the bed onto MUSIC_PRIORITY and it stops being reclaimable at all while any
        // lesser voice is in the pool. A loop term above priority would make the
        // constant inert — no value could lift a music bed clear of a one-shot.
        //
        // A fence on the tier ORDER; the test above drives the term itself.
        const created = createManager({ poolSize: 2 });
        const blip = playPooledVoice(created, 'blip', { priority: 0 });
        const bed = playPooledVoice(created, 'bed', { loop: true, priority: MUSIC_PRIORITY });
        await flushAudioLoad();

        playPooledVoice(created, 'burst', { priority: 0 });
        await flushAudioLoad();

        expect(blip.valid).toBe(false);
        expect(bed.valid).toBe(true);
    });

    it('demotes on the EFFECTIVE loop window, so a BARE collapsed region is a one-shot (#123, #122)', async () => {
        // `VoiceRecord.loop` is the REQUESTED intent and stays true forever, including on
        // this voice — a bare `loopRegion` that collapsed, taking the loop it implied
        // with it, so it plays once through and frees its slot. (Authoring `loop: true`
        // as well would survive the same collapse as a whole-buffer loop, and rank as
        // looping.) Reading the intent would demote this one; reading the window it
        // actually started with leaves tier 4 to pick the older voice.
        //
        // A fence on the tier, a driver on the SIGNAL: age alone reaches the same voice,
        // so what it pins is the read, not the ranking. The 1s buffer collapses
        // `{ start: 1 }`; the test below covers the same read's other branch.
        const created = createCuedManager({ bufferSeconds: 1, poolSize: 2 });
        const warn = spyOnWarn();
        const blip = playPooledVoice(created, 'blip', { priority: 0 });
        const collapsed = created.manager.play(created.ref, {
            loopRegion: { start: 1, end: 'end' },
            priority: 0,
        });
        await flushAudioLoad();

        expect(expectSource(created.context, 1).loop).toBe(false);
        expect(readVoiceRecord(created.manager, collapsed).loopWindowSeconds).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);

        playPooledVoice(created, 'burst', { priority: 0 });
        await flushAudioLoad();

        expect(blip.valid).toBe(false);
        expect(collapsed.valid).toBe(true);
    });

    it('falls back to the REQUESTED intent while a voice is still loading (#123)', async () => {
        // The other branch of the same read, and the one with no effective answer to
        // give: `loopWindowSeconds` is written at `t0`, so a pool can saturate while
        // every voice in it is still decoding. Reading the window alone there would
        // file each of them as a one-shot — and the longest decodes are the music beds
        // the term is named after, so a voice's rank would turn on file size.
        //
        // As in the collapsed-region test above, the loop-intent voice goes SECOND so
        // age cannot reach the same answer: without the fallback both voices read as
        // non-looping, tie on priority, and age takes the older blip instead.
        const created = createManager({ poolSize: 2 });
        const blip = playPooledVoice(created, 'blip', { priority: 0 });
        const bed = playPooledVoice(created, 'bed', { loop: true, priority: 0 });

        expect(readVoiceRecord(created.manager, blip).phase).toBe('loading');
        expect(readVoiceRecord(created.manager, bed).phase).toBe('loading');

        playPooledVoice(created, 'burst', { priority: 0 });

        expect(bed.valid).toBe(false);
        expect(blip.valid).toBe(true);

        await flushAudioLoad();

        // The reclaimed voice had no source yet, so nothing was created for it and the
        // load continuation finds it gone rather than starting it late.
        expect(created.context.createdSources).toHaveLength(2);
    });

    it.each([
        ['bed, blip, chime', [PREEMPTION_BED, PREEMPTION_BLIP, PREEMPTION_CHIME]],
        ['blip, chime, bed', [PREEMPTION_BLIP, PREEMPTION_CHIME, PREEMPTION_BED]],
        ['chime, bed, blip', [PREEMPTION_CHIME, PREEMPTION_BED, PREEMPTION_BLIP]],
    ])(
        'reclaims the same voice whichever order — %s — they were played in (#123)',
        async (_order, plays) => {
            // `findWorstStandingVoice` is a single-pass min-scan, and `voices` iterates in
            // ascending `sequence`, so a ranker that leaves any pair incomparable silently
            // promotes age to the deciding term and the victim follows the play order.
            //
            // A loop term that DECIDES every pair whose loop flags differ, on the
            // "equal-or-higher priority" gate alone, does exactly that to this set:
            // bed@5 ranks neither way against blip@1 or chime@3, so the scan keeps
            // whichever it was seeded with and picks bed in one order, blip in another.
            const created = createManager({ poolSize: 3 });
            const handles = new Map<string, AudioHandle>();
            for (const play of plays) {
                handles.set(play.name, playPooledVoice(created, play.name, play.opts));
            }
            await flushAudioLoad();

            playPooledVoice(created, 'burst', { priority: 0 });
            await flushAudioLoad();

            expect(expectHandle(handles, 'blip').valid).toBe(false);
            expect(expectHandle(handles, 'bed').valid).toBe(true);
            expect(expectHandle(handles, 'chime').valid).toBe(true);
        },
    );

    it('cuts a music crossfade’s dying tail for an SFX burst, never the incoming track (#123)', async () => {
        // The documented consequence of tier 1, and the one shape where it is the only
        // thing standing between a burst and an audible gap: the incoming track here is
        // at the DEFAULT priority — the crossfade options carry none — so on priority
        // alone it is the weakest voice in the pool, and only the phase keeps the burst
        // from cutting the track that just faded in and leaving its tail playing on.
        // Age agrees with the phase here, so this red isolates tier 1 from priority only.
        const created = createManager({ poolSize: 2 });
        const battleRef = audioRef('audio/music/battle.ogg');
        created.assetManager.resolve(battleRef, createAudioBuffer('battle', 10));

        const outgoing = playPooledVoice(created, 'theme', {
            bus: 'music',
            loop: true,
            priority: MUSIC_PRIORITY,
        });
        await flushAudioLoad();

        const incoming = created.manager.crossfade(outgoing, battleRef, {
            durationMs: 2000,
            bus: 'music',
            loop: true,
        });
        await flushAudioLoad();

        expect(readVoiceRecord(created.manager, outgoing).phase).toBe('fading-out');

        playPooledVoice(created, 'burst', { priority: 0 });
        await flushAudioLoad();

        expect(outgoing.valid).toBe(false);
        expect(incoming.valid).toBe(true);
        expect(expectSource(created.context, 1).stop).not.toHaveBeenCalled();
        expect(expectSource(created.context, 2).start).toHaveBeenCalledOnce();
    });

    it('yields a candidate from a pool that is ENTIRELY looping music (#123)', async () => {
        // No voice class is hard-exempt, so a saturated default pool cannot deadlock a
        // higher-priority request even when every slot holds the class most worth
        // protecting. Operationally that is a claim about the SHAPE of the scan — no
        // filter, no skip — which no ranking term can express, so this fences rather
        // than drives: any unfiltered comparator passes it.
        const created = createManager();
        const beds: AudioHandle[] = [];
        for (let index = 0; index < 32; index += 1) {
            beds.push(
                playPooledVoice(created, `bed-${index}`, {
                    bus: 'music',
                    loop: true,
                    priority: MUSIC_PRIORITY,
                }),
            );
        }
        await flushAudioLoad();

        const alarm = playPooledVoice(created, 'alarm', { priority: MUSIC_PRIORITY + 1 });
        await flushAudioLoad();

        // All 32 tie on phase, priority and loop, leaving the oldest bed — though tier 4
        // is not what this observes: the scan would reach the same voice without it,
        // since `voices` iterates in insertion order and a tie keeps the incumbent.
        expect(beds.map((bed) => bed.valid)).toEqual([false, ...beds.slice(1).map(() => true)]);
        expect(alarm.valid).toBe(true);
        expect(expectSource(created.context, 32).start).toHaveBeenCalledOnce();
    });
});

// ─── static cue validation — synchronous reject at play() (#117) ────────────────

describe('DefaultAudioManager — static cue validation', () => {
    it('rejects a to-before-from window at play() without reserving a voice (#117)', async () => {
        // poolSize 1: every code path that reaches reserveVoiceSlot() preempts the
        // live voice. A static reject returns BEFORE it, so the incumbent survives —
        // that survival is how "no voice reserved" is observable from outside.
        const { assetManager, context, manager } = createManager({ poolSize: 1 });
        const liveRef = audioRef('audio/music/theme.ogg');
        const rejectedRef = audioRef('audio/sfx/rejected.ogg');
        assetManager.resolve(liveRef, createAudioBuffer('theme', 10));
        assetManager.resolve(rejectedRef, createAudioBuffer('rejected', 10));
        const liveHandle = manager.play(liveRef, { priority: 0 });
        await flushAudioLoad();
        const liveSource = expectSource(context, 0);
        const warn = spyOnWarn();

        const rejected = manager.play(rejectedRef, { from: 5, priority: 99, to: 2 });

        expect(rejected.valid).toBe(false);
        expect(liveHandle.valid).toBe(true);
        expect(liveSource.stop).not.toHaveBeenCalled();
        expect(assetManager.loadCalls).toEqual([liveRef]);
        expect(warn).toHaveBeenCalledTimes(1);

        await flushAudioLoad();

        expect(context.createdSources).toHaveLength(1);
    });

    it('rejects a zero-length window whose to equals its from (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager();
        spyOnWarn();

        expect(manager.play(ref, { from: 3, to: 3 }).valid).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
    });

    it('treats "start" as a synchronously finite bound (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager();
        spyOnWarn();

        expect(manager.play(ref, { from: 'start', to: 0 }).valid).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
    });

    it('treats a negative bound as synchronously finite, not clamp-dependent (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager();
        spyOnWarn();

        expect(manager.play(ref, { from: 5, to: -1 }).valid).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
    });

    it('compares raw bounds, so a low-clamping pair in order is not already out of order (#117)', () => {
        // Both clamp to 0 and the window will collapse, but `-3 < 0` is IN order — the
        // static tier only fires on an order that is already wrong.
        const { assetManager, manager, ref } = createCuedManager();
        spyOnWarn();

        expect(manager.play(ref, { from: -3, to: 0 }).valid).toBe(true);
        expect(assetManager.loadCalls).toEqual([ref]);
    });

    it('rejects a named pair resolved from the cue sheet parsed inside play (#117)', () => {
        // Nothing has been decoded yet, so passing this gate proves the sheet was read
        // and parsed synchronously inside play() (Invariant #124).
        const { assetManager, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        spyOnWarn();

        const handle = manager.play(ref, { from: { name: 'loopEnd' }, to: { name: 'loopStart' } });

        expect(handle.valid).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
    });

    it('rejects a loopRegion whose end is at or before its start (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager();
        spyOnWarn();

        expect(manager.play(ref, { loopRegion: { start: 6, end: 2 } }).valid).toBe(false);
        expect(manager.play(ref, { loopRegion: { start: 4, end: 4 } }).valid).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
    });

    it('defers to the dynamic tier for any bound that needs the decoded buffer (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        spyOnWarn();

        // 'end' is buffer-relative and an absent cue name is unresolvable without the
        // sheet; neither may be statically rejected, however wrong the pair looks.
        expect(manager.play(ref, { from: 'end', to: 2 }).valid).toBe(true);
        expect(manager.play(ref, { from: { name: 'nope' }, to: 1 }).valid).toBe(true);
        expect(assetManager.loadCalls).toHaveLength(2);
    });

    it('defers an infinite bound rather than rejecting it statically (#117)', () => {
        // The signed infinities are what make the finiteness guard load-bearing: they
        // COMPARE. `2 <= +Infinity` and `-Infinity <= 5` are both true, so dropping the
        // guard would statically reject each of these. NaN cannot pin it — every NaN
        // comparison is false, so a NaN bound never rejects with or without the guard.
        const { assetManager, manager, ref } = createCuedManager();
        spyOnWarn();

        expect(manager.play(ref, { from: Number.POSITIVE_INFINITY, to: 2 }).valid).toBe(true);
        expect(manager.play(ref, { from: 5, to: Number.NEGATIVE_INFINITY }).valid).toBe(true);
        expect(manager.play(ref, { from: Number.NaN, to: 2 }).valid).toBe(true);
        expect(assetManager.loadCalls).toHaveLength(3);
    });

    it('never statically rejects a single bound that is in order against the default (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager();
        const warn = spyOnWarn();

        expect(manager.play(ref, { to: 2 }).valid).toBe(true);
        expect(manager.play(ref, { from: 5 }).valid).toBe(true);
        expect(assetManager.loadCalls).toHaveLength(2);
        expect(warn).not.toHaveBeenCalled();
    });

    it('defaults an omitted from to "start" when gating a to-only window (#117)', () => {
        // Without the `?? 'start'` default these escape the gate entirely: there is no
        // second bound to compare against, so nothing is out of order.
        const { assetManager, manager, ref } = createCuedManager();
        spyOnWarn();

        expect(manager.play(ref, { to: 0 }).valid).toBe(false);
        expect(manager.play(ref, { to: -1 }).valid).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
    });

    it('treats a cue name matching only an Object prototype member as absent (#118)', async () => {
        // `cues` is a plain object, so a bare index reaches Object.prototype and yields
        // the `constructor` FUNCTION. BOTH bounds must be prototype names: relational
        // comparison of two functions coerces each to a string, so `fn <= fn` is TRUE
        // and an unguarded read would statically REJECT this play. A prototype name
        // paired with a real number mixes types, compares false, and hides the bug.
        const { assetManager, context, manager, ref } = createCuedManager({
            metadata: { cues: { chorus: 4 }, durationSeconds: 10 },
        });
        const warn = spyOnWarn();

        const handle = manager.play(ref, {
            from: { name: 'constructor' },
            to: { name: 'constructor' },
        });

        // Deferred, not statically rejected: the load started and the handle is live.
        expect(handle.valid).toBe(true);
        expect(assetManager.loadCalls).toEqual([ref]);

        await flushAudioLoad();

        // …and the dynamic tier then abandons it, treating the name as absent.
        expect(handle.valid).toBe(false);
        expect(context.createdSources).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('ignores a numeric value inherited from a polluted Object prototype (#118)', () => {
        // `typeof` alone rejects every REAL Object.prototype member, since none is a
        // number. Only a prototype polluted with a numeric property separates the
        // own-key check from it — without `Object.hasOwn` this pair resolves to 5/5
        // and statically rejects.
        const { assetManager, manager, ref } = createCuedManager({
            metadata: { cues: { chorus: 4 }, durationSeconds: 10 },
        });
        spyOnWarn();
        const polluted = Object.prototype as unknown as Record<string, unknown>;

        try {
            polluted['inherited'] = 5;

            expect(
                manager.play(ref, { from: { name: 'inherited' }, to: { name: 'inherited' } }).valid,
            ).toBe(true);
            expect(assetManager.loadCalls).toEqual([ref]);
        } finally {
            Reflect.deleteProperty(polluted, 'inherited');
        }
    });

    it('names the offending window in each static rejection warning (#117)', () => {
        const { manager, ref } = createCuedManager();
        const warn = spyOnWarn();

        manager.play(ref, { from: 5, to: 2 });

        expect(String(warn.mock.calls[0]?.[0])).toBe(
            'Audio play window [5s, 2s] is already out of order; rejecting play().',
        );

        warn.mockClear();
        manager.play(ref, { loopRegion: { start: 6, end: 3 } });

        expect(String(warn.mock.calls[0]?.[0])).toBe(
            'Audio loop region [6s, 3s] is already out of order; rejecting play().',
        );
    });
});

// ─── static spatial validation — synchronous reject at play() (#117) ────────────
//
// `resolveSpatialSpec`'s own case matrix lives in `Spatial.test.ts`; these pin the
// `play()` WIRING — the reject returns before any slot is reserved or load started,
// prints exactly one warning, and an accepted spec still reaches the panner.

describe('DefaultAudioManager — static spatial validation', () => {
    it('rejects inverted distances at play() without reserving a voice (#117)', async () => {
        // poolSize 1: every code path that reaches reserveVoiceSlot() preempts the
        // live voice. A static reject returns BEFORE it, so the incumbent survives —
        // that survival is how "no voice reserved" is observable from outside.
        const { assetManager, context, manager } = createManager({ poolSize: 1 });
        const liveRef = audioRef('audio/music/theme.ogg');
        const rejectedRef = audioRef('audio/sfx/rejected.ogg');
        assetManager.resolve(liveRef, createAudioBuffer('theme', 10));
        assetManager.resolve(rejectedRef, createAudioBuffer('rejected', 10));
        const liveHandle = manager.play(liveRef, { priority: 0 });
        await flushAudioLoad();
        const liveSource = expectSource(context, 0);
        const warn = spyOnWarn();

        const rejected = manager.play(rejectedRef, {
            priority: 99,
            spatial: { position: [0, 0, 0], fullVolumeDistance: 5, falloffDistance: 2 },
        });

        expect(rejected.valid).toBe(false);
        expect(liveHandle.valid).toBe(true);
        expect(liveSource.stop).not.toHaveBeenCalled();
        expect(assetManager.loadCalls).toEqual([liveRef]);
        expect(warn).toHaveBeenCalledTimes(1);

        await flushAudioLoad();

        expect(context.createdSources).toHaveLength(1);
    });

    it('accepts equal distances as an authored hard cutoff (#117)', async () => {
        const { assetManager, context, manager } = createManager();
        const ref = audioRef('audio/sfx/cutoff.ogg');
        assetManager.resolve(ref, createAudioBuffer('cutoff'));
        const warn = spyOnWarn();

        const handle = manager.play(ref, {
            spatial: { position: [1, 2, 3], fullVolumeDistance: 4, falloffDistance: 4 },
        });

        expect(handle.valid).toBe(true);
        expect(assetManager.loadCalls).toEqual([ref]);
        expect(warn).not.toHaveBeenCalled();

        await flushAudioLoad();

        expect(context.createdPannerNodes).toHaveLength(1);
    });

    it('accepts a fullVolumeDistance of zero', async () => {
        const { assetManager, manager } = createManager();
        const ref = audioRef('audio/sfx/point.ogg');
        assetManager.resolve(ref, createAudioBuffer('point'));
        const warn = spyOnWarn();

        const handle = manager.play(ref, {
            spatial: { position: [0, 0, 0], fullVolumeDistance: 0, falloffDistance: 6 },
        });

        expect(handle.valid).toBe(true);
        expect(assetManager.loadCalls).toEqual([ref]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('rejects a negative or non-finite distance rather than coercing it (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager();
        const warn = spyOnWarn();

        expect(
            manager.play(ref, { spatial: { position: [0, 0, 0], fullVolumeDistance: -1 } }).valid,
        ).toBe(false);
        expect(
            manager.play(ref, { spatial: { position: [0, 0, 0], falloffDistance: Number.NaN } })
                .valid,
        ).toBe(false);
        expect(
            manager.play(ref, {
                spatial: { position: [0, 0, 0], falloffDistance: Number.POSITIVE_INFINITY },
            }).valid,
        ).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('rejects a non-finite position component and a negative rolloffFactor on the same static path (#117)', () => {
        const { assetManager, manager, ref } = createCuedManager();
        const warn = spyOnWarn();

        expect(manager.play(ref, { spatial: { position: [Number.NaN, 0, 0] } }).valid).toBe(false);
        expect(
            manager.play(ref, { spatial: { position: [0, 0, 0], rolloffFactor: -1 } }).valid,
        ).toBe(false);
        expect(assetManager.loadCalls).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('creates no panner and validates nothing when spatial is omitted', async () => {
        const { context, manager, ref } = createCuedManager();
        const warn = spyOnWarn();

        const handle = manager.play(ref);
        await flushAudioLoad();

        expect(handle.valid).toBe(true);
        expect(context.createdPannerNodes).toHaveLength(0);
        expect(warn).not.toHaveBeenCalled();
    });

    it('names the offending values in each spatial rejection warning (#117)', () => {
        const { manager, ref } = createCuedManager();
        const warn = spyOnWarn();

        manager.play(ref, {
            spatial: { position: [0, 0, 0], fullVolumeDistance: 5, falloffDistance: 2 },
        });

        expect(String(warn.mock.calls[0]?.[0])).toBe(
            'Audio spatial distance band [5, 2] is already out of order; rejecting play().',
        );

        warn.mockClear();
        manager.play(ref, { spatial: { position: [0, 0, 0], fullVolumeDistance: -3 } });

        expect(String(warn.mock.calls[0]?.[0])).toBe(
            'Audio spatial fullVolumeDistance -3 is negative or not finite; rejecting play().',
        );
    });
});

// ─── dynamic cue validation — resolve, clamp, drop at startVoice (#117, #118) ───

describe('DefaultAudioManager — dynamic cue validation', () => {
    it('abandons the play with one warning when a load-bearing from cue is unresolvable (#118)', async () => {
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { from: { name: 'missing' } });
        await flushAudioLoad();

        expect(handle.valid).toBe(false);
        // Resolution precedes node creation, so an abandoned play leaves no orphan.
        expect(context.createdSources).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns once, naming only from, when both bounds are unresolvable (#118)', async () => {
        const { manager, ref } = createCuedManager({ metadata: { durationSeconds: 10 } });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { from: { name: 'badFrom' }, to: { name: 'badTo' } });
        await flushAudioLoad();

        expect(handle.valid).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('badFrom');
        expect(String(warn.mock.calls[0]?.[0])).not.toContain('badTo');
    });

    it('gates from against the decoded duration, not the authored durationSeconds (#118)', async () => {
        // The sheet claims 10 s and places `chorus` at 4 s, but the clip decodes to 3 s.
        const { context, manager, ref } = createCuedManager({
            bufferSeconds: 3,
            metadata: THEME_CUE_SHEET,
        });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { from: { name: 'chorus' } });
        await flushAudioLoad();

        expect(handle.valid).toBe(false);
        expect(context.createdSources).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('clamps a to beyond the decoded duration down to the buffer end (#118)', async () => {
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { from: 2, to: 50 });
        await flushAudioLoad();

        expect(expectSource(context, 0).start).toHaveBeenCalledWith(0, 2, 8);
    });

    it('clamps a negative from up to the buffer start without warning (#118)', async () => {
        const { context, manager, ref } = createCuedManager();
        const warn = spyOnWarn();

        manager.play(ref, { from: -3, to: 4 });
        await flushAudioLoad();

        expect(expectSource(context, 0).start).toHaveBeenCalledWith(0, 0, 4);
        expect(warn).not.toHaveBeenCalled();
    });

    it('drops a window that collapses only after clamping and keeps the from anchor (#118)', async () => {
        // Sheet places `outro` at 9 s; the clip decodes to 3 s, so `to` clamps to 3 and
        // meets `from` exactly. The bound is dropped; the resolved anchor is kept.
        const { context, manager, ref } = createCuedManager({
            bufferSeconds: 3,
            metadata: THEME_CUE_SHEET,
        });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { from: 3, to: { name: 'outro' } });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(handle.valid).toBe(true);
        expect(source.start).toHaveBeenCalledWith(0, 3);
        expect(expectStartArgs(source)[2]).toBeUndefined();
        expect(source.stop).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns once when an abandoning loop region accompanies a collapsing window (#118)', async () => {
        // The window drops ("continuing playback") and the region abandons. Resolving
        // the region first keeps the surviving outcome the only thing reported.
        const { context, manager, ref } = createCuedManager({
            bufferSeconds: 3,
            metadata: THEME_CUE_SHEET,
        });
        const warn = spyOnWarn();

        const handle = manager.play(ref, {
            from: 3,
            to: { name: 'outro' },
            loopRegion: { start: { name: 'nope' }, end: 6 },
        });
        await flushAudioLoad();

        expect(handle.valid).toBe(false);
        expect(context.createdSources).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('nope');
        expect(String(warn.mock.calls[0]?.[0])).not.toContain('continuing playback');
    });

    it('names the unbounded outcome when a looping voice loses its to bound (#118)', async () => {
        // The sibling of the non-loop drop, and a different outcome: with no `to` left
        // and `loop` still on, this voice has NO determinate end. Saying "playback
        // continues" here would understate it.
        const { context, manager, ref } = createCuedManager({
            bufferSeconds: 3,
            metadata: THEME_CUE_SHEET,
        });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { loop: true, from: 3, to: { name: 'outro' } });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(handle.valid).toBe(true);
        expect(source.loop).toBe(true);
        expect(source.stop).not.toHaveBeenCalled();
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('loop with no scheduled end');
    });

    it('logs no warning for a fully resolvable cue window (#118)', async () => {
        const { manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const warn = spyOnWarn();

        manager.play(ref, { from: { name: 'loopStart' }, to: { name: 'outro' } });
        await flushAudioLoad();

        expect(warn).not.toHaveBeenCalled();
    });
});

// ─── play-from / play-to scheduling (#117) ──────────────────────────────────────

describe('DefaultAudioManager — cue scheduling', () => {
    it('starts at offset zero with no duration argument when no cues are given (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        manager.play(ref);
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.start).toHaveBeenCalledWith(0, 0);
        expect(expectStartArgs(source)[2]).toBeUndefined();
    });

    it('passes the resolved from cue as the start offset argument (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { from: 2.5 });
        await flushAudioLoad();

        expect(expectSource(context, 0).start).toHaveBeenCalledWith(0, 2.5);
    });

    it('passes a non-loop window length as the third start argument (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { from: 2, to: 6 });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        // The native duration argument bounds the voice; no scheduled stop is needed.
        expect(source.start).toHaveBeenCalledWith(0, 2, 4);
        expect(source.stop).not.toHaveBeenCalled();
    });

    it('resolves named from and to cues against the clip cue sheet (#124)', async () => {
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });

        manager.play(ref, { from: { name: 'chorus' }, to: { name: 'outro' } });
        await flushAudioLoad();

        expect(expectSource(context, 0).start).toHaveBeenCalledWith(0, 4, 5);
    });
});

// ─── loop regions (#117) ────────────────────────────────────────────────────────

describe('DefaultAudioManager — loop regions', () => {
    it('sets loop, loopStart, and loopEnd from an explicit loopRegion (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        // No `loop: true` — the region alone implies it.
        manager.play(ref, { loopRegion: { start: 2, end: 6 } });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.loop).toBe(true);
        expect(source.loopStart).toBe(2);
        expect(source.loopEnd).toBe(6);
    });

    it('resolves a named loopRegion against the cue sheet (#124)', async () => {
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });

        manager.play(ref, {
            loopRegion: { start: { name: 'loopStart' }, end: { name: 'loopEnd' } },
        });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.loopStart).toBe(2);
        expect(source.loopEnd).toBe(6);
    });

    it('falls back to the sheet defaultLoopRegion when loop is true with no region (#117)', async () => {
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });

        manager.play(ref, { loop: true });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.loop).toBe(true);
        expect(source.loopStart).toBe(2);
        expect(source.loopEnd).toBe(6);
    });

    it('loops the whole buffer when the sheet declares no defaultLoopRegion (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { loop: true });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.loop).toBe(true);
        // Untouched: `loopStart === loopEnd === 0` is Web Audio's whole-buffer sentinel,
        // so the manager must not write bounds it did not resolve.
        expect(source.loopStart).toBe(0);
        expect(source.loopEnd).toBe(0);
    });

    it('disables looping when an explicit loopRegion collapses after clamping (#118)', async () => {
        const { context, manager, ref } = createCuedManager({ bufferSeconds: 1 });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { loopRegion: { start: 1, end: 'end' } });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(handle.valid).toBe(true);
        expect(source.loop).toBe(false);
        expect(source.start).toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        // The resolver's own wording describes dropping a PLAY window. The outcome here
        // is narrower, and the message must say which one actually happened.
        expect(String(warn.mock.calls[0]?.[0])).toContain('disabling looping');
    });

    it('keeps an explicitly requested loop when its loopRegion collapses (#117)', async () => {
        // `loop: true` and `loopRegion` are SEPARATE authored intents. A region that
        // cannot be honoured takes an implied loop with it (test above), but must not
        // silently discard a loop the caller asked for in its own right — the same
        // provenance rule that keeps a bad sheet default from silencing a play.
        const { context, manager, ref } = createCuedManager({ bufferSeconds: 1 });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { loop: true, loopRegion: { start: 1, end: 'end' } });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(handle.valid).toBe(true);
        expect(source.loop).toBe(true);
        expect(source.loopStart).toBe(0);
        expect(source.loopEnd).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('looping the whole buffer instead');
    });

    it('abandons the play when an explicit loopRegion anchor is unresolvable (#118)', async () => {
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { loopRegion: { start: { name: 'nope' }, end: 6 } });
        await flushAudioLoad();

        expect(handle.valid).toBe(false);
        expect(context.createdSources).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('degrades a sheet defaultLoopRegion beyond the decoded buffer to a whole-buffer loop', async () => {
        // The author wrote `loop: true`, not a region: an engine-supplied default that
        // no longer fits the decoded clip must warn and degrade, never silence the play.
        const { context, manager, ref } = createCuedManager({
            bufferSeconds: 1,
            metadata: THEME_CUE_SHEET,
        });
        const warn = spyOnWarn();

        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(handle.valid).toBe(true);
        expect(source.loop).toBe(true);
        expect(source.loopStart).toBe(0);
        expect(source.loopEnd).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
        // The resolver reports this as an ABANDON. Re-logging that verbatim would tell
        // the operator playback stopped while it is in fact still looping, so the
        // manager must own a message naming the outcome that actually happened.
        expect(String(warn.mock.calls[0]?.[0])).toContain('looping the whole buffer instead');
        expect(String(warn.mock.calls[0]?.[0])).not.toContain('abandoning playback');
    });

    it('folds a from beyond the loop window back into the loop period (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        // period = 6 - 2 = 4; (9 - 2) mod 4 = 3; entry = 2 + 3 = 5.
        manager.play(ref, { from: 9, loopRegion: { start: 2, end: 6 } });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.start).toHaveBeenCalledWith(0, 5);
        expect(source.loopStart).toBe(2);
        expect(source.loopEnd).toBe(6);
    });

    it('leaves a from before the loop window untouched for the intro-then-loop pattern (#117)', async () => {
        // The anchor must sit a FULL PERIOD or more before the window for the guard to
        // be observable (`loopStart - from >= period`): JS `%` keeps the dividend's
        // sign, so folding this anyway gives `3 + (-3 % 2)` = 2 — a silently late entry
        // that skips the intro. A nearer anchor folds to itself and proves nothing,
        // which is what the earlier `from: 0.5` with `[2, 6]` did.
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { from: 0, loopRegion: { start: 3, end: 5 } });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.start).toHaveBeenCalledWith(0, 0);
        expect(source.loopStart).toBe(3);
        expect(source.loopEnd).toBe(5);
    });

    it('stops a looping voice at the real start plus the elapsed window length (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { loop: true, from: 2, to: 6 });
        // Decode latency: the clock advances between play() and startVoice. Anchoring to
        // call time would give 14; the schedule must anchor to the REAL start.
        context.currentTime = 12;
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.stop).toHaveBeenCalledWith(16);
        // A looping voice must never receive the native duration argument, which bounds
        // a buffer window rather than total elapsed play time.
        expect(expectStartArgs(source)[2]).toBeUndefined();
    });

    it('measures a folded voice to from the raw anchor, not the folded entry point (#117)', async () => {
        // from 9 folds to entry 5 (period 4), but `to: 10` was authored against the raw
        // anchor: 10 − 9 = 1 s of material. Measuring from the folded entry would give
        // 10 − 5 = 5 s and overrun the authored bound five-fold.
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { from: 9, to: 10, loopRegion: { start: 2, end: 6 } });
        context.currentTime = 12;
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.start).toHaveBeenCalledWith(0, 5);
        expect(source.stop).toHaveBeenCalledWith(13);
    });

    it('clamps a looping to beyond the buffer to one pass of the clip (#117)', async () => {
        // `to` is a position on the buffer timeline, so the longest elapsed bound is
        // `duration − from`. Asking for 60 s of a 10 s clip yields 8 s, not 60.
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { loop: true, from: 2, to: 60 });
        await flushAudioLoad();

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(18);
    });

    it('advertises no scheduled end when the stop cannot be scheduled (#117)', async () => {
        // A voice whose stop was refused keeps looping. Nothing may later read a
        // scheduled end off it, so the failed schedule must leave no trace.
        const { context, manager, ref } = createCuedManager();
        const warn = spyOnWarn();
        context.failNextStopSchedule = true;

        const handle = manager.play(ref, { loop: true, from: 2, to: 6 });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(source.stop).toHaveBeenCalledWith(14);
        expect(handle.valid).toBe(true);
        expect(source.loop).toBe(true);
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBeNull();
        // Containment must not make the failure invisible: the caller asked for a
        // bounded loop and is getting an unbounded one.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('loop with no scheduled end');
    });

    it('records the scheduled end when the stop is accepted (#117)', async () => {
        const { context, manager, ref } = createCuedManager();

        const handle = manager.play(ref, { loop: true, from: 2, to: 6 });
        await flushAudioLoad();

        expect(context.createdSources).toHaveLength(1);
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBe(14);
    });

    it('records the playhead anchors a later fade derives its timing from (#122)', async () => {
        // Folded entry (period 4, (9-2) mod 4 = 3 → 5) and a real start time advanced
        // past the play() call. The decoded duration and the EFFECTIVE loop window are
        // recorded with them: the requested `loop`/`loopRegion` intents cannot stand in
        // for either, since a collapsed window disables looping and the authoring
        // sheet's durationSeconds is not the decoded one.
        const { context, manager, ref } = createCuedManager();

        const handle = manager.play(ref, { from: 9, loopRegion: { start: 2, end: 6 } });
        context.currentTime = 12;
        await flushAudioLoad();

        expect(readVoiceRecord(manager, handle)).toMatchObject({
            startOffsetSeconds: 5,
            startedAtContextTime: 12,
            bufferDurationSeconds: 10,
            loopWindowSeconds: { startSeconds: 2, endSeconds: 6 },
        });
    });

    it('records a whole-buffer loop as the window a cue-relative fade wraps by (#122)', async () => {
        // A loop with no region has no loopStart/loopEnd on the source — the Web Audio
        // sentinel for "loop the whole buffer" — so the period a fade wraps by is only
        // knowable from the decoded duration.
        const { manager, ref } = createCuedManager();

        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();

        expect(readVoiceRecord(manager, handle)).toMatchObject({
            loopWindowSeconds: { startSeconds: 0, endSeconds: 10 },
        });
    });

    it('records no loop window for a voice that does not loop (#122)', async () => {
        const { manager, ref } = createCuedManager();

        const handle = manager.play(ref);
        await flushAudioLoad();

        expect(readVoiceRecord(manager, handle).loopWindowSeconds).toBeNull();
    });

    it('releases a looping voice through onended when its scheduled stop fires (#119)', async () => {
        const { context, manager, ref } = createCuedManager();

        const handle = manager.play(ref, { loop: true, to: 4 });
        await flushAudioLoad();

        const source = expectSource(context, 0);
        expect(handle.valid).toBe(true);
        // The release rides the native `onended`; no wall-clock timer schedules it.
        // Fake timers are installed for the whole file, so a stray setTimeout would show.
        expect(vi.getTimerCount()).toBe(0);

        source.finish();

        expect(handle.valid).toBe(false);
    });

    it('lets an explicit stop supersede a scheduled stop without double-releasing', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { loop: true, to: 4 });
        await flushAudioLoad();
        const source = expectSource(context, 0);

        expect(() => {
            manager.stop(handle);
        }).not.toThrow();

        expect(handle.valid).toBe(false);
        expect(source.stop).toHaveBeenCalledTimes(2);
        expect(source.disconnect).toHaveBeenCalledOnce();

        // The scheduled stop still fires afterwards on a real context. Release nulled
        // the handler, so it must reach nothing — pinning single-release directly
        // rather than inferring it from the disconnect count.
        expect(() => {
            source.finish();
        }).not.toThrow();
        expect(source.disconnect).toHaveBeenCalledOnce();
    });
});

// ─── fade-in and pending intents (#121) ─────────────────────────────────────────

describe('DefaultAudioManager — fade-in and pending intents', () => {
    it('parks PlayOptions.fadeIn on the record as a pending intent (#121)', () => {
        const { manager, handle } = createLoadingVoice({
            playOptions: { fadeIn: { durationMs: 750, curve: 'equalPower' } },
        });

        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'loading',
            pendingFadeIn: { durationMs: 750, curve: 'equalPower' },
            pendingFadeTo: null,
            linkedFadeOut: null,
            releaseOnStart: false,
        });
    });

    it('schedules no ramp while the voice is loading, and never on a bus gain (#121, #116)', async () => {
        const { context, manager, handle, start } = createLoadingVoice({
            playOptions: { fadeIn: { durationMs: 500 } },
        });
        manager.fadeTo(handle, { to: 0.25, durationMs: 200 });
        writeVoiceIntents(manager, handle, { linkedFadeOut: vi.fn() });

        // Only the four bus gains exist: there is no stage-1 gain for a ramp to write
        // to, which is precisely why an intent arriving now has to be parked.
        expect(context.createdGainNodes).toHaveLength(4);
        // Snapshots, not ramp counts: #116 says these are never WRITTEN by a fade op, so
        // a stray setValueAtTime or cancel has to fail here too, not just a ramp.
        const busCallsBefore = context.createdGainNodes.map((gain) => [...gain.gain.calls]);
        expect(busCallsBefore.map(countGainRamps)).toEqual([0, 0, 0, 0]);

        await start();

        expect(context.createdGainNodes).toHaveLength(5);
        expect(context.createdGainNodes.slice(0, 4).map((gain) => gain.gain.calls)).toEqual(
            busCallsBefore,
        );
        expect(countGainRamps(expectGain(context, 4).gain.calls)).toBeGreaterThan(0);
    });

    it('applies pending intents at t0 in the fixed precedence order (#121)', async () => {
        const { context, manager, handle, start } = createLoadingVoice({
            playOptions: { fadeIn: { durationMs: 500 } },
        });
        const linkedCalls: { readonly startedAt: number; readonly gainWrites: number }[] = [];
        manager.fadeTo(handle, { to: 0.25, durationMs: 200 });
        writeVoiceIntents(manager, handle, {
            linkedFadeOut: (startedAt) => {
                linkedCalls.push({
                    startedAt,
                    gainWrites: expectGain(context, 4).gain.calls.length,
                });
            },
        });

        expect(context.createdSources).toHaveLength(0);
        expect(linkedCalls).toHaveLength(0);

        await start();

        const gainCalls = expectGain(context, 4).gain.calls;
        expect(gainCalls).toEqual([
            // pendingFadeIn: the floor at t0, then the ramp up to `volume`…
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 1, time: 10.5 },
            // …then pendingFadeTo re-anchors over it and takes the voice elsewhere.
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 10.2 },
        ]);
        // The linkage fires last, on the same t0, with every gain write already laid
        // down. Counting writes AT the call is what makes that an ordering claim about
        // this voice rather than about whatever else the manager touched.
        expect(linkedCalls).toEqual([{ startedAt: 10, gainWrites: gainCalls.length }]);
    });

    it('never creates a source when releaseOnStart was set before the voice started (#121)', async () => {
        const warn = spyOnWarn();
        const { context, manager, handle, start } = createLoadingVoice({
            // `from: 'end'` with an over-long `to` collapses only AFTER clamping, so
            // resolveVoiceSchedule warns for it. A silent run therefore proves the
            // short-circuit precedes schedule resolution, not merely node creation —
            // a voice about to be torn down must not narrate playback that continues.
            playOptions: { from: 'end', to: 20, fadeIn: { durationMs: 500 } },
        });
        const linked = vi.fn();
        manager.fadeTo(handle, { to: 0.25, durationMs: 200 });
        writeVoiceIntents(manager, handle, { releaseOnStart: true, linkedFadeOut: linked });

        await start();

        expect(context.createdSources).toHaveLength(0);
        expect(context.createdGainNodes).toHaveLength(4);
        expect(linked).not.toHaveBeenCalled();
        expect(handle.valid).toBe(false);
        expect(() => readVoiceRecord(manager, handle)).toThrow();
        expect(warn).not.toHaveBeenCalled();
    });

    it('moves the voice from loading to playing and clears every applied intent (#121)', async () => {
        const { manager, handle, start } = createLoadingVoice({
            playOptions: { fadeIn: { durationMs: 500 } },
        });
        manager.fadeTo(handle, { to: 0.25, durationMs: 200 });
        writeVoiceIntents(manager, handle, { linkedFadeOut: vi.fn() });

        expect(readVoiceRecord(manager, handle).phase).toBe('loading');

        await start();

        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'playing',
            pendingFadeIn: null,
            pendingFadeTo: null,
            linkedFadeOut: null,
        });
    });

    it('ramps a fade-in from silence up to volume (#121, #120)', async () => {
        const { context, start } = createLoadingVoice({
            playOptions: { volume: 0.8, fadeIn: { durationMs: 500 } },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.8, time: 10.5 },
        ]);
    });

    it('departs an exponential fade-in from the curve floor, not from zero (#121, #120)', async () => {
        // Exponential automation is a ratio and cannot leave zero: a floor of 0 makes
        // scheduleGainRamp fall back to linear, silently discarding the authored curve.
        const { context, start } = createLoadingVoice({
            playOptions: { fadeIn: { durationMs: 500, curve: 'exponential' } },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1e-4, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 1, time: 10.5 },
        ]);
    });

    it('departs a fade-in from the floor it wrote, not from what the param can report (#121, #120)', async () => {
        // A real AudioParam's `value` reports the last RENDERED quantum, so the floor
        // this voice just scheduled is invisible to it and reading it back yields the
        // node's default gain of 1. `equalPower` derives every waypoint from that
        // departure, so the misread does not merely soften the fade — with volume 0.5 it
        // inverts it into a climb to ~1.0 in one waypoint followed by a decay, i.e. an
        // overshoot to double the requested volume where a fade-IN was authored.
        const { context, start } = createLoadingVoice({
            quantizedGainParams: true,
            playOptions: {
                volume: 0.5,
                loop: true,
                fadeIn: { durationMs: 640, curve: 'equalPower' },
            },
        });

        await start();

        const calls = expectGain(context, 4).gain.calls;
        expect(calls[0]).toEqual({ method: 'setValueAtTime', value: 0, time: 10 });

        const waypoints = calls.filter((call) => call.method === 'linearRampToValueAtTime');
        expect(waypoints).toHaveLength(64);
        // Rising from the floor: the first waypoint is a hair above silence, every one
        // stays within the requested volume, and the last lands exactly on it.
        expect(waypoints[0]?.value).toBeCloseTo(0.5 * Math.sin(Math.PI / 128), 12);
        for (const waypoint of waypoints) {
            expect(waypoint.value).toBeLessThanOrEqual(0.5);
        }
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0.5,
            time: 10.64,
        });
    });

    it('leaves the fade-in window unclamped when the voice has no scheduled end (#121)', async () => {
        const { context, start } = createLoadingVoice({
            playOptions: { loop: true, fadeIn: { durationMs: 4000 } },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 1, time: 14 },
        ]);
    });

    it('applies a non-positive fade-in duration instantly rather than ramping (#121)', async () => {
        const { context, start } = createLoadingVoice({
            playOptions: { volume: 0.6, fadeIn: { durationMs: 0 } },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'setValueAtTime', value: 0.6, time: 10 },
        ]);
    });

    it('truncates a fade-in that outlasts the scheduled end instead of steepening it (#121)', async () => {
        // Bounded to 2 s of a 10 s clip, so scheduledStopAt is 12 while the authored
        // fade wants 14. The authored quantity is the RATE, so the window is cut and
        // the target comes down with it — the voice never reaches `volume`.
        const { context, start } = createLoadingVoice({
            playOptions: { from: 0, to: 2, fadeIn: { durationMs: 4000 } },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.5, time: 12 },
        ]);
    });

    it.each([
        ['NaN', Number.NaN],
        ['+Infinity', Number.POSITIVE_INFINITY],
    ])(
        'applies a %s fade-in duration instantly on a bounded voice, as no fade at all (#121)',
        async (_label, durationMs) => {
            // Both non-finite durations must land here. Clamping is what would otherwise
            // split them: NaN falls straight through to an instant set, while +Infinity
            // clamps to zero progress and would hold the floor for the voice's whole
            // life — the same garbage input silencing the voice instead of playing it.
            const { context, start } = createLoadingVoice({
                playOptions: { volume: 0.4, from: 0, to: 2, fadeIn: { durationMs } },
            });

            await start();

            expect(expectGain(context, 4).gain.calls).toEqual([
                { method: 'setValueAtTime', value: 0, time: 10 },
                { method: 'cancelAndHoldAtTime', time: 10 },
                { method: 'setValueAtTime', value: 0.4, time: 10 },
            ]);
        },
    );

    it('applies a non-finite fade-in duration the same way with no scheduled end (#121)', async () => {
        // The unbounded voice is the half that already worked; pinning both is what
        // stops the outcome depending on whether the voice happens to be bounded.
        const { context, start } = createLoadingVoice({
            playOptions: {
                volume: 0.4,
                loop: true,
                fadeIn: { durationMs: Number.POSITIVE_INFINITY },
            },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'setValueAtTime', value: 0.4, time: 10 },
        ]);
    });

    it('truncates along the authored curve, not a linear proportion of it (#121, #120)', async () => {
        const { context, start } = createLoadingVoice({
            playOptions: { from: 0, to: 2, fadeIn: { durationMs: 4000, curve: 'equalPower' } },
        });

        await start();

        const calls = expectGain(context, 4).gain.calls;
        const last = calls[calls.length - 1];
        expect(last?.method).toBe('linearRampToValueAtTime');
        expect(last?.time).toBe(12);
        // Halfway through an equal-power quarter-wave is sin(π/4), not 0.5.
        expect(last?.value).toBeCloseTo(Math.SQRT1_2, 10);
        expect(last?.value).toBeLessThan(1);
    });

    it('truncates an exponential fade-in geometrically, not linearly (#121, #120)', async () => {
        // The third curve's truncation branch. Geometric interpolation from the 1e-4
        // epsilon to 1 at half the window is 1e-2 — two orders of magnitude away from
        // the 0.5 a linear fallback would give, so this cannot pass by coincidence.
        const { context, start } = createLoadingVoice({
            playOptions: { from: 0, to: 2, fadeIn: { durationMs: 4000, curve: 'exponential' } },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1e-4, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 1e-2, time: 12 },
        ]);
    });

    it('truncates an exponential fade-in to a silent voice without a terminal zero (#121, #120)', async () => {
        // `volume: 0` is legal, and a geometric interpolation TO zero is degenerate —
        // every intermediate collapses to 0. Falling back to linear keeps a real
        // intermediate, which the ramp then clamps to the epsilon; going geometric
        // instead would hand scheduleGainRamp a zero target and append a hard
        // setValueAtTime(0) this voice never asked for.
        const { context, start } = createLoadingVoice({
            playOptions: {
                volume: 0,
                from: 0,
                to: 2,
                fadeIn: { durationMs: 4000, curve: 'exponential' },
            },
        });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1e-4, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 1e-4, time: 12 },
        ]);
    });

    it('clamps a pending fadeTo to the scheduled end without lowering its target (#121)', async () => {
        const { context, manager, handle, start } = createLoadingVoice({
            playOptions: { from: 0, to: 2 },
        });
        manager.fadeTo(handle, { to: 0.25, durationMs: 4000 });

        await start();

        // Asymmetric with fade-in on purpose: `to` is an absolute ceiling the caller
        // named, so only the WINDOW clamps — truncating it would rewrite the request.
        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 12 },
        ]);
    });

    it('contains a throwing linked fade-out without losing the incoming voice (#121)', async () => {
        const warn = spyOnWarn();
        const { context, manager, handle, start } = createLoadingVoice();
        writeVoiceIntents(manager, handle, {
            linkedFadeOut: () => {
                throw new Error('the outgoing voice is gone');
            },
        });

        await start();

        expect(expectSource(context, 0).start).toHaveBeenCalledOnce();
        expect(handle.valid).toBe(true);
        // Containment must not make the failure invisible: name what survived.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('the incoming voice started normally');
    });
});

// ─── fadeOut (#119, #122) ───────────────────────────────────────────────────────

describe('DefaultAudioManager — fadeOut', () => {
    it('ramps to silence and hands the release to the native onended path (#119)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);

        manager.fadeOut(handle, { overMs: 500 });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 10.5 },
        ]);
        expect(source.stop).toHaveBeenCalledTimes(1);
        expect(source.stop).toHaveBeenCalledWith(10.5);
        // The whole point of #119: the stop IS the release schedule. Fake timers are
        // installed for this whole file, so a wall-clock release would show up here.
        expect(vi.getTimerCount()).toBe(0);
        // The voice stays in the pool, valid and re-targetable, for the whole ramp.
        expect(handle.valid).toBe(true);
        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'fading-out',
            scheduledStopAt: 10.5,
        });
    });

    it('invalidates the handle exactly once, when the scheduled stop fires (#119)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);

        manager.fadeOut(handle, { overMs: 500 });

        // The premise: a voice mid-ramp, still in the pool. Without it the release
        // below would only be re-proving the natural-end path.
        expect(handle.valid).toBe(true);
        expect(readVoiceRecord(manager, handle).phase).toBe('fading-out');
        expect(source.stop).toHaveBeenCalledWith(10.5);

        source.finish();

        expect(handle.valid).toBe(false);
        expect(source.disconnect).toHaveBeenCalledOnce();

        // The `voices.delete` guard is what makes the second arrival inert rather than
        // a double-release; `onended` was nulled, so this must reach nothing.
        source.finish();

        expect(source.disconnect).toHaveBeenCalledOnce();
    });

    it('writes only the voice gain, never a bus or master gain (#116)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        // Snapshots, not ramp counts: #116 says these are never WRITTEN by a fade op, so
        // a stray setValueAtTime or cancel has to fail here too, not just a ramp.
        const busCallsBefore = context.createdGainNodes
            .slice(0, 4)
            .map((gain) => [...gain.gain.calls]);

        manager.fadeOut(handle, { overMs: 500 });

        expect(context.createdGainNodes.slice(0, 4).map((gain) => gain.gain.calls)).toEqual(
            busCallsBefore,
        );
        expect(countGainRamps(expectGain(context, 4).gain.calls)).toBe(1);
    });

    // Deliberately green against a no-op `fadeOut`: it bounds the guard rather than
    // driving it, so a later refactor cannot turn a released handle into a write.
    it('is a no-op on a handle whose voice has already been released', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);
        manager.stop(handle);
        const gainCallsAfterStop = [...expectGain(context, 4).gain.calls];
        const stopCallCount = source.stop.mock.calls.length;

        expect(() => {
            manager.fadeOut(handle, { overMs: 500 });
        }).not.toThrow();

        expect(expectGain(context, 4).gain.calls).toEqual(gainCallsAfterStop);
        expect(source.stop).toHaveBeenCalledTimes(stopCallCount);
    });

    it('parks a pre-start fade as releaseOnStart, so the source is never created (#121)', async () => {
        const warn = spyOnWarn();
        const { context, manager, handle, start } = createLoadingVoice({
            playOptions: { fadeIn: { durationMs: 500 } },
        });

        manager.fadeOut(handle, { overMs: 500 });

        // Nothing to ramp and nothing to stop: the intent is parked, not applied.
        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'loading',
            releaseOnStart: true,
        });
        expect(context.createdGainNodes).toHaveLength(4);

        await start();

        expect(context.createdSources).toHaveLength(0);
        expect(context.createdGainNodes).toHaveLength(4);
        expect(handle.valid).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    it('clamps the ramp end to the voice scheduled end rather than extending it (#119)', async () => {
        // Bounded to 2 s of a 10 s clip, so scheduledStopAt is 12 while the fade wants 14.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { from: 0, to: 2 });
        await flushAudioLoad();

        manager.fadeOut(handle, { overMs: 4000 });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 12 },
        ]);
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(12);
    });

    it('ramps toEnd exactly to the voice scheduled end (#122)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { from: 0, to: 3 });
        await flushAudioLoad();

        manager.fadeOut(handle, { toEnd: true });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 13 },
        ]);
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(13);
    });

    it('falls back to a 250 ms ramp when toEnd names no scheduled end (#119)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();
        const warn = spyOnWarn();

        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBeNull();

        manager.fadeOut(handle, { toEnd: true });

        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 10.25,
        });
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(10.25);
        // An unbounded loop has no end to ramp to; the substitution must be visible.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('no scheduled end');
    });

    it('says nothing about a toEnd substitution whose own stop is then refused (#118)', async () => {
        // Both conditions come from ONE platform. A bounded LOOP is the shape that needs
        // `source.stop(when)` to realise its end — a non-looping window rides `start()`'s
        // duration argument instead — so the only way this voice reaches `fadeOut` with
        // no scheduled end is the node having refused that stop at `play()`, and the same
        // node refuses this fade's stop. Announcing the 250 ms substitution before the
        // stop is accepted would promise a fade one statement ahead of the message saying
        // the fade was dropped: the pair Invariant #118 allows one warning to rule out.
        const { context, manager, ref } = createCuedManager();
        context.failNextStopSchedule = true;
        const handle = manager.play(ref, { loop: true, to: 2 });
        await flushAudioLoad();
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBeNull();
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toEnd: true });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('the fade is dropped');
    });

    it('derives a toCue ramp end from the playhead anchors, not a timer (#122)', async () => {
        // Entered at 2 s, so the outro cue at 9 s arrives 7 s after the real start.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { from: 2 });
        await flushAudioLoad();

        manager.fadeOut(handle, { toCue: { name: 'outro' } });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 17 },
        ]);
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(17);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('advances a toCue behind the playhead by one loop period (#122)', async () => {
        // Whole-buffer loop of a 10 s clip entered at 0. Six seconds in, the cue at 4 s
        // is behind the playhead — the next time it is reached is one period later.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();
        context.currentTime = 16;

        manager.fadeOut(handle, { toCue: 4 });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 16 },
            { method: 'linearRampToValueAtTime', value: 0, time: 24 },
        ]);
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(24);
    });

    it('advances a toCue by WHOLE periods when the loop has run past it repeatedly (#122)', async () => {
        // Thirty-five seconds into the same 10 s loop the cue at 4 s has gone by three
        // times over. Adding one period rather than the whole quotient would name 24 s,
        // already behind `now` — and the floor at `now` would serve that as an instant
        // cut with nothing logged, since a cue that RESOLVED never takes the unreachable
        // path that warns. Every other loop test sits inside the first period, where the
        // quotient is 0 and the two arithmetics agree.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();
        context.currentTime = 45;
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: 4 });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(54);
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 54,
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it('reaches a toCue behind the loop entry only after the window wraps (#122)', async () => {
        // Entry folds to 5 s inside the [2, 6) region, so the cue at 3 s is not in the
        // entry pass at all: the playhead runs 5 → 6, wraps to 2, and reaches it at
        // (6 - 5) + (3 - 2) = 2 s. A naive `cue - entry` would name a time in the past.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { from: 5, loopRegion: { start: 2, end: 6 } });
        await flushAudioLoad();

        manager.fadeOut(handle, { toCue: 3 });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(12);
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 12,
        });
    });

    it('treats the loop START as reached too, so a cue sitting on it waits for the wrap (#122)', async () => {
        // The window is closed at BOTH ends; until this, only the `loopEnd` end had a
        // test. Entry folds to 5 s inside [2, 6), so the cue AT the loop start is behind the
        // playhead: the voice runs 5 → 6, wraps, and arrives at 2 s one second later.
        // `cue > loopStart` would call the most frequently reached point of the loop
        // unreachable and cut the voice instead of fading it.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { from: 5, loopRegion: { start: 2, end: 6 } });
        await flushAudioLoad();
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: { name: 'loopStart' } });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(11);
        expect(warn).not.toHaveBeenCalled();
    });

    it('treats the loop end as reached, so toCue "end" fades out over the pass (#122)', async () => {
        // The playhead DOES reach loopEnd — that is where it wraps — so the window is
        // closed at its end. Treating it as exclusive would make this an instant cut.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { loop: true, from: 4 });
        await flushAudioLoad();

        manager.fadeOut(handle, { toCue: 'end' });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(16);
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 16,
        });
    });

    it('silences and stops immediately when a toCue has already passed (#119)', async () => {
        // Entered at 2 s and now 5 s in, so the chorus cue at 4 s went by 3 s ago and a
        // non-looping voice never returns to it. No ramp into the past.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { from: 2 });
        await flushAudioLoad();
        context.currentTime = 15;
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: { name: 'chorus' } });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 15 },
            { method: 'setValueAtTime', value: 0, time: 15 },
        ]);
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(15);
        expect(warn).toHaveBeenCalledTimes(1);
        // The timeline segment is the half that tells an operator WHY the cue is out of
        // reach; without it the message names seconds and no schedule to place them in.
        expect(String(warn.mock.calls[0]?.[0])).toContain('entered at 2s, not looping');
        expect(String(warn.mock.calls[0]?.[0])).toContain('stopping the voice immediately');
    });

    it('silences and stops immediately when a toCue lies outside the loop window (#122)', async () => {
        // The outro at 9 s is past a [2, 6) loop: the playhead will never reach it, which
        // is the same defect as a cue that has already gone by, and takes the same path.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { loop: true, loopRegion: { start: 2, end: 6 } });
        await flushAudioLoad();
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: { name: 'outro' } });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'setValueAtTime', value: 0, time: 10 },
        ]);
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(10);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('loop window [2s, 6s]');
    });

    it('never wraps a toCue on a voice whose requested loop was disabled (#122)', async () => {
        // The region collapses after clamping, so looping is DISABLED even though the
        // caller asked for it. Reading the requested intent instead of the effective
        // schedule would leave a non-looping voice waiting for a wrap that never comes.
        const warn = spyOnWarn();
        const { context, manager, ref } = createCuedManager({ bufferSeconds: 1 });
        const handle = manager.play(ref, { loopRegion: { start: 1, end: 'end' } });
        await flushAudioLoad();
        expect(expectSource(context, 0).loop).toBe(false);
        expect(readVoiceRecord(manager, handle).loopWindowSeconds).toBeNull();
        context.currentTime = 10.75;

        manager.fadeOut(handle, { toCue: 0.5 });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(10.75);
        // One for the dropped region at play(), one for the cue that will not return.
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('resolves a fade cue against the decoded duration, not the authoring sheet (#122)', async () => {
        // The sheet claims 10 s but the clip decodes to 4, so the outro cue at 9 s is
        // past the real end and clamps to the buffer. Trusting `durationSeconds` would
        // put it beyond the loop window and cut the voice off instead of fading it.
        const { context, manager, ref } = createCuedManager({
            bufferSeconds: 4,
            metadata: THEME_CUE_SHEET,
        });
        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: { name: 'outro' } });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(14);
        expect(warn).not.toHaveBeenCalled();
    });

    it('waits a whole period for a toCue the playhead is sitting exactly on (#122)', async () => {
        // Right on the cue: there is no window left to fade over before this arrival, and
        // a looping voice always has a next one. Fading over the next pass beats cutting
        // the voice off, which is the outcome reserved for a cue that never comes back.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();
        context.currentTime = 14;
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: 4 });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(24);
        expect(warn).not.toHaveBeenCalled();
    });

    it('names the authored cue, not just what it resolved to, when it is unreachable (#118)', async () => {
        // A mistyped cue name degrades to the buffer end with no warning of its own. On
        // a voice whose loop window is SHORTER than its buffer that lands past loopEnd,
        // which is the one shape where a typo is diagnosed at all (the sibling test below
        // pins the silent one). A message naming only the resolved seconds would leave no
        // way back to the call that caused it.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { loop: true, loopRegion: { start: 2, end: 6 } });
        await flushAudioLoad();
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: { name: 'chrous' } });

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]?.[0]);
        expect(message).toContain('{ name: "chrous" }');
        expect(message).toContain('resolved to 10s');
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(10);
    });

    it('lets an unresolvable cue name degrade to the buffer end in silence (#118)', async () => {
        // The counterpart to the test above, and the reason its comment is narrow: an
        // end-point cue never abandons, so on a voice that still reaches its buffer end —
        // this one does not loop — the same typo resolves to a REACHABLE instant and
        // becomes a full-length fade with no diagnosis at all. Documented in §4.25 as a
        // limitation of end-point rules, not an accident here.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref);
        await flushAudioLoad();
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: { name: 'chrous' } });

        expect(warn).not.toHaveBeenCalled();
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(20);
    });

    it('never waits for a passed toCue that lies in the intro, before the loop (#122)', async () => {
        // The intro-then-loop pattern plays 0 → 6 once and then repeats [2, 6): the cue
        // at 1 s is reached during that first pass and never again. Four seconds in, it
        // is gone for good — the period advance must not offer it a second arrival.
        const { context, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { loopRegion: { start: 2, end: 6 } });
        await flushAudioLoad();
        context.currentTime = 14;
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: 1 });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(14);
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'setValueAtTime',
            value: 0,
            time: 14,
        });
        expect(warn).toHaveBeenCalledTimes(1);
        // A raw-seconds cue renders as itself, so the pair shows resolution moved nothing.
        expect(String(warn.mock.calls[0]?.[0])).toContain('cue 1s resolved to 1s');
    });

    it('stops now rather than dividing by a zero-length loop period (#122)', async () => {
        // A degenerate empty clip loops a zero-length window, so no wait can ever end.
        // Without the guard the period advance divides by zero and hands `NaN` on.
        const { context, manager, ref } = createCuedManager({ bufferSeconds: 0 });
        const handle = manager.play(ref, { loop: true });
        await flushAudioLoad();
        const warn = spyOnWarn();

        manager.fadeOut(handle, { toCue: 'end' });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(10);
        expect(warn).toHaveBeenCalledTimes(1);
        // A symbolic cue renders quoted as authored, not as the seconds it stands for.
        expect(String(warn.mock.calls[0]?.[0])).toContain("cue 'end' resolved to 0s");
        expect(String(warn.mock.calls[0]?.[0])).toContain('never reaches again');
    });

    it('shapes an equalPower fade-out as the falling quarter-wave (#120)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { volume: 0.5 });
        await flushAudioLoad();

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        expect(waypoints).toHaveLength(64);
        // Falling from the voice's own gain: cos easing, never above the departure.
        expect(waypoints[0]?.value).toBeCloseTo(0.5 * Math.cos(Math.PI / 128), 12);
        for (const waypoint of waypoints) {
            expect(waypoint.value).toBeLessThanOrEqual(0.5);
        }
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 10.64,
        });
    });

    it('departs a fade-out from the voice ceiling, not from what the param reports (#120)', async () => {
        // A real AudioParam's `value` reports the last RENDERED quantum, so a gain
        // written in this same one is invisible to it and a fresh GainNode reports its
        // default of 1. `equalPower` derives every waypoint from that departure, so at
        // volume 0.5 the misread does not merely soften the fade — the first waypoint
        // ramps UP to ~1.0 before the curve falls, a swell to double the requested
        // volume at the head of a fade-OUT. `cancelAndHoldAtTime` pins the param's own
        // value correctly and cannot help here: the waypoints are computed JS-side.
        const { context, manager, ref } = createCuedManager({ quantizedGainParams: true });
        const handle = manager.play(ref, { volume: 0.5 });
        await flushAudioLoad();

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.5 * Math.cos(Math.PI / 128), 12);
        for (const waypoint of waypoints) {
            expect(waypoint.value).toBeLessThanOrEqual(0.5);
        }
    });

    it('departs a re-fade from the gain the param has actually reached (#120)', async () => {
        // The cap must not become a floor. A voice already partway down has to depart
        // from where it IS, not from its ceiling — reading `volume` unconditionally
        // would step a mid-fade voice back up to full gain before falling again, the
        // same swell the stale read causes, just from the other direction.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeOut(handle, { overMs: 4000 });
        // What the param reports once a quantum of that ramp has rendered.
        expectGain(context, 4).gain.value = 0.3;
        context.currentTime = 11;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(1);
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.3 * Math.cos(Math.PI / 128), 12);
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 11.64,
        });
    });

    it('anchors the fallback re-anchor at the ceiling without cancelAndHoldAtTime (#120)', async () => {
        // Without `cancelAndHoldAtTime` the departure is written as an explicit
        // `setValueAtTime`, so a stale read is not merely a shaping error — it steps the
        // voice up to full gain before the fade, on EVERY curve including linear.
        const { context, manager, ref } = createCuedManager({ quantizedGainParams: true });
        const handle = manager.play(ref, { volume: 0.25 });
        await flushAudioLoad();
        stubMissingCancelAndHold(expectGain(context, 4).gain);

        manager.fadeOut(handle, { overMs: 500 });

        expect(expectGain(context, 4).gain.calls.slice(1)).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 0.25, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 10.5 },
        ]);
    });

    it('ramps an exponential fade-out to the epsilon then hard-sets true zero (#120)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();

        manager.fadeOut(handle, { overMs: 500, curve: 'exponential' });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 1e-4, time: 10.5 },
            { method: 'setValueAtTime', value: 0, time: 10.5 },
        ]);
    });

    it.each([
        ['NaN', Number.NaN],
        ['+Infinity', Number.POSITIVE_INFINITY],
        ['zero', 0],
        ['negative', -250],
    ])('applies a %s overMs instantly on a bounded voice (#119)', async (_label, overMs) => {
        // All four name no usable window, and the voice is bounded on purpose: clamping
        // is what would otherwise split them, since `min(+Infinity, scheduledStopAt)` is
        // a full-length 2 s fade while NaN falls straight through to an instant one.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { from: 0, to: 2 });
        await flushAudioLoad();

        manager.fadeOut(handle, { overMs });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'setValueAtTime', value: 0, time: 10 },
        ]);
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(10);
    });

    it('records now, not the elapsed stop it replaces, when onended is still owed (#119)', async () => {
        // The one case where `scheduledStopAt` moves LATER: the voice's stop has gone by
        // but `onended` has not been delivered, so the record is still in the pool. The
        // write has to be the floored ramp end unconditionally. `min`-ing it against what
        // the field already holds would leave the record naming 12 s while the source is
        // scheduled to stop at 17 — breaking the field's own contract that it never names
        // a stop that was not scheduled, and leaving every later fade to clamp against an
        // elapsed time and collapse into an instant cut. Not a refused stop: nothing can
        // schedule one in the past, since `resolveFadeOutRampEnd` floors at `now`.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { from: 0, to: 2 });
        await flushAudioLoad();
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBe(12);
        context.currentTime = 17;

        manager.fadeOut(handle, { overMs: 500 });

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(17);
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBe(17);
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'setValueAtTime',
            value: 0,
            time: 17,
        });
    });

    it('re-anchors and reschedules when a second fadeOut shortens the ramp (#120)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);

        manager.fadeOut(handle, { overMs: 2000 });
        manager.fadeOut(handle, { overMs: 500 });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 12 },
            // The later op cancel-and-reanchors the in-flight ramp rather than stacking.
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 10.5 },
        ]);
        expect(source.stop).toHaveBeenNthCalledWith(1, 12);
        expect(source.stop).toHaveBeenNthCalledWith(2, 10.5);
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBe(10.5);
    });

    it('never lets a second fadeOut extend a stop that is already scheduled (#119)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);

        manager.fadeOut(handle, { overMs: 500 });
        manager.fadeOut(handle, { overMs: 4000 });

        // A fade may shorten a voice's life and never extend it, so the second call is
        // clamped to the first stop rather than pushing it out to 14.
        expect(source.stop).toHaveBeenNthCalledWith(2, 10.5);
        expect(readVoiceRecord(manager, handle).scheduledStopAt).toBe(10.5);
    });

    it('stops the voice immediately when the scheduled stop is refused (#119)', async () => {
        // Without the release the ramp hands off to, a faded voice would sit silent and
        // unreleased forever, holding a pool slot. Containment must not hide that.
        const { context, manager, ref } = createCuedManager();
        context.failNextStopSchedule = true;
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);
        const warn = spyOnWarn();

        manager.fadeOut(handle, { overMs: 500 });

        expect(countGainRamps(expectGain(context, 4).gain.calls)).toBe(0);
        expect(handle.valid).toBe(false);
        expect(source.disconnect).toHaveBeenCalledOnce();
        // The refused `stop(rampEnd)`, then the bare `stop()` the release adds. Dropping
        // the second leaves every other assertion here green, and this voice would end on
        // its own anyway — but a LOOPING one would play forever against no destination,
        // its `onended` nulled, released in the pool's books only. Disconnecting is not
        // stopping.
        expect(source.stop).toHaveBeenCalledTimes(2);
        expect(source.stop).toHaveBeenLastCalledWith();
        expect(() => readVoiceRecord(manager, handle)).toThrow();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('stopped immediately');
    });

    it('lets an explicit stop supersede a fade without double-releasing (#119)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);

        manager.fadeOut(handle, { overMs: 500 });
        expect(source.stop).toHaveBeenNthCalledWith(1, 10.5);

        manager.stop(handle);

        expect(handle.valid).toBe(false);
        expect(source.disconnect).toHaveBeenCalledOnce();

        // The fade's own stop still fires afterwards on a real context; release nulled
        // the handler, so it must reach nothing.
        source.finish();

        expect(source.disconnect).toHaveBeenCalledOnce();
    });

    it('leaves nothing dangling when the manager is disposed mid-fade (#119)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();

        manager.fadeOut(handle, { overMs: 500 });
        expect(readVoiceRecord(manager, handle).phase).toBe('fading-out');

        manager.dispose();

        expect(handle.valid).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(context.close).toHaveBeenCalledOnce();
    });
});

// ─── fadeTo (#116, #120, #121) ──────────────────────────────────────────────────

describe('DefaultAudioManager — fadeTo', () => {
    it('ramps to an absolute target and holds, never stopping the voice (#120)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);

        manager.fadeTo(handle, { to: 0.3, durationMs: 800 });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.3, time: 10.8 },
        ]);
        // The whole point of a HOLD: nothing about the voice's death moves. A `fadeTo`
        // that borrowed `fadeOut`'s tail would show up as a stop, a phase change, or a
        // rewritten end — and the timer count catches a JS-side hold as well.
        expect(source.stop).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(handle.valid).toBe(true);
        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'playing',
            scheduledStopAt: 20,
        });
    });

    it('rewrites the voice ceiling to the clamped target (#120)', async () => {
        const { manager, ref } = createCuedManager();
        const handle = manager.play(ref, { volume: 0.8 });
        await flushAudioLoad();

        manager.fadeTo(handle, { to: 0.3, durationMs: 800 });

        expect(readVoiceRecord(manager, handle).volume).toBe(0.3);
    });

    it('leaves a later fadeOut departing from the ceiling it installed (#120)', async () => {
        // What makes the ceiling write load-bearing rather than bookkeeping. The cap in
        // `rampDeparture` is only exact while `volume` names the voice's CURRENT ceiling;
        // a `fadeTo` that raised the gain and left `volume` behind would cap the next
        // fade-out below the gain the voice is actually at, and it would fall from there.
        const { context, manager, ref } = createCuedManager({ quantizedGainParams: true });
        const handle = manager.play(ref, { volume: 0.25 });
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 1, durationMs: 0 });
        context.currentTime = 11;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        expect(waypoints).toHaveLength(64);
        // Departs from the new ceiling of 1, not the `play()` volume of 0.25.
        expect(waypoints[0]?.value).toBeCloseTo(Math.cos(Math.PI / 128), 12);
    });

    it('caps the departure at the ceiling it replaces, not the one it installs (#120)', async () => {
        // Order-of-writes test. `AudioParam.value` reports the unrendered default of 1 on
        // this quantized double, so the cap is the only thing standing between a swell to
        // `to` and a departure the voice is really at. Installing the new ceiling FIRST
        // would raise the cap above the old one and let that stale 1 through.
        const { context, manager, ref } = createCuedManager({ quantizedGainParams: true });
        const handle = manager.play(ref, { volume: 0.5 });
        await flushAudioLoad();

        manager.fadeTo(handle, { to: 1, durationMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.5 + 0.5 * Math.sin(Math.PI / 128), 12);
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 1,
            time: 10.64,
        });
    });

    it.each([
        ['NaN', NaN],
        ['+Infinity', Infinity],
        ['zero', 0],
        ['negative', -250],
    ])(
        'applies a %s durationMs instantly on a bounded voice (#120)',
        async (_label, durationMs) => {
            // Bounded on purpose: `+Infinity` is the input that separates resolving the
            // non-finite window BEFORE the clamp from after it. Clamped first it would become
            // `min(Infinity, scheduledStopAt)` — a full-length fade to the voice's own end,
            // the opposite outcome from the `NaN` beside it, on the same garbage input.
            const { context, manager, ref } = createCuedManager();
            const handle = manager.play(ref);
            await flushAudioLoad();

            manager.fadeTo(handle, { to: 0.3, durationMs });

            expect(expectGain(context, 4).gain.calls).toEqual([
                { method: 'setValueAtTime', value: 1, time: 10 },
                { method: 'cancelAndHoldAtTime', time: 10 },
                { method: 'setValueAtTime', value: 0.3, time: 10 },
            ]);
            expect(countGainRamps(expectGain(context, 4).gain.calls)).toBe(0);
            expect(readVoiceRecord(manager, handle).volume).toBe(0.3);
        },
    );

    it('ramps an exponential fadeTo of 0 to the epsilon, then hard-sets the ceiling to 0 (#120)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();

        manager.fadeTo(handle, { to: 0, durationMs: 800, curve: 'exponential' });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 1e-4, time: 10.8 },
            { method: 'setValueAtTime', value: 0, time: 10.8 },
        ]);
        // A silenced voice is still a HELD voice: the ceiling follows the target to true
        // zero, and the source is untouched.
        expect(readVoiceRecord(manager, handle).volume).toBe(0);
        expect(expectSource(context, 0).stop).not.toHaveBeenCalled();
    });

    it('clamps the ramp end to the scheduled end without lowering its target (#120)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { from: 0, to: 2 });
        await flushAudioLoad();

        manager.fadeTo(handle, { to: 0.25, durationMs: 4000 });

        // Asymmetric with fade-in on purpose: `to` is an absolute ceiling the caller
        // named, so only the WINDOW clamps — truncating it would rewrite the request.
        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 12 },
        ]);
        expect(readVoiceRecord(manager, handle).volume).toBe(0.25);
    });

    it.each([
        ['above the range', 1.5, 1],
        ['below the range', -1, 0],
        ['non-finite', NaN, 0],
    ])('clamps a %s target into [0, 1] (#120)', async (_label, to, expected) => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();

        manager.fadeTo(handle, { to, durationMs: 800 });

        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: expected,
            time: 10.8,
        });
        // The ceiling records what was WRITTEN, not what was asked for — otherwise the
        // next fade-out would cap its departure against a gain no param ever held.
        expect(readVoiceRecord(manager, handle).volume).toBe(expected);
    });

    it('is a no-op on a handle whose voice has already been released', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);
        manager.stop(handle);
        const gainCallsAfterStop = [...expectGain(context, 4).gain.calls];

        expect(() => {
            manager.fadeTo(handle, { to: 0.3, durationMs: 800 });
        }).not.toThrow();

        expect(expectGain(context, 4).gain.calls).toEqual(gainCallsAfterStop);
        expect(source.stop).toHaveBeenCalledTimes(1);
    });

    it('writes only the voice gain, never a bus or master gain (#116)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        // Snapshots, not ramp counts: #116 says these are never WRITTEN by a fade op, so
        // a stray setValueAtTime or cancel has to fail here too, not just a ramp.
        const busCallsBefore = context.createdGainNodes
            .slice(0, 4)
            .map((gain) => [...gain.gain.calls]);

        manager.fadeTo(handle, { to: 0.3, durationMs: 800 });

        expect(context.createdGainNodes.slice(0, 4).map((gain) => gain.gain.calls)).toEqual(
            busCallsBefore,
        );
        expect(countGainRamps(expectGain(context, 4).gain.calls)).toBe(1);
    });

    it('re-targets a fading-out voice without cancelling its scheduled stop (#119, #120)', async () => {
        // Invariant #119 keeps a fading voice valid and re-targetable, and Web Audio has
        // no way to un-schedule `source.stop` — so the honest outcome is that the gain
        // moves and the death does not. Resetting the phase to `'playing'` here would
        // claim a release that is still coming.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        const source = expectSource(context, 0);
        manager.fadeOut(handle, { overMs: 4000 });

        manager.fadeTo(handle, { to: 1, durationMs: 8000 });

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 14 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            // Clamped to the stop already scheduled, not the 18s the caller asked for.
            { method: 'linearRampToValueAtTime', value: 1, time: 14 },
        ]);
        expect(source.stop).toHaveBeenCalledExactlyOnceWith(14);
        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'fading-out',
            scheduledStopAt: 14,
            volume: 1,
        });
    });

    it('departs a second fade from where a descending ramp really is, not its new ceiling (#120)', async () => {
        // The ceiling is installed at ramp START but the gain only arrives there at the
        // END, so for that whole window the voice is legitimately ABOVE `volume`. Capping
        // the read against it there turns the bound that exists to prevent a step INTO one
        // — the same artifact, just downwards.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0.2, durationMs: 2000 });
        // What the param reports once a quantum of that dip has rendered.
        expectGain(context, 4).gain.value = 0.6;
        context.currentTime = 11;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(1);
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.6 * Math.cos(Math.PI / 128), 12);
    });

    it('anchors a mid-dip fade at the real gain without cancelAndHoldAtTime (#120)', async () => {
        // The platform where the under-estimate is not a soft artifact but a hard step:
        // the fallback re-anchor writes the departure as an explicit `setValueAtTime`, so
        // a bound below the real gain lands as an audible jump on a plain linear ramp.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0.2, durationMs: 2000 });
        stubMissingCancelAndHold(expectGain(context, 4).gain);
        expectGain(context, 4).gain.value = 0.6;
        context.currentTime = 11;

        manager.fadeOut(handle, { overMs: 640 });

        expect(expectGain(context, 4).gain.calls.slice(-3)).toEqual([
            { method: 'cancelScheduledValues', time: 11 },
            { method: 'setValueAtTime', value: 0.6, time: 11 },
            { method: 'linearRampToValueAtTime', value: 0, time: 11.64 },
        ]);
    });

    it('lets an exponential re-target depart from a dip still in flight (#120)', async () => {
        // An under-estimated departure does not merely soften this one: a ceiling of 0
        // caps the read to 0, and `scheduleExponentialRamp` treats a zero departure as
        // the one case it must degrade to linear — silently discarding the authored curve.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0, durationMs: 2000 });
        expectGain(context, 4).gain.value = 0.5;
        context.currentTime = 11;

        manager.fadeTo(handle, { to: 1, durationMs: 800, curve: 'exponential' });

        expect(expectGain(context, 4).gain.calls.slice(-2)).toEqual([
            { method: 'cancelAndHoldAtTime', time: 11 },
            { method: 'exponentialRampToValueAtTime', value: 1, time: 11.8 },
        ]);
    });

    it('departs a second fade from where a RISING ramp really is, not where it started (#120)', async () => {
        // The mirror of the descending case, and the reason the bound spans BOTH ends of
        // the ramp rather than just its departure: mid-swell the voice sits above where it
        // set off from, so a bound of the departure alone would cap the read below the
        // real gain — the same step down, arrived at from the other direction.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { volume: 0.2 });
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 1, durationMs: 2000 });
        expectGain(context, 4).gain.value = 0.6;
        context.currentTime = 11;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(1);
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.6 * Math.cos(Math.PI / 128), 12);
    });

    it('holds nothing for an instant fadeTo, whose window can never expire (#120)', async () => {
        // A non-finite duration applies its target at once, so there is no travelling ramp
        // to hold a bound for — and its `endTime` is `+Infinity`, a deadline no
        // `currentTime` ever passes. Recorded anyway, the headroom would outlive the voice
        // and the ceiling rewrite would never take effect at all.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0.2, durationMs: Infinity });
        // Garbage-high, the read the cap exists for: the target landed at 0.2 at once.
        expectGain(context, 4).gain.value = 1;
        context.currentTime = 11;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.2 * Math.cos(Math.PI / 128), 12);
    });

    it('caps at the new ceiling again once the descending ramp has landed (#120)', async () => {
        // The bound above the ceiling is held only for the ramp's own window, and it
        // expires by comparison against `currentTime` rather than by a timer. Held past
        // the landing it would make the ceiling rewrite pointless.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0.2, durationMs: 2000 });
        // Garbage-high, the read the cap exists for: the dip landed at 0.2 long ago.
        expectGain(context, 4).gain.value = 1;
        context.currentTime = 12.5;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(1);
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.2 * Math.cos(Math.PI / 128), 12);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds a fade-in ramp at the target it will really reach, not at volume (#120, #121)', async () => {
        // The fade-in is the third ramp on the one path, and its hold is TIGHTER than the
        // ceiling rather than above it: a TRUNCATED fade-in stops at the value its curve
        // holds when the voice ends, so `volume` is a gain it never reaches.
        const { context, manager, handle, start } = createLoadingVoice({
            playOptions: { from: 0, to: 2, fadeIn: { durationMs: 4000 } },
        });
        await start();
        // The unrendered node's `defaultValue`, which is what a real param reports through
        // a fade-in's first quantum — the exact read `rampDeparture` names as its residual.
        // The doubles write through on a scheduled ramp, so without this the param would
        // already report the truncated target and the bound would have nothing to do.
        expectGain(context, 4).gain.value = 1;
        context.currentTime = 11;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(1);
        expect(waypoints).toHaveLength(64);
        // Half of `volume`: the fade-in was clamped to the scheduled end at 12, so it only
        // ever climbs halfway up its 4000 ms curve.
        expect(waypoints[0]?.value).toBeCloseTo(0.5 * Math.cos(Math.PI / 128), 12);
    });

    it('departs exactly after an instant raise the param cannot see yet (#120)', async () => {
        // Two verbs in ONE render quantum. The instant application moves the gain to 1 with
        // no ramp at all, so `param.value` — which reports the START of this quantum — is
        // low by 0.75 rather than by a quantum of slope, and the cap cannot help: it bounds
        // a read from ABOVE. Only the value we just wrote is the truth here.
        const { context, manager, ref } = createCuedManager({ quantizedGainParams: true });
        const handle = manager.play(ref, { volume: 0.25 });
        await flushAudioLoad();
        // A param that has rendered, truthfully reporting the voice's 0.25.
        context.currentTime = 11;
        expectGain(context, 4).gain.value = 0.25;

        manager.fadeTo(handle, { to: 1, durationMs: 0 });
        manager.fadeOut(handle, { overMs: 5000, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(-64);
        expect(waypoints[0]?.value).toBeCloseTo(Math.cos(Math.PI / 128), 12);
    });

    it('does not freeze that stale read into the bound for the whole ramp (#120)', async () => {
        // The consequence if it did: `voiceCeiling` returns `hold.bound` outright, so a
        // departure taken from one bad read would outrank every TRUTHFUL read for the
        // ramp's entire window — turning a one-turn error into a five-second one.
        const { context, manager, ref } = createCuedManager({ quantizedGainParams: true });
        const handle = manager.play(ref, { volume: 0.25 });
        await flushAudioLoad();
        context.currentTime = 11;
        expectGain(context, 4).gain.value = 0.25;
        manager.fadeTo(handle, { to: 1, durationMs: 0 });
        manager.fadeOut(handle, { overMs: 5000 });
        // A second on, the param has rendered and reports the descent correctly.
        expectGain(context, 4).gain.value = 0.8;
        context.currentTime = 12;

        manager.fadeTo(handle, { to: 0.5, durationMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(-64);
        expect(waypoints[0]?.value).toBeCloseTo(0.5 + (0.8 - 0.5) * Math.cos(Math.PI / 128), 12);
    });

    it('records nothing when the ramp it books is refused an unschedulable time (#120)', async () => {
        // The bookkeeping presumes the write lands. `scheduleGainRamp` writes NOTHING for a
        // negative or non-finite start — a spec-compliant param throws `RangeError` on every
        // method for one — so a ceiling or a settled gain booked for it would describe
        // automation that never happened. This direction is worse than the bound it
        // replaces: a settled gain is taken OUTRIGHT, so the next fade would swell to it
        // instead of merely being capped.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref, { volume: 0.1 });
        await flushAudioLoad();
        const callsBefore = [...expectGain(context, 4).gain.calls];
        context.currentTime = NaN;

        manager.fadeTo(handle, { to: 0.9, durationMs: 800 });

        expect(expectGain(context, 4).gain.calls).toEqual(callsBefore);
        expect(readVoiceRecord(manager, handle).volume).toBe(0.1);

        // And the next fade still departs from the truth, not from a gain nothing wrote.
        expectGain(context, 4).gain.value = 0.1;
        context.currentTime = 11;
        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(-64);
        expect(waypoints[0]?.value).toBeCloseTo(0.1 * Math.cos(Math.PI / 128), 12);
    });

    it('expires the hold exactly ON its landing time, not one instant after (#120)', async () => {
        // `now >= until`, so the boundary belongs to the settled ceiling: at `until` the
        // ramp has arrived and `volume` is the truth. Only a read at exactly that time
        // separates the two comparisons.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0.2, durationMs: 2000 });
        expectGain(context, 4).gain.value = 1;
        context.currentTime = 12;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(1);
        expect(waypoints[0]?.value).toBeCloseTo(0.2 * Math.cos(Math.PI / 128), 12);
    });

    it('bounds a fade-out ramp too, not only the fadeTo that it superseded (#120)', async () => {
        // Every ramp travels off the settled ceiling, not just a `fadeTo`'s. A fade-out
        // that cancels an unfinished dip and outlives that dip's window leaves the voice
        // descending on a trajectory ABOVE `volume` — which now names a gain the dip was
        // cancelled before ever reaching.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0.2, durationMs: 2000 });
        expectGain(context, 4).gain.value = 0.8;
        context.currentTime = 10.5;
        manager.fadeOut(handle, { overMs: 8000 });
        // Past the dip's `until` of 12, where its hold has rightly expired.
        expectGain(context, 4).gain.value = 0.45;
        context.currentTime = 14;

        manager.fadeOut(handle, { overMs: 640, curve: 'equalPower' });

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            .slice(2);
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.45 * Math.cos(Math.PI / 128), 12);
    });

    it('anchors at the real gain on a superseded dip without cancelAndHoldAtTime (#120)', async () => {
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0.2, durationMs: 2000 });
        expectGain(context, 4).gain.value = 0.8;
        context.currentTime = 10.5;
        manager.fadeOut(handle, { overMs: 8000 });
        stubMissingCancelAndHold(expectGain(context, 4).gain);
        expectGain(context, 4).gain.value = 0.45;
        context.currentTime = 14;

        manager.fadeOut(handle, { overMs: 640 });

        expect(expectGain(context, 4).gain.calls.slice(-3)).toEqual([
            { method: 'cancelScheduledValues', time: 14 },
            { method: 'setValueAtTime', value: 0.45, time: 14 },
            { method: 'linearRampToValueAtTime', value: 0, time: 14.64 },
        ]);
    });

    it('keeps an exponential re-target usable on a voice fading out of a dip (#119, #120)', async () => {
        // The compounding case: a dip to 0 settles the ceiling at 0, so once its own hold
        // expires the cap reads 0 and `scheduleExponentialRamp` takes its zero-departure
        // branch — discarding the authored curve on a voice that is really at 0.45.
        const { context, manager, ref } = createCuedManager();
        const handle = manager.play(ref);
        await flushAudioLoad();
        manager.fadeTo(handle, { to: 0, durationMs: 2000 });
        expectGain(context, 4).gain.value = 0.8;
        context.currentTime = 10.5;
        manager.fadeOut(handle, { overMs: 8000 });
        expectGain(context, 4).gain.value = 0.45;
        context.currentTime = 14;

        manager.fadeTo(handle, { to: 1, durationMs: 800, curve: 'exponential' });

        expect(expectGain(context, 4).gain.calls.slice(-2)).toEqual([
            { method: 'cancelAndHoldAtTime', time: 14 },
            { method: 'exponentialRampToValueAtTime', value: 1, time: 14.8 },
        ]);
    });

    it('parks a fadeTo requested before the voice started, scheduling nothing (#121)', () => {
        const { context, manager, handle } = createLoadingVoice();
        // Only the four bus gains exist: there is no stage-1 gain for a ramp to write
        // to, which is precisely why an intent arriving now has to be parked. Snapshots
        // rather than ramp counts, so a stray setValueAtTime fails here too (#116).
        expect(context.createdGainNodes).toHaveLength(4);
        const busCallsBefore = context.createdGainNodes.map((gain) => [...gain.gain.calls]);

        manager.fadeTo(handle, { to: 0.25, durationMs: 200 });

        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'loading',
            pendingFadeTo: { to: 0.25, durationMs: 200 },
            releaseOnStart: false,
        });
        expect(context.createdGainNodes).toHaveLength(4);
        expect(context.createdGainNodes.map((gain) => gain.gain.calls)).toEqual(busCallsBefore);
    });

    it('lets a second pre-start fadeTo replace the first (#121)', () => {
        const { manager, handle } = createLoadingVoice();

        manager.fadeTo(handle, { to: 0.25, durationMs: 200 });
        manager.fadeTo(handle, { to: 0.75, durationMs: 900, curve: 'equalPower' });

        // One slot, so the later request supersedes rather than queueing behind it —
        // two ramps over the same window would fight at `t0`.
        expect(readVoiceRecord(manager, handle).pendingFadeTo).toEqual({
            to: 0.75,
            durationMs: 900,
            curve: 'equalPower',
        });
    });

    it('never lets a pre-start fadeTo resurrect a voice released on start (#121)', async () => {
        const { context, manager, handle, start } = createLoadingVoice();
        manager.fadeOut(handle, { overMs: 500 });

        manager.fadeTo(handle, { to: 1, durationMs: 500 });

        await start();

        // `releaseOnStart` is step 1 of the precedence order, so it short-circuits
        // `startVoice` before any node exists for the parked fadeTo to write to.
        expect(context.createdSources).toHaveLength(0);
        expect(context.createdGainNodes).toHaveLength(4);
        expect(handle.valid).toBe(false);
    });

    it('applies a pending fadeTo at t0 and rewrites the ceiling there too (#121)', async () => {
        const { context, manager, handle, start } = createLoadingVoice();
        manager.fadeTo(handle, { to: 0.25, durationMs: 200 });

        await start();

        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 10.2 },
        ]);
        expect(readVoiceRecord(manager, handle)).toMatchObject({
            phase: 'playing',
            pendingFadeTo: null,
            volume: 0.25,
        });
    });

    it('departs a pending fadeTo from the fade-in floor the param really holds at t0 (#120, #121)', async () => {
        // A ramp has not progressed at its own start time, so after the fade-in is laid
        // down the gain at `t0` is still the floor it departed from. The quantized param
        // reports the unrendered default of 1 there, and capping that read at the ceiling
        // would not help — the voice is at silence, not at `volume`.
        const { context, manager, handle, start } = createLoadingVoice({
            quantizedGainParams: true,
            playOptions: { fadeIn: { durationMs: 500 } },
        });
        manager.fadeTo(handle, { to: 0.5, durationMs: 640, curve: 'equalPower' });

        await start();

        const waypoints = expectGain(context, 4)
            .gain.calls.filter((call) => call.method === 'linearRampToValueAtTime')
            // Drop the fade-in's own ramp, which the fadeTo then cancels over.
            .slice(1);
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.5 * Math.sin(Math.PI / 128), 12);
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0.5,
            time: 10.64,
        });
    });

    it('departs a pending fadeTo from an INSTANT fade-in target, not from the floor (#120, #121)', async () => {
        // The other half of the same rule. A fade-in with no window does not ramp — it
        // SETS its target at `t0` — so the gain the next ramp departs from is that
        // target, and passing the floor here would invert the curve.
        const { context, manager, handle, start } = createLoadingVoice({
            quantizedGainParams: true,
            playOptions: { fadeIn: { durationMs: 0 } },
        });
        manager.fadeTo(handle, { to: 0.5, durationMs: 640, curve: 'equalPower' });

        await start();

        const waypoints = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(0.5 + 0.5 * Math.cos(Math.PI / 128), 12);
    });
});

// ─── crossfade (#121, #116, #120) ───────────────────────────────────────────────

describe('DefaultAudioManager — crossfade', () => {
    it('lays both curves over one shared t0 window, complementary and dip-free (#121, #120)', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();

        // Both voices depart from the anchor their own curve needs, at the SAME t0.
        expect(expectGain(context, 5).gain.calls.slice(0, 2)).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
        ]);
        expect(expectGain(context, 4).gain.calls.slice(0, 2)).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
        ]);

        const rising = expectGain(context, 5).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        const falling = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        // `equalPower` without being asked — the crossfade default is not the fade default.
        expect(rising).toHaveLength(64);
        expect(falling).toHaveLength(64);

        for (const [index, up] of rising.entries()) {
            const down = falling[index];
            expect(down).toBeDefined();
            // Identical waypoint TIMES are what makes the pair complementary rather than
            // merely similarly shaped; a fade-out anchored at its own `currentTime` would
            // still pass a sum-of-squares check taken waypoint-by-waypoint.
            expect(down?.time).toBe(up.time);
            const gainIn = up.value ?? Number.NaN;
            const gainOut = down?.value ?? Number.NaN;
            expect(gainIn ** 2 + gainOut ** 2).toBeCloseTo(1, 12);
        }
        expect(rising.at(-1)).toEqual({ method: 'linearRampToValueAtTime', value: 1, time: 12 });
        expect(falling.at(-1)).toEqual({ method: 'linearRampToValueAtTime', value: 0, time: 12 });
    });

    it('is equal-power SHAPED but not constant-power when the two halves travel different distances', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000, volume: 0.5 });
        await startIncoming();

        const rising = expectGain(context, 5).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        const falling = expectGain(context, 4).gain.calls.filter(
            (call) => call.method === 'linearRampToValueAtTime',
        );
        // The OTHER precondition behind "no mid-fade dip", and the one an unclamped window
        // does not supply: `equalPower` gives `V·sin` against `G·cos`, whose squares sum to a
        // constant only when `V === G`. A quieter incoming voice leaves each curve correctly
        // shaped while the pair sums to a slope, dipping to `V²` at the far end. Nothing here
        // is a defect to fix — it is the precondition the prose must state rather than imply.
        const power = (index: number): number =>
            (rising[index]?.value ?? Number.NaN) ** 2 + (falling[index]?.value ?? Number.NaN) ** 2;
        expect(power(31)).toBeCloseTo(
            0.25 * Math.sin(Math.PI / 4) ** 2 + Math.cos(Math.PI / 4) ** 2,
            12,
        );
        expect(power(31)).toBeCloseTo(0.625, 12);
        expect(power(63)).toBeCloseTo(0.25, 12);
        // Same call with matched distances is constant, so the difference is the volume and
        // not the curve — see the shared-window test above, which asserts exactly 1.
        expect(power(0)).toBeGreaterThan(power(31));
        expect(power(31)).toBeGreaterThan(power(63));
    });

    it('anchors the linked fade to the t0 it is handed, not to a re-read clock (#121)', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();
        // The outgoing voice is already started, so this only affects the incoming `t0`
        // and anything that reads the clock after it.
        driftAudioClock(context);

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000, curve: 'linear' });
        await startIncoming();

        // One shared window, both ends. A linkage that called back through the public
        // fadeOut — which derives its own `now` — would land at 12.5 here and pass every
        // other test in this block, because a frozen clock makes the two indistinguishable.
        expect(expectGain(context, 5).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 1,
            time: 12,
        });
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 12,
        });
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(12);
    });

    it('lets each half clamp to its OWN scheduled end, so an outgoing one ending first cuts short', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair({ outgoingPlayOptions: { to: 1 } });

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();

        // `durationMs` names the AUTHORED window; each half's end is clamped against its own
        // voice's scheduled stop, which the crossfade neither reads across nor equalises.
        // Here the outgoing voice is bounded at t=11 and the incoming one is not, so the two
        // curves cover different windows and are NOT complementary over the difference: at
        // t=11 the outgoing has reached 0 while the incoming is only at sin(pi/4).
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 11,
        });
        expect(expectGain(context, 5).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 1,
            time: 12,
        });
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(11);
    });

    it('truncates a fade-in that outlasts the incoming voice, leaving the fade-out to run on', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair({ incomingBufferSeconds: 1 });

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();

        // The mirror image of the case above, and the reason the clamp is per-voice rather
        // than shared: a fade-in truncates along its own curve (it keeps the rate it
        // authored), so it lands below `volume` at the incoming voice's own end.
        expect(expectGain(context, 5).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: Math.sin(Math.PI / 4),
            time: 11,
        });
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 12,
        });
        // And the truncation is not merely of the RAMP. The incoming voice's own end is
        // where its source runs out, so it is released at t=11 while the outgoing one is
        // still descending to t=12 — the crossfade finishes on the outgoing tail and then
        // on silence. This is the one shape in which the surrounding "never
        // silence-with-nothing-incoming" promise does not hold, so it is pinned here rather
        // than left for the doc to assert alone.
        expect(readVoiceRecord(manager, outgoing).scheduledStopAt).toBe(12);
        expect(expectSource(context, 1).stop).not.toHaveBeenCalled();
        expectSource(context, 1).finish();
        expect(readVoiceRecord(manager, outgoing).phase).toBe('fading-out');
    });

    it('leaves the outgoing voice at full volume until the incoming one starts', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();

        const incoming = manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });

        // The linkage is PARKED, not applied: no second source exists yet, so a fade
        // applied now would silence the outgoing into a gap with nothing coming in.
        expect(context.createdSources).toHaveLength(1);
        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
        ]);
        expect(readVoiceRecord(manager, outgoing)).toMatchObject({
            phase: 'playing',
            scheduledStopAt: 20,
        });
        expect(readVoiceRecord(manager, incoming).linkedFadeOut).toBeInstanceOf(Function);

        await startIncoming();

        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(12);
    });

    it('returns the incoming handle and forwards every play option to it', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();

        const incoming = manager.crossfade(outgoing, incomingRef, {
            durationMs: 2000,
            bus: 'music',
            loop: true,
            priority: 7,
            volume: 0.5,
        });

        expect(incoming.ref).toBe(incomingRef);
        expect(incoming.bus).toBe('music');
        expect(incoming.priority).toBe(7);
        expect(incoming.valid).toBe(true);
        expect(incoming.id).not.toBe(outgoing.id);

        await startIncoming();

        expect(expectSource(context, 1).loop).toBe(true);
        // The fade-in climbs to the requested `volume`, not to full gain.
        expect(expectGain(context, 5).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0.5,
            time: 12,
        });
    });

    it('honours an explicit curve on both halves of the fade', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();

        manager.crossfade(outgoing, incomingRef, { durationMs: 500, curve: 'linear' });
        await startIncoming();

        expect(expectGain(context, 5).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 1, time: 10.5 },
        ]);
        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 10.5 },
        ]);
    });

    it('releases the outgoing voice through the native onended path, timer-free (#119)', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();

        const outgoingSource = expectSource(context, 0);
        expect(outgoingSource.stop).toHaveBeenCalledTimes(1);
        expect(outgoingSource.stop).toHaveBeenCalledWith(12);
        expect(vi.getTimerCount()).toBe(0);
        // Valid and re-targetable for the whole ramp, exactly as a bare fadeOut leaves it.
        expect(outgoing.valid).toBe(true);
        expect(readVoiceRecord(manager, outgoing)).toMatchObject({
            phase: 'fading-out',
            scheduledStopAt: 12,
        });

        outgoingSource.finish();

        expect(outgoing.valid).toBe(false);
    });

    it('writes only the two voice gains, never a bus or master gain (#116)', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();
        // Snapshots, not ramp counts: #116 says these are never WRITTEN by a crossfade, so
        // a stray setValueAtTime or cancel has to fail here too, not just a ramp.
        const busCallsBefore = context.createdGainNodes
            .slice(0, 4)
            .map((gain) => [...gain.gain.calls]);

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();

        expect(context.createdGainNodes.slice(0, 4).map((gain) => gain.gain.calls)).toEqual(
            busCallsBefore,
        );
        expect(countGainRamps(expectGain(context, 4).gain.calls)).toBe(64);
        expect(countGainRamps(expectGain(context, 5).gain.calls)).toBe(64);
    });

    it('leaves the outgoing voice playing unfaded when the incoming one never decodes', async () => {
        const { context, manager, outgoing, incomingRef, incomingLoad } =
            await createCrossfadePair();

        const incoming = manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        incomingLoad.reject(new Error('decode failed'));
        await flushAudioLoad();

        expect(incoming.valid).toBe(false);
        // Never silence-with-nothing-incoming: the linkage died with the voice that owned
        // it, so the outgoing keeps its own natural life rather than a fade into a gap.
        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
        ]);
        expect(expectSource(context, 0).stop).not.toHaveBeenCalled();
        expect(readVoiceRecord(manager, outgoing)).toMatchObject({
            phase: 'playing',
            scheduledStopAt: 20,
        });
    });

    it('names the cut, not an unfaded voice, when the linked ramp throws after its stop landed', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();
        const warn = spyOnWarn();
        // Throw from the RAMP, so the failure lands after `source.stop` was accepted and
        // after the record already describes a fade that will now not happen. `crossfade`
        // is the first production writer of `linkedFadeOut`, so this containment path is
        // reachable outside a test double for the first time.
        Object.defineProperty(expectGain(context, 4).gain, 'linearRampToValueAtTime', {
            configurable: true,
            value: (): never => {
                throw new Error('ramp unsupported');
            },
        });

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();

        // The voice is NOT "playing unfaded": its stop is already booked at the ramp end it
        // never travelled, so it plays at full gain and then cuts.
        expect(expectSource(context, 0).stop).toHaveBeenCalledWith(12);
        expect(readVoiceRecord(manager, outgoing)).toMatchObject({
            phase: 'fading-out',
            scheduledStopAt: 12,
        });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain(
            'cut at any stop the attempt had already rescheduled',
        );
        // Containment: the incoming voice's own fade-in is unaffected.
        expect(countGainRamps(expectGain(context, 5).gain.calls)).toBe(64);
    });

    it('still fades the incoming voice in when the outgoing handle is already invalid', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();
        manager.stop(outgoing);

        const incoming = manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });

        // No linkage is parked at all — there is nothing left to fade, and an intent that
        // can only no-op would advertise one.
        expect(readVoiceRecord(manager, incoming).linkedFadeOut).toBeNull();

        await startIncoming();

        expect(expectGain(context, 5).gain.calls.slice(0, 2)).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
        ]);
        expect(countGainRamps(expectGain(context, 5).gain.calls)).toBe(64);
    });

    it('never lets an outgoing voice still loading at t0 become audible (#121)', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming, startOutgoing } =
            await createCrossfadePair({ deferOutgoing: true });

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();

        // There is no gain to ramp, so the linkage parks the release instead — step 1 of
        // the precedence order, reached through the crossfade rather than a bare fadeOut.
        expect(readVoiceRecord(manager, outgoing).releaseOnStart).toBe(true);
        // The incoming voice started FIRST here, so its gain is index 4.
        expect(expectGain(context, 4).gain.calls.slice(0, 2)).toEqual([
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'cancelAndHoldAtTime', time: 10 },
        ]);

        await startOutgoing();

        expect(outgoing.valid).toBe(false);
        expect(context.createdSources).toHaveLength(1);
    });

    it('no-ops when the outgoing voice is released between the call and t0', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        // Held across the release, so the assertion below can reach a record that
        // `readVoiceRecord` no longer finds.
        const releasedRecord = readVoiceRecord(manager, outgoing);
        manager.stop(outgoing);
        await startIncoming();

        // The thunk resolves its target by handle id when it fires. Capturing the record
        // instead would write onto this stale object: a released voice has no nodes, so the
        // fade would park a release on it rather than ramp — silent, and invisible in the
        // gain log below.
        expect(releasedRecord.releaseOnStart).toBe(false);
        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
        ]);
        expect(countGainRamps(expectGain(context, 5).gain.calls)).toBe(64);
    });

    it('cancel-and-reanchors an in-flight outgoing ramp on a second crossfade (#120)', async () => {
        const { assetManager, context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();
        const secondRef = audioRef('audio/music/boss.ogg');
        assetManager.resolve(secondRef, createAudioBuffer('boss', 10));

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();
        // A stand-in for a mid-ramp reading this double cannot produce. It reports the last
        // value SCHEDULED — after a full waypoint set, the ramp's target of 0 — so left
        // alone the second linkage departs from 0 and lays 64 waypoints of 0, and every
        // assertion below passes over a flat ramp that proves nothing about re-anchoring.
        // Not a claim about where the voice is: the clock is frozen at the instant the first
        // fade STARTS, where the honest gain is still 1. What is being pinned is that the
        // departure comes from the param at all, rather than from the voice's ceiling.
        expectGain(context, 4).gain.value = 0.6;
        manager.crossfade(outgoing, secondRef, { durationMs: 1000 });
        await flushAudioLoad();

        const outgoingCalls = expectGain(context, 4).gain.calls;
        // The second linkage re-anchors at the held value rather than stacking a curve on
        // top of the first, and lays a fresh full waypoint set on its own window departing
        // from where the voice IS — not from the first fade's target, and not from the
        // node's default of 1.
        expect(outgoingCalls[66]).toEqual({ method: 'cancelAndHoldAtTime', time: 10 });
        expect(outgoingCalls[67]?.value).toBeCloseTo(0.6 * Math.cos(Math.PI / 128), 12);
        expect(outgoingCalls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 11,
        });
        expect(countGainRamps(outgoingCalls)).toBe(128);
        // The stop is rescheduled with it, shortening the voice's remaining life.
        expect(expectSource(context, 0).stop).toHaveBeenNthCalledWith(2, 11);
        expect(readVoiceRecord(manager, outgoing).scheduledStopAt).toBe(11);
    });

    it('clamps a re-targeting crossfade to the stop already scheduled, never extending it', async () => {
        const { assetManager, context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair();
        const secondRef = audioRef('audio/music/boss.ogg');
        assetManager.resolve(secondRef, createAudioBuffer('boss', 10));

        manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });
        await startIncoming();
        manager.crossfade(outgoing, secondRef, { durationMs: 5000 });
        await flushAudioLoad();

        // Web Audio cannot un-schedule the stop the first crossfade laid down, so the
        // longer tail is cut at it rather than promised and then missed.
        expect(readVoiceRecord(manager, outgoing).scheduledStopAt).toBe(12);
        expect(expectSource(context, 0).stop).toHaveBeenNthCalledWith(2, 12);
        expect(expectGain(context, 4).gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 12,
        });
    });

    // Every degenerate `durationMs` names no window on EITHER half, so all of them are the
    // same instant swap. The composed claim is what `CrossfadeOptions.durationMs` documents,
    // and it rests on the non-finite check preceding the clamp in two separate helpers —
    // `resolveFadeInRamp` and `resolveFadeOutRampEnd`, whose own comments note that the
    // opposite order splits NaN from +Infinity into opposite outcomes. Pinning only `0`
    // would leave that composition to those two helpers' current internals.
    it.each([0, -500, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'swaps instantly for a durationMs of %p, on both halves',
        async (durationMs) => {
            const { context, manager, outgoing, incomingRef, startIncoming } =
                await createCrossfadePair();

            manager.crossfade(outgoing, incomingRef, { durationMs });
            await startIncoming();

            expect(expectGain(context, 5).gain.calls).toEqual([
                { method: 'setValueAtTime', value: 0, time: 10 },
                { method: 'cancelAndHoldAtTime', time: 10 },
                { method: 'setValueAtTime', value: 1, time: 10 },
            ]);
            expect(expectGain(context, 4).gain.calls).toEqual([
                { method: 'setValueAtTime', value: 1, time: 10 },
                { method: 'cancelAndHoldAtTime', time: 10 },
                { method: 'setValueAtTime', value: 0, time: 10 },
            ]);
            expect(expectSource(context, 0).stop).toHaveBeenCalledWith(10);
        },
    );

    it('parks no linkage when its own play preempted the outgoing voice', async () => {
        const { context, manager, outgoing, incomingRef, startIncoming } =
            await createCrossfadePair({ poolSize: 1 });

        const incoming = manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });

        // A saturated pool reclaims the outgoing voice to host the incoming one. The
        // outgoing is checked AFTER play() for exactly this reason: a linkage parked
        // against the preempted voice would fire onto a record no longer in the pool.
        expect(outgoing.valid).toBe(false);
        expect(readVoiceRecord(manager, incoming).linkedFadeOut).toBeNull();

        await startIncoming();

        expect(countGainRamps(expectGain(context, 5).gain.calls)).toBe(64);
    });

    it('declines silently when its incoming play is rejected, leaving one warning (#118)', async () => {
        const { context, manager, outgoing, incomingRef } = await createCrossfadePair();
        const warn = spyOnWarn();

        const incoming = manager.crossfade(outgoing, incomingRef, {
            durationMs: 2000,
            from: 5,
            to: 2,
        });

        // The invalid handle is the report channel and `play()` owns the diagnosis of WHY;
        // a second message here would put two warnings on one defect.
        expect(incoming.valid).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            'Audio play window [5s, 2s] is already out of order; rejecting play().',
        );
        expect(expectGain(context, 4).gain.calls).toEqual([
            { method: 'setValueAtTime', value: 1, time: 10 },
        ]);
        expect(readVoiceRecord(manager, outgoing).phase).toBe('playing');
    });

    it('is an inert no-op on a disposed manager', async () => {
        const { context, manager, outgoing, incomingRef } = await createCrossfadePair();
        const warn = spyOnWarn();
        manager.dispose();
        const gainCallsBefore = context.createdGainNodes.map((gain) => [...gain.gain.calls]);

        const incoming = manager.crossfade(outgoing, incomingRef, { durationMs: 2000 });

        expect(incoming.valid).toBe(false);
        expect(warn).not.toHaveBeenCalled();
        expect(context.createdGainNodes.map((gain) => gain.gain.calls)).toEqual(gainCallsBefore);
    });
});

// ─── cue-sheet provenance (#124) ────────────────────────────────────────────────

describe('DefaultAudioManager — cue sheet provenance', () => {
    it('reads the cue sheet once per play and caches it on the voice (#124)', async () => {
        const { assetManager, manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const readMetadata = vi.spyOn(assetManager, 'getManifestMetadata');

        manager.play(ref, { from: { name: 'chorus' } });

        expect(readMetadata).toHaveBeenCalledExactlyOnceWith(ref);

        await flushAudioLoad();

        // Still once: startVoice resolves against the cached sheet, never a second read.
        expect(readMetadata).toHaveBeenCalledOnce();
    });

    it('still honours raw-second cues when the manifest declares no metadata (#118)', async () => {
        const { context, manager, ref } = createCuedManager();

        manager.play(ref, { from: 1, to: 3 });
        await flushAudioLoad();

        expect(expectSource(context, 0).start).toHaveBeenCalledWith(0, 1, 2);
    });

    it('still honours raw-second cues when the manifest metadata is malformed (#118)', async () => {
        const { context, manager, ref } = createCuedManager({ metadata: { cues: 'nope' } });
        const warn = spyOnWarn();

        manager.play(ref, { from: 1, to: 3 });
        await flushAudioLoad();

        expect(expectSource(context, 0).start).toHaveBeenCalledWith(0, 1, 2);
        expect(warn).not.toHaveBeenCalled();

        // A named cue has no sheet to resolve against, so it abandons rather than guessing.
        const named = manager.play(ref, { from: { name: 'chorus' } });
        await flushAudioLoad();

        expect(named.valid).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('never throws out of play for hostile manifest metadata (#118)', () => {
        const hostile: readonly unknown[] = [
            () => undefined,
            Symbol('opaque'),
            [1, 2, 3],
            createSelfReferentialValue(),
            { cues: { intro: Number.NaN }, durationSeconds: 10 },
        ];
        spyOnWarn();

        for (const metadata of hostile) {
            const { manager, ref } = createCuedManager({ metadata });
            expect(() => manager.play(ref, { from: 1, to: 3 })).not.toThrow();
        }
    });

    it('contains a throwing metadata channel and plays with no sheet (#118)', async () => {
        const assetManager = new ThrowingMetadataAssetManagerDouble();
        const context = new FakeAudioContext();
        const manager = new DefaultAudioManager(assetManager, {
            audioContext: asAudioContext(context),
        });
        managers.push(manager);
        const ref = audioRef('audio/music/theme.ogg');
        assetManager.resolve(ref, createAudioBuffer('theme', 10));

        const handle = manager.play(ref, { from: 1, to: 3 });
        await flushAudioLoad();

        expect(handle.valid).toBe(true);
        expect(expectSource(context, 0).start).toHaveBeenCalledWith(0, 1, 2);
    });
});

// ─── AudioHandle public shape (#126) ────────────────────────────────────────────

/**
 * Invariant #126: the public `AudioHandle` gains NO fields — every start-time,
 * offset, and schedule value lives on the internal `VoiceRecord` — and the
 * trust-boundary handle is never spread-built.
 *
 * Three layers, because no single one is sufficient:
 *   (a) TYPE — catches any member added to the interface, including optional ones.
 *       Erased at runtime, so `vitest run` can never fail on it; `tsc` is what
 *       enforces it. Blind to a field added only to the private handle class.
 *   (b) OWN KEYS — catches any new own enumerable property at runtime, including
 *       names nobody thought to deny. Blind to prototype accessors.
 *   (c) DENYLIST — `toHaveProperty` walks the prototype chain, so it is the only
 *       layer that catches a schedule value exposed as a class getter. Name-based,
 *       so it is only as good as the list; keep it in sync with `VoiceRecord`.
 */
describe('AudioHandle — public shape', () => {
    const PUBLIC_KEYS = ['bus', 'id', 'priority', 'ref'] as const;

    it('exposes exactly id, ref, bus, priority, and valid (#126)', async () => {
        const { manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, { from: { name: 'chorus' }, to: { name: 'outro' } });
        await flushAudioLoad();

        expectTypeOf<keyof AudioHandle>().toEqualTypeOf<
            'id' | 'ref' | 'bus' | 'priority' | 'valid'
        >();

        // `valid` is a prototype accessor, so the only extra own key is the handle
        // class's validity flag (TS `private` is compile-time only). Adding any
        // schedule field to the handle pushes this past the expected count.
        const ownKeys = Object.keys(handle);
        expect(ownKeys.filter((key) => PUBLIC_KEYS.includes(key as never)).sort()).toEqual([
            ...PUBLIC_KEYS,
        ]);
        expect(ownKeys).toHaveLength(PUBLIC_KEYS.length + 1);
    });

    it('carries no schedule context even when every cue option is used (#126)', async () => {
        const { manager, ref } = createCuedManager({ metadata: THEME_CUE_SHEET });
        const handle = manager.play(ref, {
            from: { name: 'intro' },
            to: { name: 'outro' },
            loopRegion: { start: { name: 'loopStart' }, end: { name: 'loopEnd' } },
        });
        await flushAudioLoad();

        for (const leaked of [
            'startedAtContextTime',
            'startOffsetSeconds',
            'scheduledStopAt',
            'ceilingHold',
            'settledGain',
            'phase',
            'releaseOnStart',
            'pendingFadeIn',
            'pendingFadeTo',
            'linkedFadeOut',
            'sheet',
            'from',
            'to',
            'loop',
            'loopRegion',
            'loopStart',
            'loopEnd',
            'source',
            'gainNode',
            'pannerNode',
            'position',
            'spatial',
            'sequence',
            'volume',
        ]) {
            expect(handle).not.toHaveProperty(leaked);
        }
    });

    it('builds the handle from a class, never from a spread literal (#126)', async () => {
        const { manager, ref } = createCuedManager();
        const handle = manager.play(ref, { from: 2, to: 6 });
        await flushAudioLoad();

        // A `{ ...record }` literal cannot produce a prototype accessor — its `valid`
        // would be an own data property frozen at build time.
        expect(Object.getOwnPropertyDescriptor(handle, 'valid')).toBeUndefined();
        const proto: unknown = Object.getPrototypeOf(handle);
        expect(proto).not.toBe(Object.prototype);
        expect(typeof Object.getOwnPropertyDescriptor(proto as object, 'valid')?.get).toBe(
            'function',
        );

        // …and the behavioural proof: the handle tracks the live voice.
        expect(handle.valid).toBe(true);
        manager.stop(handle);
        expect(handle.valid).toBe(false);
    });
});

describe('scheduleGainRamp', () => {
    it('writes only the passed voice gain, leaving bus and master gain untouched (#116)', async () => {
        const { assetManager, context, manager } = createManager();
        const ref = audioRef('audio/music/theme.ogg');
        assetManager.resolve(ref, createAudioBuffer('theme'));
        manager.play(ref, { bus: 'music', volume: 0.8 });
        await flushAudioLoad();

        const busGains = [
            expectGain(context, 0), // master
            expectGain(context, 1), // music
            expectGain(context, 2), // sfx
            expectGain(context, 3), // voice bus
        ];
        const voiceGain = expectGain(context, 4); // the played voice's stage-1 gain
        const busCallsBefore = busGains.map((gain) => gain.gain.calls.length);
        const voiceCallsBefore = voiceGain.gain.calls.length;

        scheduleGainRamp(asAudioParam(voiceGain.gain), 0.2, 10, 12, 'linear');

        expect(voiceGain.gain.calls.length).toBeGreaterThan(voiceCallsBefore);
        expect(busGains.map((gain) => gain.gain.calls.length)).toEqual(busCallsBefore);
    });

    it('prefers an explicit departure over what the param reports', () => {
        // The param still reports its default 1 because a setValueAtTime does not move
        // `[[current value]]`; the caller knows better and says so.
        const param = new FakeQuantizedAudioParam();
        param.setValueAtTime(0, 10);

        scheduleGainRamp(asAudioParam(param), 1, 10, 12, 'equalPower', 0);

        const waypoints = param.calls.filter((call) => call.method === 'linearRampToValueAtTime');
        expect(waypoints).toHaveLength(64);
        expect(waypoints[0]?.value).toBeCloseTo(Math.sin(Math.PI / 128), 12);
    });

    it('anchors the fallback re-anchor at an explicit departure, not the stale value', () => {
        // The fallback path WRITES its anchor, so a stale read is audible on every curve
        // — and `cancelScheduledValues` has just dropped whatever the caller scheduled.
        const param = new FakeLinearOnlyAudioParam();

        scheduleGainRamp(asAudioParam(param), 1, 10, 12, 'linear', 0);

        expect(param.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'linearRampToValueAtTime', value: 1, time: 12 },
        ]);
    });

    it('falls back to the param value when no departure is given', () => {
        const param = new FakeQuantizedAudioParam();
        param.setValueAtTime(0, 10);

        scheduleGainRamp(asAudioParam(param), 0.25, 10, 12, 'equalPower');

        // Departing from the unchanged reported value of 1 — the behaviour a caller that
        // does NOT know its own departure must keep getting.
        const waypoints = param.calls.filter((call) => call.method === 'linearRampToValueAtTime');
        expect(waypoints[0]?.value).toBeCloseTo(0.25 + 0.75 * Math.cos(Math.PI / 128), 12);
    });

    it('cancel-and-reanchors then linearly ramps to the target', () => {
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), 0.25, 10, 12, 'linear');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 12 },
        ]);
    });

    it('exponentially ramps to a positive target with no terminal zero', () => {
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), 0.3, 10, 12, 'exponential');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 0.3, time: 12 },
        ]);
    });

    it('ramps exponentially to the 1e-4 epsilon then hard-sets true zero when the target is 0 (#120)', () => {
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), 0, 10, 12, 'exponential');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 1e-4, time: 12 },
            { method: 'setValueAtTime', value: 0, time: 12 },
        ]);
    });

    it('falls back to linear when the departure value is legitimately 0 (#120)', () => {
        const param = new FakeAudioParam();
        param.value = 0;

        scheduleGainRamp(asAudioParam(param), 0.5, 10, 12, 'exponential');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.5, time: 12 },
        ]);
    });

    it('clamps a legitimately-tiny departure up to the epsilon before an exponential ramp (#120)', () => {
        const param = new FakeAudioParam();
        param.value = 5e-5; // 0 < held < 1e-4

        scheduleGainRamp(asAudioParam(param), 0.5, 10, 12, 'exponential');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'setValueAtTime', value: 1e-4, time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 0.5, time: 12 },
        ]);
    });

    it('renders equalPower as >=64 linear waypoints from the held value to the target (#120)', () => {
        const param = new FakeAudioParam(); // held 1

        scheduleGainRamp(asAudioParam(param), 0, 10, 12, 'equalPower');

        expect(param.calls[0]).toEqual({ method: 'cancelAndHoldAtTime', time: 10 });
        const waypoints = param.calls.slice(1);
        expect(waypoints.length).toBeGreaterThanOrEqual(64);
        expect(waypoints.every((call) => call.method === 'linearRampToValueAtTime')).toBe(true);
        for (let index = 0; index < waypoints.length; index += 1) {
            const call = waypoints[index];
            expect(call).toBeDefined();
            expect(call?.time).toBeGreaterThan(10);
            expect(call?.time).toBeLessThanOrEqual(12);
            if (index > 0) {
                expect(call?.time).toBeGreaterThan(waypoints[index - 1]?.time ?? Number.NaN);
                // Monotone fall from the held value (1) down to the target (0).
                expect(call?.value).toBeLessThanOrEqual(waypoints[index - 1]?.value ?? Number.NaN);
            }
            expect(call?.value).toBeGreaterThanOrEqual(0);
            expect(call?.value).toBeLessThanOrEqual(1);
        }
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 12,
        });
    });

    it('shapes an equalPower fade-out as the cosine quarter-wave, not 1 - sin (#120)', () => {
        const param = new FakeAudioParam(); // held 1, falling to 0

        scheduleGainRamp(asAudioParam(param), 0, 10, 12, 'equalPower');

        const waypoints = param.calls.slice(1);
        // A quarter of the way through (time 10.5), an equal-power fade-out sits at
        // cos(pi/8) ~= 0.9239, NOT the 1 - sin(pi/8) ~= 0.6173 a sin-only curve gives.
        const quarter = waypoints.find((call) => call.time === 10.5);
        expect(quarter?.value).toBeCloseTo(Math.cos(Math.PI / 8), 4);
        const threeQuarter = waypoints.find((call) => call.time === 11.5);
        expect(threeQuarter?.value).toBeCloseTo(Math.cos((3 * Math.PI) / 8), 4);
    });

    it('offsets an equalPower partial fade-out by both endpoints, never overshooting the target (#120)', () => {
        const param = new FakeAudioParam();
        param.value = 0.8; // partial fall 0.8 -> 0.2; neither endpoint is 0 or 1

        scheduleGainRamp(asAudioParam(param), 0.2, 10, 12, 'equalPower');

        const waypoints = param.calls.slice(1);
        // Falling: target + (held - target) * cos(progress * pi/2), so the first
        // waypoint departs from just under the re-anchored 0.8 — never near 0.
        expect(waypoints[0]?.value).toBeCloseTo(0.2 + 0.6 * Math.cos(Math.PI / 128), 6);
        const midpoint = waypoints.find((call) => call.time === 11);
        expect(midpoint?.value).toBeCloseTo(0.2 + 0.6 * Math.cos(Math.PI / 4), 6);
        // The waypoint before the forced final one approaches the target from
        // above — it must not undershoot and force a reversal back up to 0.2.
        expect(waypoints.at(-2)?.value).toBeGreaterThanOrEqual(0.2);
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0.2,
            time: 12,
        });
    });

    it('offsets an equalPower partial fade-in by both endpoints, never undershooting the departure (#120)', () => {
        const param = new FakeAudioParam();
        param.value = 0.3; // partial rise 0.3 -> 0.9

        scheduleGainRamp(asAudioParam(param), 0.9, 10, 12, 'equalPower');

        const waypoints = param.calls.slice(1);
        // Rising: held + (target - held) * sin(progress * pi/2), so the first
        // waypoint departs from just above the re-anchored 0.3 — never near 0.
        expect(waypoints[0]?.value).toBeCloseTo(0.3 + 0.6 * Math.sin(Math.PI / 128), 6);
        expect(waypoints[0]?.value).toBeGreaterThanOrEqual(0.3);
        const midpoint = waypoints.find((call) => call.time === 11);
        expect(midpoint?.value).toBeCloseTo(0.3 + 0.6 * Math.sin(Math.PI / 4), 6);
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0.9,
            time: 12,
        });
    });

    it('keeps a symmetric equalPower crossfade at constant power (g_in^2 + g_out^2 = 1) (#120)', () => {
        const incoming = new FakeAudioParam();
        incoming.value = 0; // rising 0 -> 1 (fade-in)
        const outgoing = new FakeAudioParam(); // held 1, falling 1 -> 0 (fade-out)

        scheduleGainRamp(asAudioParam(incoming), 1, 10, 12, 'equalPower');
        scheduleGainRamp(asAudioParam(outgoing), 0, 10, 12, 'equalPower');

        const inWaypoints = incoming.calls.slice(1);
        const outWaypoints = outgoing.calls.slice(1);
        expect(inWaypoints.length).toBe(outWaypoints.length);
        for (let index = 0; index < inWaypoints.length; index += 1) {
            const gIn = inWaypoints[index]?.value ?? Number.NaN;
            const gOut = outWaypoints[index]?.value ?? Number.NaN;
            expect(gIn * gIn + gOut * gOut).toBeCloseTo(1, 4);
        }
    });

    it('clamps a tiny departure to the epsilon after a manual reanchor when cancelAndHoldAtTime throws (#120)', () => {
        const param = new FakeThrowingCancelHoldAudioParam();
        param.value = 5e-5; // 0 < held < 1e-4, on the manual-reanchor path

        scheduleGainRamp(asAudioParam(param), 0.5, 10, 12, 'exponential');

        expect(param.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 5e-5, time: 10 },
            { method: 'setValueAtTime', value: 1e-4, time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 0.5, time: 12 },
        ]);
    });

    it('reanchors via cancelScheduledValues + setValueAtTime when cancelAndHoldAtTime is absent', () => {
        const param = new FakeLinearOnlyAudioParam();

        scheduleGainRamp(asAudioParam(param), 0.25, 10, 12, 'linear');

        expect(param.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 12 },
        ]);
    });

    it('degrades an exponential ramp to linear when exponentialRampToValueAtTime is absent', () => {
        const param = new FakeLinearOnlyAudioParam();

        expect(() =>
            scheduleGainRamp(asAudioParam(param), 0.3, 10, 12, 'exponential'),
        ).not.toThrow();

        expect(param.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.3, time: 12 },
        ]);
    });

    it('renders equalPower with plain linear ramps even on a linear-only platform', () => {
        const param = new FakeLinearOnlyAudioParam();

        expect(() => scheduleGainRamp(asAudioParam(param), 0, 10, 12, 'equalPower')).not.toThrow();

        expect(param.calls[0]).toEqual({ method: 'cancelScheduledValues', time: 10 });
        expect(param.calls[1]).toEqual({ method: 'setValueAtTime', value: 1, time: 10 });
        const waypoints = param.calls.slice(2);
        expect(waypoints.length).toBeGreaterThanOrEqual(64);
        expect(waypoints.every((call) => call.method === 'linearRampToValueAtTime')).toBe(true);
        expect(waypoints.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0,
            time: 12,
        });
    });

    it('falls back to cancel + set when cancelAndHoldAtTime throws', () => {
        const param = new FakeThrowingCancelHoldAudioParam();

        expect(() => scheduleGainRamp(asAudioParam(param), 0.4, 10, 12, 'linear')).not.toThrow();

        expect(param.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 1, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.4, time: 12 },
        ]);
    });

    it('degrades an exponential ramp to linear when exponentialRampToValueAtTime throws', () => {
        const param = new FakeThrowingExponentialAudioParam();

        expect(() =>
            scheduleGainRamp(asAudioParam(param), 0.3, 10, 12, 'exponential'),
        ).not.toThrow();

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.3, time: 12 },
        ]);
    });

    it('keeps the departure anchor already written when an exponential ramp throws', () => {
        const param = new FakeThrowingExponentialAudioParam();
        param.value = 5e-5; // 0 < held < 1e-4, so the epsilon anchor lands before the throw

        expect(() =>
            scheduleGainRamp(asAudioParam(param), 0.5, 10, 12, 'exponential'),
        ).not.toThrow();

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'setValueAtTime', value: 1e-4, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.5, time: 12 },
        ]);
    });

    it('schedules normally at startTime 0, the boundary the negative-time guard rejects from', () => {
        // 0 is the only value classified differently by `startTime < 0` and `<= 0`, so it
        // is the one input that separates the guard from one that no-ops a legal ramp.
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), 0.25, 0, 2, 'linear');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 0 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 2 },
        ]);
    });

    it('writes nothing and does not throw when startTime is negative or not finite', () => {
        for (const startTime of [
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            -1,
            -0.000_1,
        ]) {
            const param = new FakeAudioParam();

            expect(() =>
                scheduleGainRamp(asAudioParam(param), 0.5, startTime, 12, 'linear'),
            ).not.toThrow();

            expect(param.calls).toEqual([]);
            expect(param.value).toBe(1);
        }
    });

    it('never lets an unschedulable time reach a spec-compliant AudioParam', () => {
        // A real AudioParam throws RangeError on a negative or non-finite time from
        // every automation method — including the cancel calls the reanchor makes —
        // so the helper's "never throws" contract only holds if it filters them first.
        const unschedulable = [Number.NaN, Number.POSITIVE_INFINITY, -1];

        for (const curve of ['linear', 'exponential', 'equalPower'] as const) {
            for (const startTime of unschedulable) {
                const param = new FakeStrictTimeAudioParam();

                expect(() =>
                    scheduleGainRamp(asAudioParam(param), 0.5, startTime, 12, curve),
                ).not.toThrow();

                expect(param.calls).toEqual([]);
            }

            for (const endTime of unschedulable) {
                const param = new FakeStrictTimeAudioParam();

                expect(() =>
                    scheduleGainRamp(asAudioParam(param), 0.5, 10, endTime, curve),
                ).not.toThrow();
            }
        }
    });

    it('applies the clamped target instantly when endTime is not finite', () => {
        for (const endTime of [Number.NaN, Number.POSITIVE_INFINITY]) {
            const param = new FakeAudioParam();

            scheduleGainRamp(asAudioParam(param), 0.5, 10, endTime, 'linear');

            expect(param.calls).toEqual([
                { method: 'cancelAndHoldAtTime', time: 10 },
                { method: 'setValueAtTime', value: 0.5, time: 10 },
            ]);
        }
    });

    it('clamps a legitimately-tiny target up to the epsilon on an exponential ramp (#120)', () => {
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), 5e-5, 10, 12, 'exponential'); // 0 < target < 1e-4

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'exponentialRampToValueAtTime', value: 1e-4, time: 12 },
        ]);
    });

    it('defaults to the linear curve when none is passed', () => {
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), 0.25, 10, 12);

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 12 },
        ]);
    });

    it('clamps a non-finite target to 0 rather than scheduling NaN', () => {
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), Number.NaN, 10, 12, 'linear');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 12 },
        ]);
    });

    it('applies the clamped target instantly when the ramp window is empty or backwards', () => {
        const param = new FakeAudioParam();

        scheduleGainRamp(asAudioParam(param), 0.5, 12, 12, 'linear');

        expect(param.calls).toEqual([
            { method: 'cancelAndHoldAtTime', time: 12 },
            { method: 'setValueAtTime', value: 0.5, time: 12 },
        ]);
    });
});

function createManager(options: { readonly poolSize?: number } = {}): {
    readonly assetManager: AssetManagerDouble;
    readonly context: FakeAudioContext;
    readonly manager: DefaultAudioManager;
} {
    const assetManager = new AssetManagerDouble();
    const context = new FakeAudioContext();
    const managerOptions: AudioManagerOptions =
        options.poolSize === undefined
            ? { audioContext: asAudioContext(context) }
            : { audioContext: asAudioContext(context), poolSize: options.poolSize };
    const manager = new DefaultAudioManager(assetManager, managerOptions);
    managers.push(manager);
    return { assetManager, context, manager };
}

function audioRef(relativePath: string): AssetRef<AudioClipAsset> {
    return buildAssetRef<AudioClipAsset>('tactics', relativePath);
}

/**
 * Play one voice from a ref of its own, pre-resolved to a 10 s buffer. Every voice in a
 * preemption test needs a DISTINCT ref: the ranking is a property of the pool's
 * membership, and two plays sharing a ref would be indistinguishable in the source log
 * that says which one was reclaimed.
 */
function playPooledVoice(
    created: {
        readonly assetManager: AssetManagerDouble;
        readonly manager: DefaultAudioManager;
    },
    name: string,
    opts: PlayOptions = {},
): AudioHandle {
    const ref = audioRef(`audio/sfx/${name}.ogg`);
    created.assetManager.resolve(ref, createAudioBuffer(name, 10));
    return created.manager.play(ref, opts);
}

/** The handle a permuted play order filed under `name`, or a named failure. */
function expectHandle(handles: ReadonlyMap<string, AudioHandle>, name: string): AudioHandle {
    const handle = handles.get(name);
    if (handle === undefined) {
        throw new Error(`Expected voice ${name} to have been played.`);
    }
    return handle;
}

function createAudioBuffer(name: string, durationSeconds = 1): AudioBuffer {
    const sampleRate = 48_000;
    return {
        duration: durationSeconds,
        getChannelData(): Float32Array {
            return new Float32Array(0);
        },
        length: Math.round(durationSeconds * sampleRate),
        name,
        numberOfChannels: 1,
        sampleRate,
    } as unknown as AudioBuffer;
}

/**
 * Build a manager whose single ref carries `metadata` and decodes to a buffer of
 * `bufferSeconds`. The two are deliberately independent: an authoring sheet may
 * overstate the clip length, and every range check must use the DECODED duration.
 */
function createCuedManager(
    options: {
        readonly bufferSeconds?: number;
        readonly metadata?: unknown;
        readonly poolSize?: number;
        /** Give the voice a gain whose `value` cannot see same-turn automation. */
        readonly quantizedGainParams?: boolean;
    } = {},
): {
    readonly assetManager: AssetManagerDouble;
    readonly context: FakeAudioContext;
    readonly manager: DefaultAudioManager;
    readonly ref: AssetRef<AudioClipAsset>;
} {
    const created =
        options.poolSize === undefined
            ? createManager()
            : createManager({ poolSize: options.poolSize });
    // Set after the constructor, so the voice's own stage-1 gain is created quantized
    // while the four bus gains stay on the ordinary double.
    created.context.quantizedGainParams = options.quantizedGainParams ?? false;
    const ref = audioRef('audio/music/theme.ogg');
    // `in` rather than `!== undefined`, so a test can register a literal `undefined`.
    if ('metadata' in options) {
        created.assetManager.registerMetadata(ref, options.metadata);
    }
    created.assetManager.resolve(ref, createAudioBuffer('theme', options.bufferSeconds ?? 10));
    return { ...created, ref };
}

/**
 * Hide `cancelAndHoldAtTime` on ONE live voice's gain, modelling the platforms that
 * lack it. An own property shadowing the prototype method, rather than a whole new
 * double or a prototype edit: what needs proving is how the MANAGER re-anchors on such
 * a platform, and the shadow cannot leak into another test's params.
 */
function stubMissingCancelAndHold(param: FakeAudioParam): void {
    Object.defineProperty(param, 'cancelAndHoldAtTime', { configurable: true, value: undefined });
}

/**
 * Advance the context clock on EVERY read, from `10` in `step`s.
 *
 * Models no real platform — a real `currentTime` is stable within a JS turn, which is
 * exactly why the frozen double cannot tell "anchored to the `t0` it was handed" apart from
 * "re-read the clock and got the same number". Under this one they diverge, so a shared
 * window has to be shared by construction rather than by coincidence.
 */
function driftAudioClock(context: FakeAudioContext, step = 0.5): void {
    let reads = 0;
    Object.defineProperty(context, 'currentTime', {
        configurable: true,
        get: (): number => {
            const now = 10 + step * reads;
            reads += 1;
            return now;
        },
    });
}

/** Silences and counts the renderer's fail-soft warning channel. */
function spyOnWarn(): MockInstance<typeof console.warn> {
    return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

/** The internal `VoiceRecord` slice the tests assert on, behind one cast site. */
interface ObservableVoiceRecord {
    /** The SETTLED voice ceiling, which `fadeTo` rewrites — not a copy of `PlayOptions`. */
    volume: number;
    scheduledStopAt: number | null;
    startedAtContextTime: number | null;
    startOffsetSeconds: number;
    bufferDurationSeconds: number | null;
    loopWindowSeconds: { readonly startSeconds: number; readonly endSeconds: number } | null;
    /** Bound to the production union, so a phase added later fails `tsc` here. */
    phase: VoicePhase;
    releaseOnStart: boolean;
    pendingFadeIn: FadeInSpec | null;
    pendingFadeTo: FadeToSpec | null;
    linkedFadeOut: ((startedAt: number) => void) | null;
}

/**
 * Read a live voice's internal schedule and pending-intent state. No public surface
 * exposes any of it — `AudioHandle` deliberately gains no fields (Invariant #126) — and
 * without a reader the difference between "stop scheduled" and "stop refused", between
 * "intent parked" and "intent lost", or between a voice mid-ramp and one already
 * released, is unobservable.
 */
function readVoiceRecord(manager: DefaultAudioManager, handle: AudioHandle): ObservableVoiceRecord {
    // @chimera-review: reaches the manager's private voice map because the handle exposes none of this schedule state by design; asserting it here is what stops it becoming unverifiable write-only state.
    const { voices } = manager as unknown as { voices: Map<string, ObservableVoiceRecord> };
    const record = voices.get(handle.id);
    if (record === undefined) {
        throw new Error(`Expected a live voice for handle ${handle.id}.`);
    }
    return record;
}

/**
 * Park pre-start intents on a loading voice's record — the seam `crossfade` writes
 * through in production. Every slot now has a production writer (`PlayOptions.fadeIn`,
 * `fadeOut`, `fadeTo` and `crossfade`), so this no longer exists to REACH one; it exists
 * to make the precedence order observable. A real crossfade's linkage ramps another
 * voice's gain, which says nothing about WHERE in the order it fired, whereas a thunk
 * parked here can record the gain-write count it saw.
 */
function writeVoiceIntents(
    manager: DefaultAudioManager,
    handle: AudioHandle,
    intents: Partial<ObservableVoiceRecord>,
): void {
    Object.assign(readVoiceRecord(manager, handle), intents);
}

/**
 * A voice held in the `'loading'` phase: `play()` has returned, but the asset promise
 * is still pending, so `startVoice` has not run and `source`/`gainNode` are both null.
 * That window is the only place a pre-start intent can be observed unapplied.
 */
function createLoadingVoice(
    options: {
        readonly bufferSeconds?: number;
        readonly metadata?: unknown;
        readonly playOptions?: PlayOptions;
        /** Give the voice a gain whose `value` cannot see same-turn automation. */
        readonly quantizedGainParams?: boolean;
    } = {},
): {
    readonly context: FakeAudioContext;
    readonly manager: DefaultAudioManager;
    readonly handle: AudioHandle;
    /** Resolve the pending load and drain the microtask hops, running `startVoice`. */
    readonly start: () => Promise<void>;
} {
    const { assetManager, context, manager } = createManager();
    // Set before play(), so the voice's own stage-1 gain is created quantized while the
    // four bus gains (built in the constructor) stay on the ordinary double.
    context.quantizedGainParams = options.quantizedGainParams ?? false;
    const ref = audioRef('audio/music/theme.ogg');
    if ('metadata' in options) {
        assetManager.registerMetadata(ref, options.metadata);
    }
    const deferred = assetManager.defer(ref);
    const handle = manager.play(ref, options.playOptions ?? {});

    return {
        context,
        manager,
        handle,
        start: async (): Promise<void> => {
            deferred.resolve(createAudioBuffer('theme', options.bufferSeconds ?? 10));
            await flushAudioLoad();
        },
    };
}

/**
 * The two voices a crossfade meets: an OUTGOING one already playing, and an INCOMING ref
 * whose load is still pending.
 *
 * The incoming half is deferred rather than resolved, because the whole linkage exists to
 * be applied at that voice's real `t0` — resolving it eagerly would collapse the window in
 * which the outgoing must still be playing at full volume, which is half of what these
 * tests are for. `deferOutgoing` holds the OTHER one back too, the only state in which the
 * linkage has no gain to ramp.
 *
 * Gain-node indices follow start order, not call order: with a started outgoing it owns
 * index 4 and the incoming index 5, but under `deferOutgoing` the incoming starts first and
 * takes index 4.
 */
async function createCrossfadePair(
    options: {
        readonly deferOutgoing?: boolean;
        readonly incomingBufferSeconds?: number;
        readonly outgoingPlayOptions?: PlayOptions;
        readonly poolSize?: number;
    } = {},
): Promise<{
    readonly assetManager: AssetManagerDouble;
    readonly context: FakeAudioContext;
    readonly manager: DefaultAudioManager;
    readonly outgoing: AudioHandle;
    readonly incomingRef: AssetRef<AudioClipAsset>;
    readonly incomingLoad: DeferredValue<ResolvedAsset<AudioClipAsset>>;
    /** Resolve the incoming load and drain the hops, running its `startVoice`. */
    readonly startIncoming: () => Promise<void>;
    /** The same for the outgoing one, which only `deferOutgoing` leaves unstarted. */
    readonly startOutgoing: () => Promise<void>;
}> {
    const { assetManager, context, manager } =
        options.poolSize === undefined
            ? createManager()
            : createManager({ poolSize: options.poolSize });
    const outgoingRef = audioRef('audio/music/theme.ogg');
    const incomingRef = audioRef('audio/music/battle.ogg');
    const outgoingLoad = assetManager.defer(outgoingRef);
    const incomingLoad = assetManager.defer(incomingRef);
    const startOutgoing = async (): Promise<void> => {
        outgoingLoad.resolve(createAudioBuffer('theme', 10));
        await flushAudioLoad();
    };

    const outgoing = manager.play(outgoingRef, options.outgoingPlayOptions ?? {});
    if (options.deferOutgoing !== true) {
        await startOutgoing();
    }

    return {
        assetManager,
        context,
        manager,
        outgoing,
        incomingRef,
        incomingLoad,
        startIncoming: async (): Promise<void> => {
            incomingLoad.resolve(createAudioBuffer('battle', options.incomingBufferSeconds ?? 10));
            await flushAudioLoad();
        },
        startOutgoing,
    };
}

/** How many gain ramps a call log holds — the write a fade is made of. */
function countGainRamps(calls: readonly ScheduledGainCall[]): number {
    return calls.filter((call) => call.method.endsWith('RampToValueAtTime')).length;
}

/** The recorded `source.start` arguments, so a test can assert an ABSENT third arg. */
function expectStartArgs(source: FakeAudioBufferSourceNode): readonly (number | undefined)[] {
    const call = source.start.mock.calls[0];
    if (call === undefined) {
        throw new Error('Expected source.start to have been called.');
    }
    return call;
}

function expectGain(context: FakeAudioContext, index: number): FakeGainNode {
    const node = context.createdGainNodes[index];
    if (node === undefined) {
        throw new Error(`Expected gain node ${index} to exist.`);
    }
    return node;
}

function expectSource(context: FakeAudioContext, index: number): FakeAudioBufferSourceNode {
    const source = context.createdSources[index];
    if (source === undefined) {
        throw new Error(`Expected source ${index} to exist.`);
    }
    return source;
}

function expectPanner(context: FakeAudioContext, index: number): FakePannerNode {
    const node = context.createdPannerNodes[index];
    if (node === undefined) {
        throw new Error(`Expected panner node ${index} to exist.`);
    }
    return node;
}

async function flushAudioLoad(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

/** A cyclic object graph — hostile input a naive metadata walk would hang on. */
function createSelfReferentialValue(): unknown {
    const value: Record<string, unknown> = { durationSeconds: 10 };
    value['self'] = value;
    return value;
}

function createDeferred<TValue>(): DeferredValue<TValue> {
    let resolveDeferred: ((value: TValue) => void) | null = null;
    let rejectDeferred: ((error: unknown) => void) | null = null;
    const promise = new Promise<TValue>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });

    if (resolveDeferred === null || rejectDeferred === null) {
        throw new Error('Deferred promise callbacks were not initialized.');
    }

    return {
        promise,
        resolve(value): void {
            resolveDeferred?.(value);
        },
        reject(error): void {
            rejectDeferred?.(error);
        },
    };
}

function asAudioNode<TAudioNode extends AudioNode>(node: object): TAudioNode {
    // @chimera-review: Audio tests provide narrow Web Audio doubles for the members used by AudioBus and AudioManager; this cast avoids creating a real AudioContext in unit tests.
    return node as unknown as TAudioNode;
}

function asAudioParam(param: object): AudioParam {
    // @chimera-review: Gain-ramp tests exercise scheduleGainRamp against narrow AudioParam doubles that record the automation calls used by the helper; this cast keeps the tests off a real AudioContext.
    return param as unknown as AudioParam;
}

function asAudioContext(context: FakeAudioContext): AudioContext {
    // @chimera-review: FakeAudioContext implements the createGain/createBufferSource/currentTime surface used by AudioManager; this keeps unit tests off a real AudioContext.
    return context as unknown as AudioContext;
}

function asAudioContextConstructor(
    constructor: new () => FakeAudioContext,
): new () => AudioContext {
    return constructor as unknown as new () => AudioContext;
}

function withAudioContextGlobals(
    constructors: {
        readonly AudioContext?: new () => AudioContext;
        readonly webkitAudioContext?: new () => AudioContext;
    },
    callback: () => void,
): void {
    const audioGlobal = globalThis as {
        AudioContext?: new () => AudioContext;
        webkitAudioContext?: new () => AudioContext;
    };
    const hadAudioContext = 'AudioContext' in audioGlobal;
    const hadWebkitAudioContext = 'webkitAudioContext' in audioGlobal;
    const previousAudioContext = audioGlobal.AudioContext;
    const previousWebkitAudioContext = audioGlobal.webkitAudioContext;
    FakeGlobalAudioContext.instances.length = 0;

    setAudioContextGlobal(audioGlobal, 'AudioContext', constructors.AudioContext);
    setAudioContextGlobal(audioGlobal, 'webkitAudioContext', constructors.webkitAudioContext);
    try {
        callback();
    } finally {
        restoreAudioContextGlobal(
            audioGlobal,
            'AudioContext',
            hadAudioContext,
            previousAudioContext,
        );
        restoreAudioContextGlobal(
            audioGlobal,
            'webkitAudioContext',
            hadWebkitAudioContext,
            previousWebkitAudioContext,
        );
    }
}

function setAudioContextGlobal(
    audioGlobal: {
        AudioContext?: new () => AudioContext;
        webkitAudioContext?: new () => AudioContext;
    },
    key: 'AudioContext' | 'webkitAudioContext',
    constructor: (new () => AudioContext) | undefined,
): void {
    if (constructor === undefined) {
        Reflect.deleteProperty(audioGlobal, key);
        return;
    }

    Object.defineProperty(audioGlobal, key, {
        configurable: true,
        value: constructor,
        writable: true,
    });
}

function restoreAudioContextGlobal(
    audioGlobal: {
        AudioContext?: new () => AudioContext;
        webkitAudioContext?: new () => AudioContext;
    },
    key: 'AudioContext' | 'webkitAudioContext',
    hadConstructor: boolean,
    constructor: (new () => AudioContext) | undefined,
): void {
    if (!hadConstructor) {
        Reflect.deleteProperty(audioGlobal, key);
        return;
    }

    setAudioContextGlobal(audioGlobal, key, constructor);
}
