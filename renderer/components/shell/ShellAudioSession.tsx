'use client';

import React from 'react';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import type { WellKnownAudioCueName } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import { createAssetManager } from '../../assets/AssetManager';
import { createRendererGameAssetResolver } from '../../assets/AssetResolver';
import { startCriticalAssetPreload } from '../../assets/criticalAssetPreload.js';
import {
    useReleaseGameAssetManager,
    useSetGameAssetManager,
} from '../../assets/SetGameAssetManagerContext';
import { MUSIC_PRIORITY, type AudioHandle, type AudioManager } from '../../audio/AudioManager';
import { useAudioManager } from '../../audio/AudioManagerContext.js';
import { parseAudioCueSheet } from '../../audio/audioCueSheet';
import type { GameShellMusicBed } from '../../game/rendererGameRegistry';
import { useShellAudioPayload } from '../../shell/useShellAudioPayload';
import { getShellState, useShellState } from '../../shell/shellStateStore';

/**
 * Where a cue-aligned menu→match handoff BEGINS: the conventional start of a
 * clip's tail (`WellKnownAudioCueName`). A game that wants the bed to leave on a
 * musical boundary marks that instant in the clip's sheet; one that marks nothing
 * gets the screen-fade boundary instead.
 *
 * A convention rather than a declared field because the cue is a fact about the
 * CLIP, and the clip already carries a place to say it. A second declaration on
 * the bed would be a second thing to keep in step with the sheet.
 */
const HANDOFF_CUE = 'outro' satisfies WellKnownAudioCueName;

/**
 * The shell-scoped audio session (§4.25).
 *
 * `useSound` and `useMusicTrack` resolve their clips through the APP-LEVEL
 * `AudioManager` (Invariant #64), which loads through the app-level
 * `DelegatingAssetManager`. Bind nothing to that and every load rejects
 * `NoActiveGameSessionError`, which `play()` swallows — so before this existed a
 * menu blip or a music bed was simply silent, with nothing in the log. This
 * registers a delegate over the game's declared shell inventory for as long as
 * the player is on a shell surface, which is what makes those hooks work there.
 *
 * It is NOT a match impersonation. It publishes nothing to a subtree — that is
 * `GameAssetSession`'s job for the background, and its manager is not one the
 * app-level `AudioManager` is inside — it opens no session on the match or
 * replay-player surfaces, and it hands the binding back before a match takes it:
 * the `to-match` transition is armed by the entry flows BEFORE they navigate
 * (§4.37.18), so the release runs while the shell route is still the current
 * one — ahead of `GameShell`'s registration rather than after it. Every
 * ordering the arm does not cover is caught by releasing on IDENTITY
 * (`DelegatingAssetManager.releaseDelegate`), which cannot clear a binding a
 * match already took over.
 *
 * Non-spatial by construction: it never touches the listener pose (§4.25 — F84).
 * A menu is not a place, and a bed panned against a listener nobody moved would
 * be a claim about a scene that does not exist. A game that wants a positioned
 * shell sound passes `spatial` to its own `useSound` call, which is unaffected.
 *
 * Renders nothing. It is state and lifetime only, so the app root mounts it
 * beside the other shell bridges rather than inside any screen — a bed owned by
 * a screen would restart on every `/main-menu → /settings` hop.
 */
