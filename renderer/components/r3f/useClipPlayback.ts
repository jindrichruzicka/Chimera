'use client';

/**
 * renderer/components/r3f/useClipPlayback.ts
 *
 * The half of a clip binding that does not care WHICH backend is under it: the
 * declarative `clip` / `loop` / `speed` surface, the frame driver, and the
 * imperative handle.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Why this is a module and not two copies.** `useClipPlayer` (mesh) and
 * `useSpriteClipPlayer` (sprite) differ in exactly one thing — how they allocate
 * the `ClipPlayer` — and agree on everything below it. The rules this module
 * holds (LAST-WRITER-WINS on the speed layer, one DEFAULT-priority driver, the
 * commit-phase-only `latest` ref) are the ones whose failure modes are silent:
 * a declared `speed` reverting to 1 on a restart, a second `useFrame` making a
 * backend's wrap count blind. Two copies would be two contracts, both green.
 * `ClipBackend.ts` hoists `checkedPlaybackSpeed` for the same reason.
 *
 * **Nothing here reaches an `EngineAction`.** The handler surface carries no
 * dispatcher, no `SendAction`, no `PlayerId` and no tick — see
 * `renderer/animation/ClipPlayer.ts`'s header. The rule that no animation event
 * may gate an action (`docs/coding-standards-sections/react-three-fiber.md`, on
 * Invariants #42/#43 and #56-#58) is held by parameters that do not exist, and
 * this module adds none.
 *
 * **One driver, at DEFAULT priority.** Exactly one `useFrame` is registered per
 * mounted hook, unconditionally — rules of hooks: the player transitions between
 * null and non-null across renders of one mounted component — and it is inert
 * until the player exists. Both backends derive a playback's wrap count from the
 * deltas that came through their own `advance`, so a backend must have exactly
 * one driver. A non-zero `renderPriority` subscriber becomes responsible for
 * calling `gl.render` and bumps R3F's `internal.priority` counter — see
 * `FrameRateLimiter.tsx`'s header — so the priority here is the default and
 * stays there.
 *
 * **Rule LAST-WRITER-WINS on the clip-speed layer.** `options.speed` reaches
 * that layer through two writers, one per axis and never per render. The
 * playback effect SEATS it on each playback it starts — `clip`, `loop` and
 * `sheet` each restart the playback, and the layer defaults to 1 — and a
 * `speed`-keyed effect RE-TARGETS the playback in flight, so a speed change
 * re-paces a clip rather than restarting it.
 * {@link ClipPlayerHandle.setClipSpeed} writes the same layer directly, so an
 * imperative slow-motion WINS until the prop changes or the playback restarts.
 * That asymmetry is the point: a hit changes the snapshot and the screen
 * re-renders on the same frame, and a per-render re-apply would silently snap
 * the slow-mo back.
 *
 * **Rule GLOBAL-BY-DEFAULT on the time scale.** The dilation multiplier comes
 * from `useAnimationTimeScale` — the one float `TimeScaleBridge` seats from the
 * authoritative `snapshot.timeScalePermille` — unless `options.timeScale` names
 * one, which OVERRIDES it rather than composing with it. Default-on is the point:
 * a game that had to opt each clip in would lose the whole effect the first time
 * someone forgot. It is read once per frame, and it scales clip playback only —
 * never the R3F clock, which `PerfProbe` reads and which F80 repaired.
 *
 * **There is no clip anchor and no resync.** A clip free-runs from the render
 * that changed `clip`; nothing here reads a tick, a beat or a host tick rate.
 * Re-seating a playhead against simulation time needs a beat, and inventing one
 * from a frame clock is the drift this feature exists to avoid.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';

import type {
    AnimationClipName,
    AnimationLoopMode,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { checkedPlaybackSpeed } from '../../animation/ClipBackend.js';
import type { ClipPlayer } from '../../animation/ClipPlayer.js';
import type { ClipMarkerHandlers } from '../../animation/ClipPlayer.js';
import type { ClipSheetSource } from '../../animation/ClipTimeline.js';
import { useAnimationTimeScale } from '../../animation/useAnimationTimeScale.js';

/** What a caller declares. Everything but `clip` is optional. */
export interface UseClipPlaybackOptions {
    /**
     * The clip to play, or `null` to play nothing.
     *
     * Changing it makes the new clip the only one in flight, from its first
     * frame: whatever was playing has its open passages closed as
     * `'clip-changed'`. `null` stops everything, and those passages close as
     * `'stopped'` — a caller asking for nothing is asking for a stop.
     */
    readonly clip: AnimationClipName | null;
    /** Overrides the loop mode the sheet authored for `clip`. */
    readonly loop?: AnimationLoopMode;
    /**
     * The clip's own layer of the speed stack. Default 1. Seated on every
     * playback the hook starts, and re-applied to one already in flight when
     * this value changes — see Rule LAST-WRITER-WINS in the module header.
     *
     * Rule SPEED-NON-NEGATIVE: a negative or non-finite value raises a
     * `RangeError` out of the commit-phase effect rather than being clamped,
     * because a sign error is a fault in the game's own JSX and every other
     * entry point into the animation layer refuses one where it is written.
     */
    readonly speed?: number;
    /**
     * What to be told about. Read fresh on every emission, so swapping handlers
     * does not restart the clip in flight.
     */
    readonly handlers?: ClipMarkerHandlers;
    /**
     * Overrides the shared dilation multiplier for THIS clip. `1` is real time,
     * `0.25` quarter speed.
     *
     * Absent — the ordinary case — the hook follows `useAnimationTimeScale`, so
     * an authoritative `snapshot.timeScalePermille` slows every mounted clip
     * with no wiring in the game at all. Passing a value opts this clip out of
     * that entirely rather than composing with it: one axis, one writer, and a
     * clip that must ignore a global slow-motion says so explicitly.
     */
    readonly timeScale?: number;
}

