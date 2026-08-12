'use client';

/**
 * renderer/components/r3f/useClipPlayer.ts
 *
 * The MESH React binding of the animation layer: a declarative `clip` / `loop` /
 * `speed` surface over one `ClipPlayer` driving one `MeshClipBackend` on one
 * owned `AnimationMixer`.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **What this module owns, and what it does not.** It owns the MIXER and the
 * mesh backend — the parts that are true of a skinned glTF model and of nothing
 * else. The declarative surface under them, the frame driver and the imperative
 * handle live in `useClipPlayback.ts`, shared with the sprite binding: the rules
 * there (LAST-WRITER-WINS, one DEFAULT-priority driver) have silent failure
 * modes, and two copies would be two contracts, both green.
 *
 * **Every allocation is a commit-phase effect, never `useMemo`.** StrictMode
 * double-invokes memo factories and DISCARDS one result, which would orphan a
 * mixer retaining the clone root with no `uncacheRoot` ever running, and a
 * `ClipPlayer` holding a backend with no `dispose` ever running.
 *
 * **Rule ONE-MIXER-PER-ROOT.** A model root carries this hook or
 * `useModelAnimation`, never both; `useOwnedMixer` claims the root and reports a
 * real duplicate through the log bridge. `MeshClipBackend` derives a playback's
 * wrap count from the deltas that came through its own `advance`, so a mixer
 * carrying its playbacks must have exactly one driver: this hook therefore owns
 * its mixer through `useOwnedMixer` rather than composing `useModelAnimation`,
 * whose `useFrame` would be a second one.
 *
 * `ModelInstance` is imported TYPE-ONLY, so `assets/ModelInstance.ts` — the sole
 * `SkeletonUtils` importer — stays out of the `components/r3f` barrel graph.
 * What that graph may and may not reach is measured in
 * `__tests__/r3f-barrel-side-effects.test.ts`, not restated here.
 */

import { useEffect, useState } from 'react';

import { ClipPlayer } from '../../animation/ClipPlayer.js';
import type { ClipSheetSource } from '../../animation/ClipTimeline.js';
import { MeshClipBackend } from '../../animation/MeshClipBackend.js';
import type { ModelInstance } from '../../assets/ModelInstance.js';
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';
import { useClipPlayback, useTimeScaleGetter } from './useClipPlayback.js';
import type { ClipPlayerHandle, UseClipPlaybackOptions } from './useClipPlayback.js';
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
export type { ClipPlayerHandle } from './useClipPlayback.js';

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

/**
 * What a caller declares. Everything but `clip` is optional.
 *
 * The mesh binding adds no option of its own: the surface is the shared one, and
 * naming it here is what keeps `UseClipPlayerOptions` the type a game annotates
 * against — `useClipPlayback` is an internal.
 */
export type UseClipPlayerOptions = UseClipPlaybackOptions;

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
    const getTimeScale = useTimeScaleGetter(options.timeScale);

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
            getTimeScale,
            report: reportClipPlaybackFault,
        });
        setPlayer(allocated);
        return () => {
            // Closes every open passage as 'released' before anything else can
            // observe the teardown, and disposes the backend under it. The
            // state must be cleared too, not just the object disposed: a
            // disposed `ClipPlayer` answers a start with `false`, which reads as
            // an unplayable clip, so a player left in state would turn the next
            // `clip` change into a spurious authoring fault. That clears the
            // NEXT commit; the one in flight — where this cleanup has already
            // run and the playback effect still holds the disposed player — is
            // `useClipPlayback`'s `isDisposed` guard.
            allocated.dispose();
            setPlayer(null);
        };
    }, [instance, mixer, getTimeScale]);

    return useClipPlayback(player, sheet, options, reportUnplayableClip);
}

/**
 * Two authoring faults reach this one report, so the message names both:
 * `MeshClipBackend` drops a clip of no usable length from the set it can play,
 * which is indistinguishable here from a clip the model never carried.
 */
function reportUnplayableClip(clipName: string): void {
    reportClipPlaybackFault(
        `"${clipName}" is not a playable clip on this model — no clip of that name, or one of no usable length. Nothing is playing.`,
    );
}
