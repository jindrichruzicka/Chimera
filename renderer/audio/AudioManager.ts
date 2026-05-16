import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../assets/AssetManager';
import { AudioBus, type AudioBusId, type AudioBusOptions } from './AudioBus';

export type { AudioBusId } from './AudioBus';

type AudioPosition = readonly [number, number, number];

export interface PlayOptions {
    readonly bus?: AudioBusId;
    readonly loop?: boolean;
    readonly volume?: number;
    readonly position?: AudioPosition;
    readonly priority?: number;
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

interface VoiceRecord {
    readonly handle: ManagedAudioHandle;
    readonly loop: boolean;
    readonly position: AudioPosition | null;
    readonly sequence: number;
    readonly volume: number;
    source: AudioBufferSourceNode | null;
    gainNode: GainNode | null;
    pannerNode: PannerNode | null;
}

const DEFAULT_POOL_SIZE = 32;
const DEFAULT_BUS_ID: AudioBusId = 'sfx';
const DEFAULT_PRIORITY = 0;
const DEFAULT_VOLUME = 1;
const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'voice'];

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

        this.reserveVoiceSlot();
        if (this.voices.size >= this.poolSize) {
            handle.invalidate();
            return handle;
        }

        const record: VoiceRecord = {
            handle,
            loop: opts.loop ?? false,
            position: opts.position ?? null,
            sequence: this.nextSequence,
            volume: clampUnit(opts.volume ?? DEFAULT_VOLUME),
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

    private startVoice(record: VoiceRecord, buffer: AudioBuffer): void {
        if (this.disposed || !record.handle.valid || !this.voices.has(record.handle.id)) {
            return;
        }

        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        record.source = source;
        record.gainNode = gainNode;

        source.buffer = buffer;
        source.loop = record.loop;
        source.onended = () => {
            this.releaseVoice(record, { stopSource: false });
        };
        gainNode.gain.setValueAtTime(record.volume, this.audioContext.currentTime);
        this.connectVoice(record, source, gainNode);

        try {
            source.start();
        } catch {
            this.releaseVoice(record, { stopSource: false });
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
