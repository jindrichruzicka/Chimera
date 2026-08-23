// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import {
    AudioManagerProvider,
    MUSIC_PRIORITY,
    type AudioHandle,
    type AudioManager,
    type CueAlignedCrossfadeOptions,
    type CueHandlers,
    type PlayOptions,
} from '@chimera-engine/renderer/audio';

import { tacticsAudioRefs } from '../asset-manifest.js';
import { TacticsAmbience } from './TacticsAmbience';

afterEach(cleanup);

/** One live `observeCues` subscription, as the manager would hold it. */
interface ObservedVoice {
    readonly handle: AudioHandle;
    readonly handlers: CueHandlers;
}

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
    /** Which voices are being observed right now, in subscription order. */
    observedVoices: () => readonly AudioHandle[];
    /** Drive the sampler: deliver one crossed cue to every live observer. */
    reachCue: (name: string) => void;
    /** Drive the other settle path: every observed voice ends without reaching a cue. */
    endObservedVoices: () => void;
} {
    const handles: AudioHandle[] = [];
    const retired = new Set<AudioHandle>();
    const observations = new Set<ObservedVoice>();
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
        crossfade: vi.fn((_outgoing: AudioHandle, incoming: AssetRef<AudioClipAsset>) =>
            mint(incoming),
        ),
        crossfadeAtCue: vi.fn(
            (
                _outgoing: AudioHandle,
                incoming: AssetRef<AudioClipAsset>,
                _opts: CueAlignedCrossfadeOptions,
            ) => mint(incoming),
        ),
        fadeOutAtCue: vi.fn(),
        secondsUntilCue: vi.fn(() => null),
        // Records the subscription rather than discarding it: the swap this component
        // arms is executed by the engine, so the only thing that tells the component it
        // has HAPPENED is an emission on this seam.
        observeCues: vi.fn((handle: AudioHandle, handlers: CueHandlers) => {
            const observation: ObservedVoice = { handle, handlers };
            observations.add(observation);
            return () => {
                observations.delete(observation);
            };
        }),
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
        observedVoices: () => Array.from(observations, (observation) => observation.handle),
        reachCue: (name) => {
            // A snapshot: settling a swap unsubscribes this observer and observes the
            // incoming voice, and the frame that began owns the set it started with.
            const batch = Array.from(observations);
            act(() => {
                for (const observation of batch) {
                    observation.handlers.onCue?.({ kind: 'cue', name });
                }
            });
        },
        endObservedVoices: () => {
            const batch = Array.from(observations);
            act(() => {
                for (const observation of batch) {
                    observations.delete(observation);
                    observation.handlers.onEnd?.({ kind: 'end' });
                }
            });
        },
    };
}

type ManagerDouble = ReturnType<typeof createManagerDouble>;

function renderAmbience(isMyTurn: boolean): ManagerDouble & {
    rerender: (next: boolean) => void;
} {
    const double = createManagerDouble();
    const view = render(
        <AudioManagerProvider audioManager={double.manager}>
            <TacticsAmbience isMyTurn={isMyTurn} />
        </AudioManagerProvider>,
    );
    return {
        ...double,
        rerender: (next: boolean) => {
            view.rerender(
                <AudioManagerProvider audioManager={double.manager}>
                    <TacticsAmbience isMyTurn={next} />
                </AudioManagerProvider>,
            );
        },
    };
}

/** Both ambience markers, read in one go. */
function markers(): { readonly track: string | null; readonly playing: string | null } {
    const marker = screen.getByTestId('tactics-ambience');
    return {
        track: marker.getAttribute('data-track'),
        playing: marker.getAttribute('data-playing-track'),
    };
}

