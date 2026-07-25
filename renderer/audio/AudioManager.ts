import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, ResolvedAsset } from '../assets/AssetManager';
import { AudioBus, type AudioBusId, type AudioBusOptions } from './AudioBus';
import type { FadeCurve } from './Cue';

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
const GAIN_RAMP_EPSILON = 1e-4;
const EQUAL_POWER_WAYPOINTS = 64;

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
 */
export function scheduleGainRamp(
    param: AudioParam,
    target: number,
    startTime: number,
    endTime: number,
    curve: FadeCurve = 'linear',
): void {
    if (!Number.isFinite(startTime) || startTime < 0) {
        // No usable anchor time — a spec-compliant AudioParam throws RangeError for a
        // negative or non-finite time on every automation method, including the
        // cancel calls the reanchor would make, so write nothing at all.
        return;
    }

    const held = reanchorGain(param, startTime);
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
 * anchor — matching {@link AudioBus.duck}.
 */
function reanchorGain(param: AudioParam, startTime: number): number {
    if (typeof param.cancelAndHoldAtTime === 'function') {
        try {
            param.cancelAndHoldAtTime(startTime);
            return param.value;
        } catch {
            // Unsupported on this platform — fall through to the manual reanchor.
        }
    }

    param.cancelScheduledValues(startTime);
    const held = param.value;
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
