import { useSettingsStore, type SettingsStoreState } from '../state/settingsStore';

export type AudioBusId = 'master' | 'music' | 'sfx' | 'voice';

export interface AudioBusOptions {
    readonly duckRampMs?: number;
}

interface AudioSettingsSnapshot {
    readonly masterVolume: number;
    readonly sfxVolume: number;
    readonly musicVolume: number;
    readonly muted: boolean;
}

const ENGINE_SETTINGS_GAME_ID = '__engine__';
const DEFAULT_DUCK_RAMP_MS = 50;
const DEFAULT_AUDIO_SETTINGS: AudioSettingsSnapshot = {
    masterVolume: 1,
    sfxVolume: 1,
    musicVolume: 0.8,
    muted: false,
};

export class AudioBus {
    public readonly gainNode: GainNode;

    private readonly audioContext: AudioContext;
    private readonly duckRampSeconds: number;
    private readonly unsubscribeSettings: () => void;
    private volume = 1;
    private locallyMuted = false;
    private settingsMuted = false;
    private duckedVolume: number | null = null;
    private restoreTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    public constructor(
        public readonly id: AudioBusId,
        audioContext: AudioContext,
        options: AudioBusOptions = {},
    ) {
        this.audioContext = audioContext;
        this.duckRampSeconds = (options.duckRampMs ?? DEFAULT_DUCK_RAMP_MS) / 1000;
        this.gainNode = audioContext.createGain();
        this.unsubscribeSettings = useSettingsStore.subscribe((state) => {
            this.applySettingsState(state);
        });

        this.applySettingsState(useSettingsStore.getState());
    }

    public setVolume(value: number): void {
        if (this.disposed) {
            return;
        }

        this.volume = clampUnit(value);
        this.applyEffectiveGain();
    }

    public mute(): void {
        if (this.disposed) {
            return;
        }

        this.locallyMuted = true;
        this.applyEffectiveGain();
    }

    public unmute(): void {
        if (this.disposed) {
            return;
        }

        this.locallyMuted = false;
        this.applyEffectiveGain();
    }

    public duck(duckedVolume: number, durationMs: number): void {
        if (this.disposed) {
            return;
        }

        const now = this.audioContext.currentTime;
        const startValue = this.getEffectiveGain();
        this.duckedVolume = clampUnit(duckedVolume);
        this.clearRestoreTimer();

        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(startValue, now);
        this.gainNode.gain.linearRampToValueAtTime(
            this.getEffectiveGain(),
            now + this.duckRampSeconds,
        );

        this.restoreTimer = setTimeout(
            () => {
                this.restoreFromDuck();
            },
            Math.max(0, durationMs),
        );
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.clearRestoreTimer();
        this.unsubscribeSettings();
        this.gainNode.disconnect();
    }

    private restoreFromDuck(): void {
        if (this.disposed || this.duckedVolume === null) {
            return;
        }

        const now = this.audioContext.currentTime;
        const startValue = this.getEffectiveGain();
        this.duckedVolume = null;
        const targetValue = this.getEffectiveGain();

        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(startValue, now);
        this.gainNode.gain.linearRampToValueAtTime(targetValue, now + this.duckRampSeconds);
        this.restoreTimer = null;
    }

    private applySettingsState(state: SettingsStoreState): void {
        if (this.disposed) {
            return;
        }

        const settings = selectSettingsForBus(state);
        const audio = readAudioSettings(settings);
        if (audio === null) {
            this.settingsMuted = DEFAULT_AUDIO_SETTINGS.muted;
            const fallbackVolume = getSettingsVolume(this.id, DEFAULT_AUDIO_SETTINGS);
            if (fallbackVolume !== null) {
                this.volume = clampUnit(fallbackVolume);
            }
            this.applyEffectiveGain();
            return;
        }

        this.settingsMuted = audio.muted;
        const settingsVolume = getSettingsVolume(this.id, audio);
        if (settingsVolume !== null) {
            this.volume = clampUnit(settingsVolume);
        }
        this.applyEffectiveGain();
    }

    private applyEffectiveGain(): void {
        if (this.disposed) {
            return;
        }

        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.getEffectiveGain(), now);
    }

    private getEffectiveGain(): number {
        if (this.locallyMuted || this.settingsMuted) {
            return 0;
        }

        return this.duckedVolume ?? this.volume;
    }

    private clearRestoreTimer(): void {
        if (this.restoreTimer === null) {
            return;
        }

        clearTimeout(this.restoreTimer);
        this.restoreTimer = null;
    }
}

function selectSettingsForBus(state: SettingsStoreState): unknown {
    const activeSettings =
        state.activeGameId === null ? undefined : state.settings[state.activeGameId];
    return activeSettings ?? state.settings[ENGINE_SETTINGS_GAME_ID];
}

function readAudioSettings(settings: unknown): AudioSettingsSnapshot | null {
    if (!isRecord(settings)) {
        return null;
    }

    const audio = settings['audio'];
    if (!isRecord(audio)) {
        return null;
    }

    const masterVolume = audio['masterVolume'];
    const sfxVolume = audio['sfxVolume'];
    const musicVolume = audio['musicVolume'];
    const muted = audio['muted'];

    if (
        typeof masterVolume !== 'number' ||
        typeof sfxVolume !== 'number' ||
        typeof musicVolume !== 'number' ||
        typeof muted !== 'boolean'
    ) {
        return null;
    }

    return { masterVolume, sfxVolume, musicVolume, muted };
}

function getSettingsVolume(id: AudioBusId, audio: AudioSettingsSnapshot): number | null {
    switch (id) {
        case 'master':
            return audio.masterVolume;
        case 'music':
            return audio.musicVolume;
        case 'sfx':
            return audio.sfxVolume;
        case 'voice':
            return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(1, Math.max(0, value));
}
