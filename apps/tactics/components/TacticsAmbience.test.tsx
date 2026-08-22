// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import {
    AudioManagerProvider,
    MUSIC_PRIORITY,
    type AudioHandle,
    type AudioManager,
    type CrossfadeOptions,
    type PlayOptions,
} from '@chimera-engine/renderer/audio';

import { tacticsAudioRefs } from '../asset-manifest.js';
import { TacticsAmbience } from './TacticsAmbience';

afterEach(cleanup);

/**
 * A local `AudioManager` double.
 *
 * Deliberately not the engine's `renderer/audio/__test-support__` spy: that lives
 * behind the barrel and Invariant #96 keeps it off-limits to game code, tests
 * included. A game adopting the audio surface has to be able to double it from the
 * public types alone, so this test is also the proof that it can.
 */
function createManagerDouble(): {
    manager: AudioManager;
    /** Model a voice reaching its end: `valid` flips exactly once, as the real one's does. */
    retire: (handle: AudioHandle) => void;
} {
    const handles: AudioHandle[] = [];
    const retired = new Set<AudioHandle>();
    const mint = (ref: AssetRef<AudioClipAsset>): AudioHandle => {
        // A getter, not a fixed field: `AudioHandle.valid` is live on the real
        // manager (`ManagedAudioHandle` reads the pool), and a double that froze it
        // `true` would make every "has this voice ended yet" branch untestable.
        const handle: AudioHandle = {
            id: `voice-${String(handles.length)}`,
            ref,
            bus: 'music',
            priority: MUSIC_PRIORITY,
            get valid(): boolean {
                return !retired.has(handle);
            },
        };
        handles.push(handle);
        return handle;
    };

    const manager: AudioManager = {
        play: vi.fn((ref: AssetRef<AudioClipAsset>, _opts?: PlayOptions) => mint(ref)),
        stop: vi.fn(),
        fadeOut: vi.fn(),
        fadeTo: vi.fn(),
        crossfade: vi.fn(
            (_outgoing: AudioHandle, incoming: AssetRef<AudioClipAsset>, _opts: CrossfadeOptions) =>
                mint(incoming),
        ),
        secondsUntilCue: vi.fn(() => null),
        stopAll: vi.fn(),
        duck: vi.fn(),
        setListener: vi.fn(),
        setVoicePosition: vi.fn(),
        dispose: vi.fn(),
    };

    return {
        manager,
        retire: (handle) => {
            retired.add(handle);
        },
    };
}

function renderAmbience(isMyTurn: boolean): {
    manager: AudioManager;
    retire: (handle: AudioHandle) => void;
    rerender: (next: boolean) => void;
} {
    const { manager, retire } = createManagerDouble();
    const view = render(
        <AudioManagerProvider audioManager={manager}>
            <TacticsAmbience isMyTurn={isMyTurn} />
        </AudioManagerProvider>,
    );
    return {
        manager,
        retire,
        rerender: (next: boolean) => {
            view.rerender(
                <AudioManagerProvider audioManager={manager}>
                    <TacticsAmbience isMyTurn={next} />
                </AudioManagerProvider>,
            );
        },
    };
}

