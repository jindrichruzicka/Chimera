import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildAssetRef,
    type AssetKind,
    type AssetRef,
    type AudioClipAsset,
} from '@chimera/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../assets/AssetManager';
import { useSettingsStore } from '../state/settingsStore';
import { createAudioManager, DefaultAudioManager, type AudioManagerOptions } from './AudioManager';

interface ScheduledGainCall {
    readonly method: 'cancelScheduledValues' | 'setValueAtTime' | 'linearRampToValueAtTime';
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
    public onended: ((this: AudioBufferSourceNode, event: Event) => unknown) | null = null;
    public readonly start = vi.fn();
    public readonly stop = vi.fn();

    public finish(): void {
        this.onended?.call(asAudioNode<AudioBufferSourceNode>(this), new Event('ended'));
    }
}

class FakeAudioContext {
    public currentTime = 10;
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

    public registerManifest(): void {}

    public async preloadCritical(): Promise<void> {}

    public get<TAssetKind extends AssetKind>(
        _ref: AssetRef<TAssetKind>,
    ): ResolvedAsset<TAssetKind> | null {
        return null;
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
}

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

function createAudioBuffer(name: string): AudioBuffer {
    return {
        duration: 1,
        getChannelData(): Float32Array {
            return new Float32Array(0);
        },
        length: 48_000,
        name,
        numberOfChannels: 1,
        sampleRate: 48_000,
    } as unknown as AudioBuffer;
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
