// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioBus, type AudioBusId } from './AudioBus';
import { useSettingsStore } from '../state/settingsStore';
import type { ResolvedSettings } from '@chimera/simulation/bridge/api-types.js';

interface ScheduledGainCall {
    readonly method: 'cancelScheduledValues' | 'setValueAtTime' | 'linearRampToValueAtTime';
    readonly value?: number;
    readonly time: number;
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

class FakeGainNode {
    public readonly gain = new FakeAudioParam();
    public readonly disconnect = vi.fn();
}

class FakeAudioContext {
    public currentTime = 10;
    public readonly createdGainNodes: FakeGainNode[] = [];

    public createGain(): GainNode {
        const node = new FakeGainNode();
        this.createdGainNodes.push(node);
        // @chimera-review: FakeGainNode implements the subset of GainNode used by AudioBus; the cast bridges the test double to the Web Audio API type without introducing a real AudioContext.
        return node as unknown as GainNode;
    }
}

function gainParamFor(context: FakeAudioContext): FakeAudioParam {
    const node = context.createdGainNodes[0];
    if (node === undefined) {
        throw new Error('expected AudioBus to create a GainNode');
    }
    return node.gain;
}

function makeSettings(audio: {
    readonly masterVolume?: number;
    readonly musicVolume?: number;
    readonly sfxVolume?: number;
    readonly muted?: boolean;
}): ResolvedSettings {
    return {
        audio: {
            masterVolume: audio.masterVolume ?? 1,
            sfxVolume: audio.sfxVolume ?? 1,
            musicVolume: audio.musicVolume ?? 0.8,
            muted: audio.muted ?? false,
        },
        display: { fullscreen: false, vsync: true, targetFps: 60, uiScale: 1 },
        gameplay: {
            language: 'en-US',
            autoSave: true,
            autoSaveIntervalTurns: 5,
            showHints: true,
            showPerfHud: false,
        },
        controls: {
            bindings: {
                'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
                'engine:redo': { primary: 'KeyZ', modifiers: ['Ctrl', 'Shift'] },
                'engine:toggle-menu': { primary: 'Escape' },
            },
        },
    };
}

function createBus(id: AudioBusId = 'sfx'): {
    readonly bus: AudioBus;
    readonly context: FakeAudioContext;
    readonly gain: FakeAudioParam;
} {
    const context = new FakeAudioContext();
    // @chimera-review: FakeAudioContext implements the createGain/currentTime surface used by AudioBus; the cast avoids a real AudioContext dependency in the test environment.
    const bus = new AudioBus(id, context as unknown as AudioContext);
    return { bus, context, gain: gainParamFor(context) };
}

beforeEach(() => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

afterEach(() => {
    vi.useRealTimers();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

describe('AudioBus', () => {
    it('creates a gain node and exposes it for AudioManager graph wiring', () => {
        const { bus, context } = createBus('music');

        expect(bus.id).toBe('music');
        expect(bus.gainNode).toBe(context.createdGainNodes[0]);
    });

    it('sets clamped bus volume through Web Audio scheduling', () => {
        const { bus, gain } = createBus();

        bus.setVolume(1.5);

        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 1, time: 10 });

        bus.setVolume(-0.25);

        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 0, time: 10 });
    });

    it('mutes and unmutes without forgetting the configured volume', () => {
        const { bus, gain } = createBus();

        bus.setVolume(0.45);
        bus.mute();
        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 0, time: 10 });

        bus.unmute();
        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 0.45, time: 10 });
    });

    it('updates category volume immediately when settingsStore changes', () => {
        const { gain } = createBus('music');

        useSettingsStore.setState({
            activeGameId: 'tactics',
            settings: { tactics: makeSettings({ musicVolume: 0.35 }) },
        });

        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 0.35, time: 10 });
    });

    it('uses engine settings when no active game is selected', () => {
        const { gain } = createBus('master');

        useSettingsStore.setState({
            activeGameId: null,
            settings: { __engine__: makeSettings({ masterVolume: 0.2 }) },
        });

        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 0.2, time: 10 });
    });

    it('applies global settings mute to every bus', () => {
        const { gain } = createBus('sfx');

        useSettingsStore.setState({
            activeGameId: 'tactics',
            settings: { tactics: makeSettings({ sfxVolume: 0.75, muted: true }) },
        });

        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 0, time: 10 });
    });

    it('keeps voice at full category gain until a dedicated setting exists', () => {
        const { gain } = createBus('voice');

        useSettingsStore.setState({
            activeGameId: 'tactics',
            settings: { tactics: makeSettings({ masterVolume: 0.25, muted: false }) },
        });

        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 1, time: 10 });
    });

    it('ducks with a ramp down, hold, and scheduled restoration', () => {
        const { bus, context, gain } = createBus();

        bus.setVolume(0.8);
        gain.calls.length = 0;

        bus.duck(0.25, 500);

        expect(gain.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 0.8, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0.25, time: 10.05 },
        ]);

        context.currentTime = 10.55;
        vi.advanceTimersByTime(500);

        expect(gain.calls.slice(3)).toEqual([
            { method: 'cancelScheduledValues', time: 10.55 },
            { method: 'setValueAtTime', value: 0.25, time: 10.55 },
            { method: 'linearRampToValueAtTime', value: 0.8, time: 10.600000000000001 },
        ]);
    });

    it('cancels a pending duck restoration when ducked again', () => {
        const { bus, context, gain } = createBus();

        bus.setVolume(0.8);
        bus.duck(0.25, 500);
        gain.calls.length = 0;

        context.currentTime = 10.2;
        bus.duck(0.1, 700);
        vi.advanceTimersByTime(500);
        expect(gain.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10.2 },
            { method: 'setValueAtTime', value: 0.25, time: 10.2 },
            { method: 'linearRampToValueAtTime', value: 0.1, time: 10.25 },
        ]);

        context.currentTime = 10.9;
        vi.advanceTimersByTime(200);
        expect(gain.calls.slice(3)).toEqual([
            { method: 'cancelScheduledValues', time: 10.9 },
            { method: 'setValueAtTime', value: 0.1, time: 10.9 },
            { method: 'linearRampToValueAtTime', value: 0.8, time: 10.950000000000001 },
        ]);
    });

    it('disposes settings subscription, pending timers, and gain node', () => {
        const { bus, context, gain } = createBus('music');
        const node = context.createdGainNodes[0];
        if (node === undefined) {
            throw new Error('expected GainNode');
        }

        bus.duck(0.25, 500);
        bus.dispose();

        useSettingsStore.setState({
            activeGameId: 'tactics',
            settings: { tactics: makeSettings({ musicVolume: 0.1 }) },
        });
        vi.advanceTimersByTime(500);

        expect(gain.calls.at(-1)).toEqual({
            method: 'linearRampToValueAtTime',
            value: 0.25,
            time: 10.05,
        });
        expect(node.disconnect).toHaveBeenCalledOnce();
    });

    it('treats setVolume and mute toggles as no-ops after dispose', () => {
        const { bus, context, gain } = createBus('sfx');
        bus.setVolume(0.6);
        gain.calls.length = 0;
        bus.dispose();

        // @chimera-review: Casting to access private fields to assert post-dispose no-op guarantees; no public API exposes these values and the invariant under test requires verifying internal state did not change.
        const internals = bus as unknown as {
            volume: number;
            locallyMuted: boolean;
        };
        const volumeBefore = internals.volume;
        const mutedBefore = internals.locallyMuted;

        context.currentTime = 11;
        bus.setVolume(0.2);
        bus.mute();
        bus.unmute();

        expect(internals.volume).toBe(volumeBefore);
        expect(internals.locallyMuted).toBe(mutedBefore);
        expect(gain.calls).toEqual([]);
    });

    it('does not ramp gain above zero when duck() is called while locally muted', () => {
        const { bus, gain } = createBus();

        bus.setVolume(0.8);
        bus.mute();
        gain.calls.length = 0;

        bus.duck(0.25, 500);

        expect(gain.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 10.05 },
        ]);
    });

    it('does not ramp gain above zero when duck() is called while settings-muted', () => {
        const { bus, gain } = createBus('sfx');

        useSettingsStore.setState({
            activeGameId: 'tactics',
            settings: { tactics: makeSettings({ sfxVolume: 0.8, muted: true }) },
        });
        gain.calls.length = 0;

        bus.duck(0.25, 500);

        expect(gain.calls).toEqual([
            { method: 'cancelScheduledValues', time: 10 },
            { method: 'setValueAtTime', value: 0, time: 10 },
            { method: 'linearRampToValueAtTime', value: 0, time: 10.05 },
        ]);
    });

    it('cancels active duck automation when locally muted during ducking', () => {
        const { bus, context, gain } = createBus('sfx');

        bus.setVolume(0.8);
        bus.duck(0.25, 500);

        context.currentTime = 10.2;
        bus.mute();

        expect(gain.calls.slice(-2)).toEqual([
            { method: 'cancelScheduledValues', time: 10.2 },
            { method: 'setValueAtTime', value: 0, time: 10.2 },
        ]);
    });

    it('cancels active duck automation when settings mute becomes active', () => {
        const { bus, context, gain } = createBus('sfx');

        bus.setVolume(0.8);
        bus.duck(0.25, 500);

        context.currentTime = 10.2;
        useSettingsStore.setState({
            activeGameId: 'tactics',
            settings: { tactics: makeSettings({ sfxVolume: 0.8, muted: true }) },
        });

        expect(gain.calls.slice(-2)).toEqual([
            { method: 'cancelScheduledValues', time: 10.2 },
            { method: 'setValueAtTime', value: 0, time: 10.2 },
        ]);
    });

    it('falls back to default gain when settings become unavailable', () => {
        const { gain } = createBus('sfx');

        useSettingsStore.setState({
            activeGameId: 'tactics',
            settings: { tactics: makeSettings({ sfxVolume: 0.2, muted: true }) },
        });
        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 0, time: 10 });

        useSettingsStore.setState({
            activeGameId: null,
            settings: {},
        });

        expect(gain.calls.at(-1)).toEqual({ method: 'setValueAtTime', value: 1, time: 10 });
    });
});