/**
 * The imperative half of a clip binding.
 *
 * One verb, because one is what the declarative surface cannot express: a
 * slow-motion applied from an event handler that must survive the re-render
 * that same event causes. Stable across re-renders, and usable before anything
 * has loaded — {@link ClipPlayerHandle.setClipSpeed} refuses an unusable
 * multiplier whether or not there is a player behind it.
 */
export interface ClipPlayerHandle {
    /**
     * Re-target the clip-speed layer for the clip currently declared. Takes
     * effect on the next frame, and holds until `options.speed` itself changes
     * or the clip does.
     *
     * @throws RangeError  when `speed` is negative or not finite (Rule
     *                     SPEED-NON-NEGATIVE); reverse playback is not
     *                     supported.
     */
    setClipSpeed(speed: number): void;
}

/** What the frame loop and the imperative handle read, always from the last commit. */
interface LatestRender {
    handlers: ClipMarkerHandlers | undefined;
    clip: AnimationClipName | null;
    player: ClipPlayer | null;
    reportFault: (clipName: AnimationClipName) => void;
}

/**
 * The dilation multiplier as a STABLE getter, for the `getTimeScale` seam a
 * `ClipPlayer` is constructed with.
 *
 * Owned by the ALLOCATOR rather than by {@link useClipPlayback}, because that is
 * who needs it: the multiplier reaches the animation layer only through the
 * getter injected at construction, and nothing in the playback lifecycle reads
 * it.
 *
 * **Held in a ref, not a `useMemo`.** Both allocation effects list this getter
 * as a dependency, and React documents `useMemo` as a performance hint it is
 * allowed to discard — a dropped cache would re-key the effect and rebuild the
 * player, the backend and (mesh-side) the mixer. A ref is identity-stable by
 * CONTRACT, which is what a dependency of a disposable-allocating effect has to
 * be.
 *
 * `override` is Rule GLOBAL-BY-DEFAULT: absent, the getter follows the shared
 * store; present, it OVERRIDES rather than composing.
 */
export function useTimeScaleGetter(override: number | undefined): () => number {
    // Subscribed here so an authoritative dilation re-renders this hook's owner
    // and the next frame reads the new value.
    const sharedTimeScale = useAnimationTimeScale();
    const latest = useRef(1);
    const getter = useRef<() => number>(() => latest.current);

    // Commit-phase, with no dependency array: the getter is called from the
    // frame loop, which must see the last COMMITTED value.
    useEffect(() => {
        latest.current = override ?? sharedTimeScale;
    });

    return getter.current;
}

/**
 * Drive `player` from a declarative clip surface.
 *
 * `player` is whatever the caller allocated — it owns the backend, and this hook
 * neither creates nor disposes it. A `null` player drives nothing and still
 * registers its frame subscriber, so the caller may allocate late.
 *
 * `sheet` may be `null`: the clip still plays, unmarked. It is a dependency of
 * the playback effect, so pass a STABLE object or a clip will restart on every
 * render.
 *
 * `reportFault` receives an authoring fault the binding itself detects — a clip
 * the backend cannot play. Handler faults are reported by the player.
 *
 * Requires a `<Canvas>`, like every `useFrame` caller.
 */
