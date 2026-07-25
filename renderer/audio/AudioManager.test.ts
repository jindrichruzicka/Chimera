/**
 * renderer/audio/AudioManager.test.ts
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * Invariants upheld:
 *   #117 — provenance-scoped two-tier cue validation; `loopRegion` implies `loop`;
 *          a looping `to` bounds elapsed play duration, not a buffer wrap.
 *   #118 — cue resolution is fail-soft: it never throws into a caller, an
 *          unresolvable load-bearing anchor abandons with one warning, end-point
 *          cues clamp, and a post-clamp-collapsed window is dropped.
 *   #119 — a scheduled stop drives release through the native `onended` handler,
 *          never a wall-clock timer.
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
    scheduleGainRamp,
    type AudioHandle,
    type AudioManagerOptions,
} from './AudioManager';

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
    public readonly gain = new FakeAudioParam();
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
    public readonly createdGainNodes: FakeGainNode[] = [];
    public readonly createdPannerNodes: FakePannerNode[] = [];
    public readonly createdSources: FakeAudioBufferSourceNode[] = [];
    public readonly destination = asAudioNode<AudioDestinationNode>(new FakeAudioNode());
    public readonly close = vi.fn((): Promise<void> => Promise.resolve());

    public createGain(): GainNode {
        const node = new FakeGainNode();
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

        manager.play(ref, { bus: 'sfx', position: [1, -2, 3], volume: 0.7 });
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
        expect(readVoiceSchedule(manager, handle).scheduledStopAt).toBeNull();
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
        expect(readVoiceSchedule(manager, handle).scheduledStopAt).toBeNull();
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
        expect(readVoiceSchedule(manager, handle).scheduledStopAt).toBe(14);
    });

    it('records the playhead anchors a later fade derives its timing from (#122)', async () => {
        // Nothing in this change reads these, so without an assertion they are
        // unverifiable write-only state; a fade would silently inherit whatever they
        // happen to hold. Folded entry (period 4, (9-2) mod 4 = 3 → 5) and a real
        // start time advanced past the play() call.
        const { context, manager, ref } = createCuedManager();

        const handle = manager.play(ref, { from: 9, loopRegion: { start: 2, end: 6 } });
        context.currentTime = 12;
        await flushAudioLoad();

        expect(readVoiceSchedule(manager, handle)).toMatchObject({
            startOffsetSeconds: 5,
            startedAtContextTime: 12,
        });
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
    const ref = audioRef('audio/music/theme.ogg');
    // `in` rather than `!== undefined`, so a test can register a literal `undefined`.
    if ('metadata' in options) {
        created.assetManager.registerMetadata(ref, options.metadata);
    }
    created.assetManager.resolve(ref, createAudioBuffer('theme', options.bufferSeconds ?? 10));
    return { ...created, ref };
}

/** Silences and counts the renderer's fail-soft warning channel. */
function spyOnWarn(): MockInstance<typeof console.warn> {
    return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

/**
 * Read a live voice's internal `scheduledStopAt`. This change writes the field for the
 * fade verbs to consume later, so no public surface exposes it yet — and without a
 * reader the difference between "stop scheduled" and "stop refused" is unobservable,
 * which is exactly the state a later ramp clamp must not be misled by.
 */
function readVoiceSchedule(
    manager: DefaultAudioManager,
    handle: AudioHandle,
): {
    readonly scheduledStopAt: number | null;
    readonly startedAtContextTime: number | null;
    readonly startOffsetSeconds: number;
} {
    // @chimera-review: reaches the manager's private voice map because these fields have no public reader until the fade verbs land; asserting them here is what stops them becoming unverifiable write-only state.
    const { voices } = manager as unknown as {
        voices: Map<
            string,
            {
                scheduledStopAt: number | null;
                startedAtContextTime: number | null;
                startOffsetSeconds: number;
            }
        >;
    };
    const record = voices.get(handle.id);
    if (record === undefined) {
        throw new Error(`Expected a live voice for handle ${handle.id}.`);
    }
    return record;
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
