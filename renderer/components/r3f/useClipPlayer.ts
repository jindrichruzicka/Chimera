'use client';

/**
 * renderer/components/r3f/useClipPlayer.ts
 *
 * The React binding of the animation layer: a declarative `clip` / `loop` /
 * `speed` surface over one `ClipPlayer` driving one `MeshClipBackend` on one
 * owned `AnimationMixer`.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Nothing here reaches an `EngineAction`.** The handler surface this hook
 * forwards carries no dispatcher, no `SendAction`, no `PlayerId` and no tick —
 * see `renderer/animation/ClipPlayer.ts`'s header. The rule that no animation
 * event may gate an action (`docs/coding-standards-sections/react-three-fiber.md`,
 * on Invariants #42/#43 and #56-#58) is held by parameters that do not exist,
 * and this hook adds none. Gameplay consequences are beat-driven and belong to
 * the simulation.
 *
 * **Every allocation is a commit-phase effect, never `useMemo`.** StrictMode
 * double-invokes memo factories and DISCARDS one result, which would orphan a
 * mixer retaining the clone root with no `uncacheRoot` ever running, and a
 * `ClipPlayer` holding a backend with no `dispose` ever running. The one
 * `useMemo` below allocates nothing but closures over a ref, so there is
 * nothing for a discarded invocation to leak.
 *
 * **One driver, at DEFAULT priority.** Exactly one `useFrame` is registered per
 * mounted hook, unconditionally — rules of hooks: `instance` transitions
 * between null and non-null across renders of one mounted component — and it is
 * inert until the player exists. `MeshClipBackend` derives a playback's wrap
 * count from the deltas that came through its own `advance`, so a mixer
 * carrying its playbacks must have exactly one driver: this hook therefore owns
 * its mixer through `useOwnedMixer` rather than composing `useModelAnimation`,
 * whose `useFrame` would be a second one. A non-zero `renderPriority`
 * subscriber becomes responsible for calling `gl.render` and bumps R3F's
 * `internal.priority` counter — see `FrameRateLimiter.tsx`'s header — so the
 * priority here is the default and stays there.
 *
 * **Rule LAST-WRITER-WINS on the clip-speed layer.** `options.speed` reaches
 * that layer through two writers, one per axis and never per render. `play`
 * SEATS it on each playback it starts — `clip`, `loop` and `sheet` each restart
 * the playback, and `ClipPlayer.play` defaults the layer to 1 — and a
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
 * someone forgot, exactly the failure the bridge's single mount site exists to
 * rule out. It is read once per frame, and it scales clip playback only — never
 * the R3F clock, which `PerfProbe` reads and which F80 repaired.
 *
 * **Rule ONE-MIXER-PER-ROOT.** A model root carries this hook or
 * `useModelAnimation`, never both; `useOwnedMixer` claims the root and reports a
 * real duplicate through the log bridge.
 *
 * **There is no clip anchor and no resync.** A clip free-runs from the render
 * that changed `clip`; nothing here reads a tick, a beat or a host tick rate.
 * Re-seating a playhead against simulation time needs a beat, and inventing one
 * from a frame clock is the drift this feature exists to avoid.
 *
 * `ModelInstance` is imported TYPE-ONLY. A runtime edge into `renderer/assets/`
 * would drag the clone seam, and with it `three/examples/jsm/utils/
 * SkeletonUtils.js`, into the `components/r3f` barrel graph — which
 * `__tests__/r3f-barrel-side-effects.test.ts` pins as absent.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
    AnimationClipName,
    AnimationLoopMode,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { checkedPlaybackSpeed } from '../../animation/ClipBackend.js';
import { ClipPlayer } from '../../animation/ClipPlayer.js';
import type { ClipMarkerHandlers } from '../../animation/ClipPlayer.js';
import type { ClipSheetSource } from '../../animation/ClipTimeline.js';
import { MeshClipBackend } from '../../animation/MeshClipBackend.js';
import { useAnimationTimeScale } from '../../animation/useAnimationTimeScale.js';
import type { ModelInstance } from '../../assets/ModelInstance.js';
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';
import { useOwnedMixer } from './useOwnedMixer.js';

export type {
    ClipEndEvent,
    MarkerEvent,
    NotifyEvent,
    PassageEndEvent,
    PassageEndReason,
    PassageEvent,
    PassageTickEvent,
} from '../../animation/clipMarkerScheduler.js';
export type { ClipMarkerHandlers } from '../../animation/ClipPlayer.js';

const LOG_MODULE = 'clip-player';

/**
 * Names a playback fault the engine itself detected — an authoring problem in
 * the clip sheet, or a clip the backend cannot play. A fault the engine merely
 * RELAYS keeps its own error: a game handler that threw is reported under the
 * error the game threw, because renaming it would hide which of the game's
 * throws this was.
 */
class ClipPlaybackError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ClipPlaybackError';
    }
}

/**
 * The `report` seam `ClipPlayer` is built with. Module-level rather than a
 * hook-scoped closure, because nothing in it depends on a render.
 *
 * Reported and never thrown: R3F's `ErrorBoundary` re-throws OUTWARD past the
 * `<Canvas>`, so a throw here would take down more than the animation.
 */
function reportClipPlaybackFault(message: string, cause?: unknown): void {
    emitRendererError(
        readRendererLogsApi(),
        `[useClipPlayer] ${message}`,
        cause instanceof Error ? cause : new ClipPlaybackError(message),
        undefined,
        LOG_MODULE,
    );
}