describe('TacticsAmbience — the cue-sheet + cue-aligned swap reference adoption', () => {
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

    it('arms the swap at the loop cue when the turn passes, and never cuts across the phrase', () => {
        const { manager, rerender } = renderAmbience(true);
        const started = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        rerender(false);

        expect(manager.crossfadeAtCue).toHaveBeenCalledTimes(1);
        const [outgoing, incoming, opts] = vi.mocked(manager.crossfadeAtCue).mock.calls[0] as [
            AudioHandle,
            AssetRef<AudioClipAsset>,
            CueAlignedCrossfadeOptions,
        ];
        // The outgoing handle must be the voice actually playing, not a fresh one:
        // arming against the wrong handle leaves the real bed running underneath.
        expect(outgoing).toBe(started);
        expect(incoming).toBe(tacticsAudioRefs.ambienceTense);
        // The cue the swap lands on is the one that already bounds the loop, by NAME —
        // the same `loopEnd` the play options above name, so the manifest stays the
        // single source for the offset and no second copy can drift from it.
        expect(opts.atCue).toEqual({ name: 'loopEnd' });
        expect(opts.durationMs).toBe(900);
        expect(opts.bus).toBe('music');
        expect(opts.volume).toBe(0.3);
        expect(opts.priority).toBe(MUSIC_PRIORITY);
        expect(opts.loopRegion).toEqual({
            start: { name: 'loopStart' },
            end: { name: 'loopEnd' },
        });
        // The instant verb is what this task replaces: it cuts across whatever the bed
        // was playing, which is the defect the arming verb exists to remove.
        expect(manager.crossfade).not.toHaveBeenCalled();
        // A second play() would stack a bed on top of the swap rather than replacing it.
        expect(manager.play).toHaveBeenCalledTimes(1);
    });

    it('leaves the sounding bed unchanged at the turn boundary, and moves it at the cue', () => {
        // The whole point of the task, at unit level: the turn passing ARMS the swap,
        // and the bed carries on until the phrase ends. `data-track` follows the turn
        // because that is the signal; `data-playing-track` follows the handover.
        const { reachCue, rerender } = renderAmbience(true);
        expect(markers()).toEqual({ track: 'calm', playing: 'calm' });

        rerender(false);

        expect(markers()).toEqual({ track: 'tense', playing: 'calm' });

        reachCue('loopEnd');

        expect(markers()).toEqual({ track: 'tense', playing: 'tense' });
    });

    it('ignores a cue the swap was not armed at', () => {
        // The beds declare `intro` and `outro` alongside the loop bounds, and a looping
        // voice crosses them on every pass. A handler that settled on ANY cue would hand
        // over at whichever one came first, which is not the instant the engine scheduled.
        const { reachCue, rerender } = renderAmbience(true);
        rerender(false);

        reachCue('intro');

        expect(markers()).toEqual({ track: 'tense', playing: 'calm' });
    });

    it('settles nothing when a cue arrives with no swap armed', () => {
        // `loopEnd` comes round on every pass of the loop, armed or not. Settling on one
        // with nothing pending would move the marker off the bed that is playing.
        const { manager, reachCue } = renderAmbience(true);

        reachCue('loopEnd');
        reachCue('loopEnd');

        expect(markers()).toEqual({ track: 'calm', playing: 'calm' });
        expect(manager.crossfadeAtCue).not.toHaveBeenCalled();
    });

    it('follows the swap onto the incoming voice, so the next cue is that voice’s', () => {
        // The observation has to move with the bed. Left on the outgoing voice it would
        // go silent with it, and the second swap would never settle.
        const { manager, observedVoices, reachCue, rerender } = renderAmbience(true);
        const started = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;
        expect(observedVoices()).toEqual([started]);

        rerender(false);
        const incoming = vi.mocked(manager.crossfadeAtCue).mock.results[0]?.value as AudioHandle;
        reachCue('loopEnd');

        expect(observedVoices()).toEqual([incoming]);
    });

    it('arms the next swap from the handle the previous one settled to', () => {
        const { manager, reachCue, rerender } = renderAmbience(true);
        const first = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        rerender(false);
        const second = vi.mocked(manager.crossfadeAtCue).mock.results[0]?.value as AudioHandle;
        reachCue('loopEnd');
        rerender(true);

        expect(manager.crossfadeAtCue).toHaveBeenCalledTimes(2);
        const [outgoing, incoming] = vi.mocked(manager.crossfadeAtCue).mock.calls[1] as [
            AudioHandle,
            AssetRef<AudioClipAsset>,
            CueAlignedCrossfadeOptions,
        ];
        // Tracking the live handle across swaps is the whole state this component
        // keeps; holding the original would fade a voice that has already been
        // replaced and leave the second bed playing forever.
        expect(outgoing).toBe(second);
        expect(outgoing).not.toBe(first);
        expect(incoming).toBe(tacticsAudioRefs.ambienceCalm);
    });

    it('stacks no second swap while one is armed, and honours the latest turn after it lands', () => {
        // The documented rule for turns that change faster than a phrase: an armed swap
        // is neither re-targeted nor cancelled — it is already a native schedule — so a
        // second arm is refused and the turn it wanted is served by the NEXT swap.
        const { manager, reachCue, rerender } = renderAmbience(true);

        rerender(false); // arms calm → tense
        rerender(true); // back to the bed that is playing: nothing to arm
        rerender(false); // wants tense again while the first swap is still pending

        expect(manager.crossfadeAtCue).toHaveBeenCalledTimes(1);
        expect(markers()).toEqual({ track: 'tense', playing: 'calm' });

        reachCue('loopEnd');

        // The pending swap landed on the bed the latest turn wanted, so nothing more is
        // armed — one bed playing, one swap made.
        expect(markers()).toEqual({ track: 'tense', playing: 'tense' });
        expect(manager.crossfadeAtCue).toHaveBeenCalledTimes(1);
    });

    it('serves a turn that flipped back only once the armed swap has landed', () => {
        // The other half of that rule, and the one that shows the arm is not cancelled:
        // the bed still hands over to tense at the cue, and only then turns back.
        const { manager, reachCue, rerender } = renderAmbience(true);

        rerender(false); // arms calm → tense
        rerender(true); // the turn came back before the phrase ended
        reachCue('loopEnd');

        expect(markers()).toEqual({ track: 'calm', playing: 'tense' });
        expect(manager.crossfadeAtCue).toHaveBeenCalledTimes(2);
        const [, incoming] = vi.mocked(manager.crossfadeAtCue).mock.calls[1] as [
            AudioHandle,
            AssetRef<AudioClipAsset>,
            CueAlignedCrossfadeOptions,
        ];
        expect(incoming).toBe(tacticsAudioRefs.ambienceCalm);
    });

    it('settles the swap when the outgoing voice ends without reaching the cue', () => {
        // Cue resolution is fail-soft (Invariant #118): an unreachable `atCue` makes the
        // engine swap at once and stop the outgoing voice, so the cue this component is
        // waiting for never comes. `end` is the emission that path does produce, and
        // without it the marker would name a bed that is no longer sounding for the rest
        // of the match.
        const { endObservedVoices, rerender } = renderAmbience(true);
        rerender(false);

        endObservedVoices();

        expect(markers()).toEqual({ track: 'tense', playing: 'tense' });
    });

    it('does not arm a swap when a rerender leaves the turn unchanged', () => {
        const { manager, rerender } = renderAmbience(true);

        rerender(true);
        rerender(true);

        expect(manager.crossfadeAtCue).not.toHaveBeenCalled();
        expect(manager.play).toHaveBeenCalledTimes(1);
    });

    it('does not arm a swap on the first mount', () => {
        const { manager } = renderAmbience(true);

        expect(manager.crossfadeAtCue).not.toHaveBeenCalled();
        expect(manager.play).toHaveBeenCalledTimes(1);
    });

    it('retires ended voices from the teardown set instead of accumulating them', () => {
        const { manager, reachCue, retire, rerender } = renderAmbience(true);
        const first = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        // Swap, let it land, let the first voice's linked fade run out, swap again.
        rerender(false);
        const second = vi.mocked(manager.crossfadeAtCue).mock.results[0]?.value as AudioHandle;
        reachCue('loopEnd');
        retire(first);
        rerender(true);
        const third = vi.mocked(manager.crossfadeAtCue).mock.results[1]?.value as AudioHandle;
        reachCue('loopEnd');
        retire(second);
        rerender(false);
        const fourth = vi.mocked(manager.crossfadeAtCue).mock.results[2]?.value as AudioHandle;
        cleanup();

        // Only the voices that could still be sounding are stopped. Without the prune
        // the set would carry every handle the match ever produced — a leak that grows
        // with the turn count, and the bound the component's JSDoc claims.
        const stopped = vi.mocked(manager.stop).mock.calls.map(([handle]) => handle);
        expect(new Set(stopped)).toEqual(new Set([third, fourth]));
    });

    it('stops the voice that had not started yet when unmounted between arming and firing', () => {
        const { manager, rerender } = renderAmbience(true);
        const outgoing = vi.mocked(manager.play).mock.results[0]?.value as AudioHandle;

        rerender(false);
        const pending = vi.mocked(manager.crossfadeAtCue).mock.results[0]?.value as AudioHandle;
        cleanup();

        // The arming window is the case the instant verb never had. The incoming voice
        // exists and is scheduled but has not sounded, and the component holds the only
        // name for it: dropped here, it starts at the cue into a screen that is gone.
        // The outgoing one needs stopping for the reason it always did — a swap hands
        // back only the incoming handle, so the outgoing voice is reachable thereafter
        // solely through that record's linked fade-out.
        const stopped = vi.mocked(manager.stop).mock.calls.map(([handle]) => handle);
        expect(stopped).toContain(pending);
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

    it('drops a swap armed against a manager the provider has replaced', () => {
        // The mount effect is keyed on the manager, so a provider swap tears it down and
        // starts a fresh bed on the new one. A pending swap left behind would name a
        // voice from the manager nobody holds any more: it would refuse every future arm
        // — the guard only clears at a settle — and then settle the live handle onto that
        // dead voice at the next cue. RTL's renderHook-style wrapper takes no props, so
        // the provided manager is swapped through a local the wrapper re-reads.
        const first = createManagerDouble();
        const second = createManagerDouble();
        let provided = first.manager;
        const view = render(
            <AudioManagerProvider audioManager={provided}>
                <TacticsAmbience isMyTurn />
            </AudioManagerProvider>,
        );
        // Arm a swap against the FIRST manager, then replace it before any cue lands.
        view.rerender(
            <AudioManagerProvider audioManager={provided}>
                <TacticsAmbience isMyTurn={false} />
            </AudioManagerProvider>,
        );
        expect(first.manager.crossfadeAtCue).toHaveBeenCalledTimes(1);

        provided = second.manager;
        view.rerender(
            <AudioManagerProvider audioManager={provided}>
                <TacticsAmbience isMyTurn={false} />
            </AudioManagerProvider>,
        );

        // The new manager starts its own bed, and the turn still calls for the other
        // one — so the arm must be free to happen again. Held pending, it would not.
        expect(second.manager.play).toHaveBeenCalledTimes(1);
        expect(second.manager.crossfadeAtCue).toHaveBeenCalledTimes(1);
        const [outgoing] = vi.mocked(second.manager.crossfadeAtCue).mock.calls[0] as [
            AudioHandle,
            AssetRef<AudioClipAsset>,
            CueAlignedCrossfadeOptions,
        ];
        expect(outgoing).toBe(vi.mocked(second.manager.play).mock.results[0]?.value);
    });

    it('observes no handle the manager the context now supplies did not mint', () => {
        // `DefaultAudioManager.createHandleId` mints `audio-N` from a PER-MANAGER
        // counter, so a handle from another manager is not the harmless miss a stale
        // handle usually is: the id can name a live voice on this one. The observation
        // is keyed on `bed`, which is `liveBed` only while the pair still agrees with
        // the manager in context — handing it `liveBed.handle` instead would observe
        // the old manager's voice on the new one for the commit before the mount effect
        // re-seats the bed. Asserted over EVERY call rather than the live set, because
        // that subscription lasts one commit and a poll after the fact cannot see it.
        const first = createManagerDouble();
        const second = createManagerDouble();
        const view = render(
            <AudioManagerProvider audioManager={first.manager}>
                <TacticsAmbience isMyTurn />
            </AudioManagerProvider>,
        );
        const startedOnFirst = vi.mocked(first.manager.play).mock.results[0]?.value as AudioHandle;

        view.rerender(
            <AudioManagerProvider audioManager={second.manager}>
                <TacticsAmbience isMyTurn />
            </AudioManagerProvider>,
        );

        const observedOnSecond = vi
            .mocked(second.manager.observeCues)
            .mock.calls.map(([handle]) => handle);
        const startedOnSecond = vi.mocked(second.manager.play).mock.results[0]
            ?.value as AudioHandle;
        // `toBe`, not a structural match: the two doubles each mint a `voice-0` carrying
        // the same ref, bus and priority, so only object identity separates them.
        expect(observedOnSecond).toHaveLength(1);
        expect(observedOnSecond[0]).toBe(startedOnSecond);
        expect(observedOnSecond).not.toContain(startedOnFirst);
    });

    it('restarts on the opening bed after a manager swap, and says so on the marker', () => {
        // The mount effect restarts from `openingTrackRef` — the bed the match OPENED
        // on — while `playingTrack` still holds whatever the last settle left. Left
        // unreconciled the new manager plays the calm bed while both markers read tense,
        // and nothing moves it back.
        const first = createManagerDouble();
        const second = createManagerDouble();
        const view = render(
            <AudioManagerProvider audioManager={first.manager}>
                <TacticsAmbience isMyTurn />
            </AudioManagerProvider>,
        );
        view.rerender(
            <AudioManagerProvider audioManager={first.manager}>
                <TacticsAmbience isMyTurn={false} />
            </AudioManagerProvider>,
        );
        first.reachCue('loopEnd');
        expect(markers()).toEqual({ track: 'tense', playing: 'tense' });

        view.rerender(
            <AudioManagerProvider audioManager={second.manager}>
                <TacticsAmbience isMyTurn={false} />
            </AudioManagerProvider>,
        );

        const [restarted] = vi.mocked(second.manager.play).mock.calls[0] as [
            AssetRef<AudioClipAsset>,
        ];
        expect(restarted).toBe(tacticsAudioRefs.ambienceCalm);
        // The marker moved with the restart, so the two agree again.
        expect(markers()).toEqual({ track: 'tense', playing: 'calm' });
    });

    it('arms the turn’s bed again on the manager that replaced the one it opened on', () => {
        // The consequence of the reconciliation above, and the half a marker assertion
        // alone would miss: with the marker still reading tense the arm comparison finds
        // nothing to do, so the new manager plays the calm bed for the rest of the match
        // and nothing arms again until the turn changes.
        const first = createManagerDouble();
        const second = createManagerDouble();
        const view = render(
            <AudioManagerProvider audioManager={first.manager}>
                <TacticsAmbience isMyTurn />
            </AudioManagerProvider>,
        );
        view.rerender(
            <AudioManagerProvider audioManager={first.manager}>
                <TacticsAmbience isMyTurn={false} />
            </AudioManagerProvider>,
        );
        first.reachCue('loopEnd');

        view.rerender(
            <AudioManagerProvider audioManager={second.manager}>
                <TacticsAmbience isMyTurn={false} />
            </AudioManagerProvider>,
        );

        expect(second.manager.crossfadeAtCue).toHaveBeenCalledTimes(1);
        const [outgoing, incoming] = vi.mocked(second.manager.crossfadeAtCue).mock.calls[0] as [
            AudioHandle,
            AssetRef<AudioClipAsset>,
            CueAlignedCrossfadeOptions,
        ];
        expect(outgoing).toBe(vi.mocked(second.manager.play).mock.results[0]?.value);
        expect(incoming).toBe(tacticsAudioRefs.ambienceTense);
    });

    it('leaves no cue observation standing once it unmounts', () => {
        // The subscription outliving the component would keep the sampler's frame chain
        // alive for a voice nobody is listening to, and hand events to a settler whose
        // state is gone.
        const { observedVoices, rerender } = renderAmbience(true);
        rerender(false);
        expect(observedVoices()).toHaveLength(1);

        cleanup();

        expect(observedVoices()).toEqual([]);
    });
});