export function useClipPlayback(
    player: ClipPlayer | null,
    sheet: ClipSheetSource | null,
    options: UseClipPlaybackOptions,
    reportFault: (clipName: AnimationClipName) => void,
): ClipPlayerHandle {
    const { clip, loop, speed, handlers } = options;
    const latest = useRef<LatestRender>({
        handlers: undefined,
        clip: null,
        player: null,
        reportFault,
    });

    // No dependency array: this runs after every commit, so the frame loop, the
    // speed effect and the imperative handle always read the last committed
    // render. Declared FIRST, so it has already run when the playback effect
    // below reads the ref on the same commit.
    useEffect(() => {
        latest.current = { handlers, clip, player, reportFault };
    });

    // The playback effect. It registers NO cleanup: a transition releases what
    // it replaces, and the one release this hook cannot express that way —
    // `clip → null` — is `stopAll`. The outgoing clip's name is not recoverable
    // here: `latest.current.clip` is the INCOMING clip by the time this body
    // runs, because the ref effect above has no dependency array and is declared
    // first, so it has already committed this render's value.
    useEffect(() => {
        if (player === null) {
            return undefined;
        }
        // A player the SAME commit already tore down. An allocator keyed on an
        // input that also restarts the playback — the sprite binding's `sheet`
        // reaches both — runs its cleanup before this effect, so the `player`
        // captured by this render is disposed and its replacement is one commit
        // away. Starting a clip on it would answer `false`, indistinguishable
        // from a clip the backend cannot play, and report an authoring fault
        // against a clip that is fine. Skipped rather than reported: the state
        // change is already scheduled, and this effect re-runs against the new
        // player.
        if (player.isDisposed) {
            return undefined;
        }
        if (clip === null) {
            // Declaring no clip is asking for a stop, and it is the one change
            // this hook cannot express as a transition: there is no incoming
            // clip to become the only one.
            player.stopAll();
            return undefined;
        }
        const started = player.transitionTo({
            clipName: clip,
            sheet,
            handlers: {
                onNotify: (event) => latest.current.handlers?.onNotify?.(event),
                onPassageStart: (event) => latest.current.handlers?.onPassageStart?.(event),
                onPassageTick: (event) => latest.current.handlers?.onPassageTick?.(event),
                onPassageEnd: (event) => latest.current.handlers?.onPassageEnd?.(event),
                onClipEnd: (event) => latest.current.handlers?.onClipEnd?.(event),
            },
            ...(loop !== undefined ? { loop } : {}),
            // `clip`, `loop` and `sheet` each restart the playback, and a
            // transition defaults the clip-speed layer to 1 — so a start that
            // seats nothing drops the declared speed on every restart the hook
            // performs for itself. `speed` is deliberately NOT a dependency of
            // this effect: a speed change must re-target the playback, not
            // restart it.
            speed: speed ?? 1,
        });
        if (!started) {
            // Read off the ref rather than closed over, so a caller passing an
            // inline reporter does not make this effect restart the clip on
            // every render. It is a report channel, not an input.
            latest.current.reportFault(clip);
        }
        return undefined;
    }, [player, clip, loop, sheet]);

    // The other writer of the clip-speed layer — see Rule LAST-WRITER-WINS.
    // Keyed on `speed` ALONE: the playback and the clip it applies to come from
    // the ref, because every input that would change them has already restarted
    // the playback in this same commit and the playback effect seated this value
    // on it. A dependency on either would make this a second write of a value
    // that is already correct, on the one axis where nothing could tell the two
    // apart.
    useEffect(() => {
        const { clip: liveClip, player: livePlayer } = latest.current;
        if (livePlayer === null || liveClip === null) {
            return;
        }
        livePlayer.setClipSpeed(liveClip, speed ?? 1);
    }, [speed]);

    useFrame((_state, deltaSeconds) => {
        player?.tick(deltaSeconds);
    });

    // Closures over a stable ref and nothing else: a StrictMode-discarded
    // invocation of this factory leaks no resource, which is what disqualifies
    // `useMemo` for the mixer and the player in the callers but not here.
    return useMemo<ClipPlayerHandle>(
        () => ({
            setClipSpeed: (nextSpeed: number): void => {
                // Refused here as well as in `ClipPlayer`, so a sign error is
                // refused wherever it is written — including before a model has
                // loaded, when there is no player to refuse it.
                const checked = checkedPlaybackSpeed(nextSpeed, 'clip speed');
                const { player: livePlayer, clip: liveClip } = latest.current;
                if (livePlayer !== null && liveClip !== null) {
                    livePlayer.setClipSpeed(liveClip, checked);
                }
            },
        }),
        [],
    );
}