describe('TacticsAmbience — the cue-sheet + crossfade reference adoption', () => {
    it('starts the calm bed on the music bus at the shared loop cues', () => {
        const { manager } = renderAmbience(true);

        expect(manager.play).toHaveBeenCalledTimes(1);
        const [ref, opts] = vi.mocked(manager.play).mock.calls[0] as [
            AssetRef<AudioClipAsset>,
            PlayOptions,
        ];
        expect(ref).toBe(tacticsAudioRefs.ambienceCalm);
        expect(opts.bus).toBe('music');
        // A bed reclaimed by an SFX burst is the failure MUSIC_PRIORITY exists to
        // prevent (Invariant #123); it is never applied implicitly by bus or loop flag.
        expect(opts.priority).toBe(MUSIC_PRIORITY);
        // Cues by NAME, resolved against the clip's own sheet — the seconds live in
        // the manifest and the screen layer never restates them (Invariant #124).
        expect(opts.loopRegion).toEqual({
            start: { name: 'loopStart' },
            end: { name: 'loopEnd' },
        });
        // The tuning values, pinned rather than bounded. `volume` is the one the
        // component's own comment justifies against the SFX bus (0.4–0.65), and a
        // `> 0` bound would accept a bed at 1.0 that buries every effect under it;
        // the two ramp lengths are audible durations, not mere positives.
        expect(opts.volume).toBe(0.3);
        expect(opts.fadeIn?.durationMs).toBe(600);
    });

    it('opens on the tense bed when the match starts on the opponent turn', () => {
        const { manager } = renderAmbience(false);

        expect(manager.play).toHaveBeenCalledTimes(1);
        const [ref] = vi.mocked(manager.play).mock.calls[0] as [AssetRef<AudioClipAsset>];
        expect(ref).toBe(tacticsAudioRefs.ambienceTense);
    });

    it('crossfades to the tense bed when the turn passes to the opponent', () => {
        const { manager, rerender } = renderAmbience(true);
        const started = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        rerender(false);

        expect(manager.crossfade).toHaveBeenCalledTimes(1);
        const [outgoing, incoming, opts] = vi.mocked(manager.crossfade).mock.calls[0] as [
            AudioHandle,
            AssetRef<AudioClipAsset>,
            CrossfadeOptions,
        ];
        // The outgoing handle must be the voice actually playing, not a fresh one:
        // crossfading the wrong handle leaves the real bed running underneath.
        expect(outgoing).toBe(started);
        expect(incoming).toBe(tacticsAudioRefs.ambienceTense);
        expect(opts.durationMs).toBe(900);
        expect(opts.bus).toBe('music');
        expect(opts.volume).toBe(0.3);
        expect(opts.priority).toBe(MUSIC_PRIORITY);
        expect(opts.loopRegion).toEqual({
            start: { name: 'loopStart' },
            end: { name: 'loopEnd' },
        });
        // A second play() would stack a bed on top of the crossfade rather than
        // replacing it.
        expect(manager.play).toHaveBeenCalledTimes(1);
    });

    it('crossfades from the handle the PREVIOUS crossfade returned, not the first one', () => {
        const { manager, rerender } = renderAmbience(true);
        const first = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        rerender(false);
        const second = vi.mocked(manager.crossfade).mock.results[0]?.value as AudioHandle;
        rerender(true);

        expect(manager.crossfade).toHaveBeenCalledTimes(2);
        const [outgoing, incoming] = vi.mocked(manager.crossfade).mock.calls[1] as [
            AudioHandle,
            AssetRef<AudioClipAsset>,
            CrossfadeOptions,
        ];
        // Tracking the live handle across swaps is the whole state this component
        // keeps; holding the original would fade a voice that has already been
        // replaced and leave the second bed playing forever.
        expect(outgoing).toBe(second);
        expect(outgoing).not.toBe(first);
        expect(incoming).toBe(tacticsAudioRefs.ambienceCalm);
    });

    it('does not crossfade when a rerender leaves the turn unchanged', () => {
        const { manager, rerender } = renderAmbience(true);

        rerender(true);
        rerender(true);

        expect(manager.crossfade).not.toHaveBeenCalled();
        expect(manager.play).toHaveBeenCalledTimes(1);
    });

    it('reflects the active bed for the audio-smoke e2e', () => {
        const { rerender } = renderAmbience(true);

        expect(screen.getByTestId('tactics-ambience')).toHaveAttribute('data-track', 'calm');
        rerender(false);
        expect(screen.getByTestId('tactics-ambience')).toHaveAttribute('data-track', 'tense');
    });

    it('does not crossfade on the first mount', () => {
        const { manager } = renderAmbience(true);

        expect(manager.crossfade).not.toHaveBeenCalled();
        expect(manager.play).toHaveBeenCalledTimes(1);
    });

    it('retires ended voices from the teardown set instead of accumulating them', () => {
        const { manager, retire, rerender } = renderAmbience(true);
        const first = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        // Swap, let the first voice's linked fade run to completion, swap again.
        rerender(false);
        const second = vi.mocked(manager.crossfade).mock.results[0]?.value as AudioHandle;
        retire(first);
        rerender(true);
        const third = vi.mocked(manager.crossfade).mock.results[1]?.value as AudioHandle;
        retire(second);
        rerender(false);
        const fourth = vi.mocked(manager.crossfade).mock.results[2]?.value as AudioHandle;
        cleanup();

        // Only the voices that could still be sounding are stopped. Without the prune
        // the set would carry every handle the match ever produced — a leak that grows
        // with the turn count, and the bound the component's JSDoc claims.
        const stopped = vi.mocked(manager.stop).mock.calls.map(([handle]) => handle);
        expect(new Set(stopped)).toEqual(new Set([third, fourth]));
    });

    it('stops the OUTGOING voice too when unmounted mid-crossfade', () => {
        const { manager, rerender } = renderAmbience(true);
        const outgoing = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        rerender(false);
        const incoming = vi.mocked(manager.crossfade).mock.results[0]?.value as AudioHandle;
        cleanup();

        // A crossfade hands back the INCOMING handle, and the outgoing voice is
        // thereafter reachable only through the incoming record's linked fade-out.
        // Stopping just the live handle is therefore not enough: a stop landing while
        // the incoming voice is still loading releases it before that linkage is ever
        // applied, and the outgoing loop then plays on with nothing left holding it.
        const stopped = vi.mocked(manager.stop).mock.calls.map(([handle]) => handle);
        expect(stopped).toContain(incoming);
        expect(stopped).toContain(outgoing);
    });

    it('stops its bed on unmount so a leaving match leaves no voice behind', () => {
        const { manager } = createManagerDouble();
        const view = render(
            <AudioManagerProvider audioManager={manager}>
                <TacticsAmbience isMyTurn />
            </AudioManagerProvider>,
        );
        const started = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        view.unmount();

        expect(manager.stop).toHaveBeenCalledWith(started);
    });
});
