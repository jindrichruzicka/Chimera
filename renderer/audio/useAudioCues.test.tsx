// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AudioHandle, AudioManager } from './AudioManager';
import { AudioManagerContext } from './AudioManagerContext.js';
import type { CueHandlers } from './cueMarkerScheduler.js';
import { createAudioManagerSpy } from './__test-support__/AudioManagerStubs.js';
import { useAudioCues } from './useAudioCues.js';

const BED_REF = 'tactics/audio/music/bed.ogg' as AssetRef<AudioClipAsset>;

const BED: AudioHandle = {
    id: 'audio-1',
    ref: BED_REF,
    bus: 'music',
    priority: 100,
    valid: true,
};

const OTHER_BED: AudioHandle = {
    id: 'audio-2',
    ref: BED_REF,
    bus: 'music',
    priority: 100,
    valid: true,
};

/** One recorded `observeCues` call, and whether its unsubscribe has been run. */
interface RecordedObservation {
    readonly handle: AudioHandle;
    /** The record the hook handed the manager — the seam every emission below drives. */
    readonly handlers: CueHandlers;
    unsubscribes: number;
}

/**
 * A manager spy whose `observeCues` records what it was handed and hands back a
 * counting unsubscribe.
 *
 * The stock spy returns a fresh `() => undefined` per call, which no assertion can tell
 * from one that was never run — and "unsubscribes on unmount" is exactly that claim. It
 * also keeps the handler RECORD, so a test can emit through the same object the sampler
 * would, rather than through a second path built for testing.
 */
function createObservingManager(): {
    readonly audioManager: AudioManager;
    readonly observations: readonly RecordedObservation[];
} {
    const audioManager = createAudioManagerSpy();
    const observations: RecordedObservation[] = [];

    vi.mocked(audioManager.observeCues).mockImplementation((handle, handlers) => {
        const observation: RecordedObservation = { handle, handlers, unsubscribes: 0 };
        observations.push(observation);
        return () => {
            observation.unsubscribes += 1;
        };
    });

    return { audioManager, observations };
}