export function ShellAudioSession(): null {
    const { assets, musicBed } = useShellAudioPayload();
    const audioManager = useAudioManager();
    const setGameAssetManager = useSetGameAssetManager();
    const releaseGameAssetManager = useReleaseGameAssetManager();
    // Narrow on purpose, and a boolean rather than the transition: only a match
    // ENTRY hands this session off, and a selector answering the transition
    // OBJECT would also re-run the effect below for a `to-shell` arm — tearing
    // the delegate down for a match that is leaving.
    const isHandingOff = useShellState((state) => state.transition?.kind === 'to-match');
    // The voice a handoff let go of, still sounding. A handed-off bed is NOT a
    // finished one: a cue-aligned fade books its ramp at the cue and holds the
    // voice at full volume until the playhead gets there, a whole loop period
    // away for a menu loop. Nothing else ends it — no bus is exclusive, and an
    // `audio-clip` has no dispose path — so unless the next start ends it first,
    // a cancelled entry or a quit to the menu would lay a second copy of the same
    // loop over the first. The ref survives every teardown because this component
    // is mounted by the app root and never unmounts with the route.
    const handedOffBedRef = React.useRef<AudioHandle | null>(null);

    React.useEffect(() => {
        if (assets === null || isHandingOff) {
            return;
        }

        // BELOW the guard above, and BEFORE the play below, and both placements
        // are load-bearing. Below, because the surface flip to `match` clears the
        // arrived transition and re-runs this with no assets — ending the voice
        // there would cut the very fade the handoff booked. Before, because
        // `play` reserves a voice slot and refuses outright if the pool is still
        // full afterwards, so the outgoing bed has to give its slot up first.
        //
        // The cost of "below" is a return to a shell surface that opens NO
        // session — a payload that resolves nothing — leaving the handed-off
        // voice to the ramp it already booked. Nothing new plays over it, so one
        // bed is still all that sounds.
        const handedOffBed = handedOffBedRef.current;
        if (handedOffBed !== null) {
            handedOffBedRef.current = null;
            audioManager.stop(handedOffBed);
        }

        // Manifest at CONSTRUCTION, and allocated in this commit-phase effect
        // rather than a `useMemo` — see `createAssetManager`'s JSDoc for the
        // first and `GameAssetSession`'s for the second (a render-phase factory
        // is double-invoked under StrictMode and one result is discarded with no
        // cleanup that could reach it).
        const manager = createAssetManager(createRendererGameAssetResolver(), assets);
        setGameAssetManager(manager);
        // §4.10's critical warm-up for a session with no `GameShell` above it.
        // Started here, in the effect that owns the manager, for the reason
        // `GameAssetSession` records: a separate effect's setup would read the
        // previous manager and cache into one no dispose path can reach.
        const abandonPreload = startCriticalAssetPreload(manager, assets);
        // The voice and the declaration it came from, kept as one value: the
        // handoff below needs both, and two separately-nullable locals would let
        // a reader believe one can exist without the other.
        const playing =
            musicBed === null
                ? null
                : {
                      bed: musicBed,
                      handle: audioManager.play(musicBed.ref, {
                          bus: 'music',
                          loop: true,
                          priority: MUSIC_PRIORITY,
                          // Spread, not a key with an `undefined` value: `play` reads
                          // `fadeIn !== undefined` to decide whether there is a ramp
                          // at all, and an explicitly-undefined key would still be one.
                          ...(musicBed.volume === undefined ? {} : { volume: musicBed.volume }),
                          ...(musicBed.fadeInMs === undefined
                              ? {}
                              : { fadeIn: { durationMs: musicBed.fadeInMs } }),
                      }),
                  };

        return () => {
            // Which teardown this is decides what happens to the bed, and the
            // answer is not in this closure: the effect set up while nothing was
            // armed. A TRANSIENT read of the store gets the value as of the
            // commit running this cleanup — which, for the arm, is the commit the
            // arm itself caused.
            const armed = getShellState().transition;
            if (playing !== null) {
                // The kind is checked rather than assumed. Nothing reachable arms
                // `to-shell` while this session is open — `GameStoreBootstrap`
                // raises it only from the two match surfaces — so no fixture can
                // separate this from a bare null check; it is here so the fork
                // reads as the decision it is.
                if (armed?.kind === 'to-match') {
                    beginMatchHandoff(
                        audioManager,
                        playing.handle,
                        assets,
                        playing.bed,
                        armed.durationMs,
                    );
                    handedOffBedRef.current = playing.handle;
                } else {
                    audioManager.stop(playing.handle);
                }
            }
            abandonPreload();
            // Released by IDENTITY: by the time this runs the binding may already
            // belong to a match, and clearing it unconditionally would silence the
            // one it just handed over to.
            releaseGameAssetManager(manager);
            manager.dispose();
        };
    }, [
        assets,
        musicBed,
        isHandingOff,
        audioManager,
        setGameAssetManager,
        releaseGameAssetManager,
    ]);

    return null;
}

/**
 * Hand the menu bed to the match (§4.25): F85's cue-aligned fade when the clip
 * declares the boundary, and the screen fade the entry is already running when it
 * does not. The verbs are F74/F85's own — this decides only WHICH of them the
 * declaration earns.
 *
 * Never a `stop`: the fade schedules the voice's own end, so the session lets go
 * of a bed that is still sounding and the ramp finishes after this mount is gone.
 *
 * A `crossfade` is deliberately not reachable from here. The incoming half of one
 * is the MATCH's music, which the match's own screens start — the shell cannot
 * name a clip it does not own, and arming a crossfade against a placeholder would
 * be a swap the game never asked for.
 */
function beginMatchHandoff(
    audioManager: AudioManager,
    bed: AudioHandle,
    assets: AssetManifest,
    musicBed: GameShellMusicBed,
    durationMs: number,
): void {
    if (declaresHandoffCue(assets, musicBed.ref)) {
        audioManager.fadeOutAtCue(bed, {
            atCue: { name: HANDOFF_CUE },
            fade: { overMs: durationMs },
        });
        return;
    }

    audioManager.fadeOut(bed, { overMs: durationMs });
}

/**
 * Whether the bed's own sheet marks {@link HANDOFF_CUE}.
 *
 * The check is on the CUE, not on the sheet: `fadeOutAtCue` resolves an unknown
 * `{ name }` under end-point rules, which degrade to the clip's decoded end
 * rather than abandoning. A sheet-exists check would therefore arm the transition
 * against an instant the game never authored. What each unreachable-cue branch
 * then leaves audible is `AudioManager.fadeOutAtCue`'s own, and measured there.
 */
function declaresHandoffCue(assets: AssetManifest, ref: AssetRef<AudioClipAsset>): boolean {
    const entry = assets.entries.find((candidate) => candidate.ref === ref);
    const sheet = parseAudioCueSheet(entry?.metadata);
    return typeof sheet?.cues?.[HANDOFF_CUE] === 'number';
}