/** What a caller declares. Everything but `clip` is optional. */
export interface UseClipPlayerOptions {
    /**
     * The clip to play, or `null` to play nothing. Changing it stops whatever
     * was in flight — its open passages close as `'stopped'` — and starts the
     * new clip from its first frame.
     */
    readonly clip: AnimationClipName | null;
    /** Overrides the loop mode the sheet authored for `clip`. */
    readonly loop?: AnimationLoopMode;
    /**
     * The clip's own layer of the speed stack. Default 1. Seated on every
     * playback the hook starts, and re-applied to one already in flight when
     * this value changes — see Rule LAST-WRITER-WINS in the module header.
     *
     * Rule SPEED-NON-NEGATIVE applies here as it does to
     * {@link ClipPlayerHandle.setClipSpeed}: a negative or non-finite value
     * raises a `RangeError` out of the commit-phase effect rather than being
     * clamped, because a sign error is a fault in the game's own JSX and every
     * other entry point into the animation layer refuses one where it is
     * written.
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
     *
     * Either way the multiplier is read once per frame and scales clip playback
     * only: it is deliberately NOT the R3F clock, which would make `PerfProbe`
     * report a dilated frame rate.
     */
    readonly timeScale?: number;
}

/**
 * The imperative half of the binding.
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
    timeScale: number;
    clip: AnimationClipName | null;
    player: ClipPlayer | null;
}

/**
 * Play `options.clip` out of `instance`, firing the marks `sheet` authors for
 * it.
 *
 * `sheet` may be `null`: the clip still plays, unmarked. It is a dependency of
 * the playback effect, so pass a STABLE object or a clip will restart on every
 * render. `useAnimationSheet` memoises what it parses, so a caller holding one
 * passes `parsed?.sheet ?? null` — the parsed wrapper carries `warnings`
 * alongside the sheet and is not itself a {@link ClipSheetSource}, which is
 * what keeps surfacing those warnings the caller's decision.
 *
 * Requires a `<Canvas>`, like every `useFrame` caller. Returns `null`-safe:
 * a `null` `instance` allocates nothing, drives nothing and still registers its
 * frame subscriber.
 */
export function useClipPlayer(
    instance: ModelInstance | null,
    sheet: ClipSheetSource | null,
    options: UseClipPlayerOptions,
): ClipPlayerHandle {
    const mixer = useOwnedMixer(instance, 'useClipPlayer');
    const [player, setPlayer] = useState<ClipPlayer | null>(null);
    // The shared multiplier, subscribed to here so an authoritative dilation
    // re-renders this hook's owner and the frame loop reads the new value on the
    // next frame — see Rule GLOBAL-BY-DEFAULT on `options.timeScale`.
    const sharedTimeScale = useAnimationTimeScale();

    const { clip, loop, speed, handlers, timeScale } = options;
    const latest = useRef<LatestRender>({
        handlers: undefined,
        timeScale: 1,
        clip: null,
        player: null,
    });

    // No dependency array: this runs after every commit, so the frame loop, the
    // speed effect and the imperative handle always read the last committed
    // render.
    useEffect(() => {
        latest.current = { handlers, timeScale: timeScale ?? sharedTimeScale, clip, player };
    });

    useEffect(() => {
        if (instance === null || mixer === null) {
            return undefined;
        }
        // The mixer is state, so the commit that swaps `instance` still holds
        // the PREVIOUS one — already stopped and uncached by `useOwnedMixer`'s
        // cleanup in this same commit. Pairing them by root is what stops this
        // effect caching an action on a dead mixer for one commit.
        if (mixer.getRoot() !== instance.root) {
            return undefined;
        }
        const allocated = new ClipPlayer({
            backend: new MeshClipBackend({ mixer, clips: instance.clips }),
            getTimeScale: () => latest.current.timeScale,
            report: reportClipPlaybackFault,
        });
        setPlayer(allocated);
        return () => {
            // Closes every open passage as 'released' before anything else can
            // observe the teardown, and disposes the backend under it. The
            // state must be cleared too, not just the object disposed: a
            // disposed `ClipPlayer` answers `play` with `false`, which this
            // hook reports as an unplayable clip — so a player left in state
            // turns the next `clip` change into a spurious authoring fault.
            allocated.dispose();
            setPlayer(null);
        };
    }, [instance, mixer]);

    useEffect(() => {
        if (player === null || clip === null) {
            return undefined;
        }
        const started = player.play({
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
            // `clip`, `loop` and `sheet` each restart the playback, and
            // `ClipPlayer.play` defaults the clip-speed layer to 1 — so a play
            // that seats nothing drops the declared speed on every restart the
            // hook performs for itself. `speed` is deliberately NOT a
            // dependency of this effect: a speed change must re-target the
            // playback, not restart it.
            speed: speed ?? 1,
        });
        if (!started) {
            // Two authoring faults reach this one branch, so the message names
            // both: `MeshClipBackend` drops a clip of no usable length from the
            // set it can play, which is indistinguishable here from a clip the
            // model never carried.
            reportClipPlaybackFault(
                `"${clip}" is not a playable clip on this model — no clip of that name, or one of no usable length. Nothing is playing.`,
            );
        }
        return () => {
            player.stop(clip);
        };
    }, [player, clip, loop, sheet]);

    // The other writer of the clip-speed layer — see Rule LAST-WRITER-WINS.
    // Keyed on `speed` ALONE: the playback and the clip it applies to come from
    // the ref, because every input that would change them has already restarted
    // the playback in this same commit and `play` seated this value on it. A
    // dependency on either would make this a second write of a value that is
    // already correct, on the one axis where nothing could tell the two apart.
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
    // `useMemo` for the mixer and the player above but not here.
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