/** The observations no unsubscribe has closed. */
function live(observations: readonly RecordedObservation[]): readonly RecordedObservation[] {
    return observations.filter((observation) => observation.unsubscribes === 0);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useAudioCues', () => {
    it('observes the handle through the context manager on mount', () => {
        const { audioManager, observations } = createObservingManager();

        renderHook(() => useAudioCues(BED, {}), { wrapper: createWrapper(audioManager) });

        expect(audioManager.observeCues).toHaveBeenCalledOnce();
        expect(observations).toHaveLength(1);
        expect(observations[0]?.handle).toBe(BED);
        // `toBe`, not `toEqual`: the claim is that the receiver IS the manager. A record
        // built from a bare reference — `observeCues: audioManager.observeCues` — would
        // call the class method with the wrong receiver against the real manager, which
        // reads `this.voices`. Two distinct spies are deep-equal.
        expect(vi.mocked(audioManager.observeCues).mock.contexts[0]).toBe(audioManager);
    });

    it('routes each event kind to its own handler', () => {
        // The mutant: one forwarder wired to every kind. Emitting only a `cue` would not
        // see it, so all three kinds are driven and each handler's own batch asserted.
        const { audioManager, observations } = createObservingManager();
        const onCue = vi.fn();
        const onLoop = vi.fn();
        const onEnd = vi.fn();

        renderHook(() => useAudioCues(BED, { onCue, onLoop, onEnd }), {
            wrapper: createWrapper(audioManager),
        });
        const handlers = observations[0]?.handlers;
        handlers?.onCue?.({ kind: 'cue', name: 'loopEnd' });
        handlers?.onLoop?.({ kind: 'loop' });
        handlers?.onEnd?.({ kind: 'end' });

        expect(onCue.mock.calls).toEqual([[{ kind: 'cue', name: 'loopEnd' }]]);
        expect(onLoop.mock.calls).toEqual([[{ kind: 'loop' }]]);
        expect(onEnd.mock.calls).toEqual([[{ kind: 'end' }]]);
    });

    it('unsubscribes on unmount', () => {
        const { audioManager, observations } = createObservingManager();
        const { unmount } = renderHook(() => useAudioCues(BED, {}), {
            wrapper: createWrapper(audioManager),
        });
        expect(live(observations)).toHaveLength(1);

        unmount();

        expect(observations[0]?.unsubscribes).toBe(1);
        expect(live(observations)).toHaveLength(0);
    });

    it('re-subscribes when the handle changes, closing the one it leaves', () => {
        const { audioManager, observations } = createObservingManager();
        let observed: AudioHandle | null = BED;
        const { rerender } = renderHook(() => useAudioCues(observed, {}), {
            wrapper: createWrapper(audioManager),
        });

        observed = OTHER_BED;
        rerender();

        expect(observations.map((observation) => observation.handle)).toEqual([BED, OTHER_BED]);
        expect(observations[0]?.unsubscribes).toBe(1);
        expect(live(observations)).toHaveLength(1);
        expect(live(observations)[0]?.handle).toBe(OTHER_BED);
    });

    it('does not resubscribe when only the handlers change, and the new ones get the next event', () => {
        // A game passes an inline record, so the handlers change identity on every render
        // of its parent. Keying the effect on them would tear the chain down and re-seat
        // the scheduler each time — losing every cue between the two samples.
        const { audioManager, observations } = createObservingManager();
        const first = vi.fn();
        const second = vi.fn();
        let onCue = first;
        const { rerender } = renderHook(() => useAudioCues(BED, { onCue }), {
            wrapper: createWrapper(audioManager),
        });

        onCue = second;
        rerender();
        observations[0]?.handlers.onCue?.({ kind: 'cue', name: 'loopEnd' });

        expect(audioManager.observeCues).toHaveBeenCalledOnce();
        expect(observations[0]?.unsubscribes).toBe(0);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledExactlyOnceWith({ kind: 'cue', name: 'loopEnd' });
    });

    it('delivers to a handler the first record did not carry', () => {
        // The forwarding record must declare all three members whatever the caller's
        // record held at subscribe time: a record that mirrored only the members present
        // then would need a resubscribe to ever reach a handler added later, and the
        // resubscribe is exactly what the case above forbids.
        const { audioManager, observations } = createObservingManager();
        const onLoop = vi.fn();
        let handlers: CueHandlers = {};
        const { rerender } = renderHook(() => useAudioCues(BED, handlers), {
            wrapper: createWrapper(audioManager),
        });

        handlers = { onLoop };
        rerender();
        observations[0]?.handlers.onLoop?.({ kind: 'loop' });

        expect(audioManager.observeCues).toHaveBeenCalledOnce();
        expect(onLoop).toHaveBeenCalledExactlyOnceWith({ kind: 'loop' });
    });

    it('subscribes nothing and warns nothing for a null handle', () => {
        // A component whose bed has not started yet holds `null`, and must not be forced
        // into a conditional hook. Nothing has gone wrong, so nothing is reported.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { audioManager } = createObservingManager();

        const { unmount } = renderHook(() => useAudioCues(null, { onCue: vi.fn() }), {
            wrapper: createWrapper(audioManager),
        });
        unmount();

        expect(audioManager.observeCues).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('subscribes once the handle arrives, having held none while it was null', () => {
        // The positive control for the case above: an effect that early-returned and then
        // never ran again would leave a game that starts its bed a frame later observing
        // nothing for the rest of the session.
        const { audioManager, observations } = createObservingManager();
        let observed: AudioHandle | null = null;
        const { rerender } = renderHook(() => useAudioCues(observed, {}), {
            wrapper: createWrapper(audioManager),
        });
        expect(observations).toHaveLength(0);

        observed = BED;
        rerender();

        expect(live(observations).map((observation) => observation.handle)).toEqual([BED]);
    });

    it('leaves exactly one live subscription through a StrictMode double-mount', () => {
        // React runs every cleanup before every setup, so the pair must be symmetric:
        // an effect that subscribed without returning its unsubscribe leaves two live
        // chains and every cue arrives twice, and one that unsubscribed a captured
        // variable rather than the call's own return leaves none.
        const { audioManager, observations } = createObservingManager();

        renderHook(() => useAudioCues(BED, {}), {
            reactStrictMode: true,
            wrapper: createWrapper(audioManager),
        });

        // Two subscriptions were made — the floor that proves the remount happened at
        // all, without which "exactly one live" passes on an effect that never ran.
        expect(observations).toHaveLength(2);
        expect(live(observations)).toHaveLength(1);
        expect(live(observations)[0]).toBe(observations[1]);
    });

    it('throws outside the provider, having no other source for a manager', () => {
        // Invariant #84: the hook reaches the manager through useAudioManager() alone.
        // A body that imported or constructed one would render here instead of throwing.
        expect(() => renderHook(() => useAudioCues(BED, {}))).toThrow(
            'useAudioManager() must be used within the app root (inside <Providers>).',
        );
    });

    it('re-subscribes through the manager the provider replaced it with', () => {
        // An effect keyed on the handle alone stays bound to the FIRST manager for the
        // component's whole life. RTL's renderHook does not pass props to the wrapper, so
        // the provided manager is swapped through a local the wrapper re-reads.
        const first = createObservingManager();
        const second = createObservingManager();
        let providedManager = first.audioManager;
        const { rerender } = renderHook(() => useAudioCues(BED, {}), {
            wrapper: ({ children }): React.ReactElement => (
                <AudioManagerContext.Provider value={providedManager}>
                    {children}
                </AudioManagerContext.Provider>
            ),
        });

        providedManager = second.audioManager;
        rerender();

        expect(first.observations[0]?.unsubscribes).toBe(1);
        expect(live(second.observations).map((observation) => observation.handle)).toEqual([BED]);
    });
});

function createWrapper(audioManager: AudioManager): React.ComponentType<{
    readonly children: React.ReactNode;
}> {
    return function AudioManagerWrapper({ children }): React.ReactElement {
        return (
            <AudioManagerContext.Provider value={audioManager}>
                {children}
            </AudioManagerContext.Provider>
        );
    };
}
