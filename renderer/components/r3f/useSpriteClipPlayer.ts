'use client';

/**
 * renderer/components/r3f/useSpriteClipPlayer.ts
 *
 * The SPRITE React binding of the animation layer: a declarative `clip` / `loop`
 * / `speed` surface over one `ClipPlayer` driving one `SpriteClipBackend` across
 * a caller-owned quad.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **The twin of `useClipPlayer`, and what differs.** Everything below the
 * allocation is shared through `useClipPlayback.ts` — the declarative surface,
 * Rule LAST-WRITER-WINS on the speed layer, the one DEFAULT-priority driver, the
 * imperative handle. What this module owns is the part that is true of a sprite
 * and of nothing else: a run of atlas cells instead of an `AnimationClip`, four
 * `uv` pairs instead of a mixer, and NO mixer at all — so there is no
 * `useOwnedMixer` claim and no Rule ONE-MIXER-PER-ROOT here. The exclusion a
 * sprite has instead is one WRITER per quad, held below.
 *
 * **Rule ONE-WRITER-PER-QUAD.** A `SpriteClipBackend` writes the `uv` attribute
 * of the geometry it is given, every frame. Two backends over one geometry would
 * fight over it, and the loser's cell would flicker at frame rate. This hook
 * therefore takes the geometry as a parameter rather than allocating one: the
 * caller owns it, and pairing one geometry with one mounted hook is the caller's
 * to arrange — `AnimatedSprite` does it by allocating the quad it passes.
 *
 * **Geometry lifetime belongs to whoever constructed it.** The teardown disposes
 * the player and the backend under it, never the injected geometry, and leaves
 * its `uv` exactly as the last frame wrote it.
 *
 * **Every allocation is a commit-phase effect, never `useMemo`.** StrictMode
 * double-invokes memo factories and DISCARDS one result, which would orphan a
 * `ClipPlayer` holding a backend with no `dispose` ever running.
 *
 * **The frame runs come from the sheet, converted once.** A game authors
 * `durationSeconds`; the backend takes `fps`. `spriteClipSpecs.ts` converts in
 * the direction that keeps the authored length exact, so every compiled mark
 * lands on the phase the game wrote — see its header.
 *
 * What the `components/r3f` barrel graph may and may not reach — `AnimatedSprite`
 * takes a runtime edge into `renderer/assets/` and the clone seam still stays out
 * — is measured in `__tests__/r3f-barrel-side-effects.test.ts`, not restated here.
 */

import { useEffect, useMemo, useState } from 'react';

import type { BufferGeometry } from 'three';

import type { SpriteAnimationMetadata } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { ClipPlayer } from '../../animation/ClipPlayer.js';
import { SpriteClipBackend } from '../../animation/SpriteClipBackend.js';
import { toSpriteClipSpecs } from '../../animation/spriteClipSpecs.js';
import type { SpriteAtlas } from '../../assets/spriteAtlas.js';
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';
import { useClipPlayback, useTimeScaleGetter } from './useClipPlayback.js';
import type { ClipPlayerHandle, UseClipPlaybackOptions } from './useClipPlayback.js';

// The marker event types, `ClipMarkerHandlers` and `ClipPlayerHandle` are NOT
// re-exported here. One scheduler serves both backends, so those names are one
// surface with one declaration site — `useClipPlayer.ts`, which the barrel takes
// them from. A second re-export would let the two halves drift into two spellings
// of the same type.

const LOG_MODULE = 'sprite-clip-player';

/**
 * Names a playback fault the engine itself detected — an authoring problem in
 * the sprite clip sheet, or a clip the backend cannot play. A fault the engine
 * merely RELAYS keeps its own error: a game handler that threw is reported under
 * the error the game threw.
 */
class SpriteClipPlaybackError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SpriteClipPlaybackError';
    }
}

/**
 * The `report` seam `ClipPlayer` is built with. Module-level rather than a
 * hook-scoped closure, because nothing in it depends on a render.
 *
 * Reported and never thrown: R3F's `ErrorBoundary` re-throws OUTWARD past the
 * `<Canvas>`, so a throw here would take down more than the animation.
 */
function reportSpriteClipFault(message: string, cause?: unknown): void {
    emitRendererError(
        readRendererLogsApi(),
        `[useSpriteClipPlayer] ${message}`,
        cause instanceof Error ? cause : new SpriteClipPlaybackError(message),
        undefined,
        LOG_MODULE,
    );
}

/**
 * Three authoring faults reach this one report, so the message names them: the
 * sheet may carry no clip of that name, the clip's frame run may reach past the
 * atlas, or its authored duration may be unusable. All three leave the backend
 * with nothing to play, and it cannot tell them apart from here.
 */
function reportUnplayableSpriteClip(clipName: string): void {
    reportSpriteClipFault(
        `"${clipName}" is not a playable clip on this sprite sheet — no clip of that name, a frame run reaching past the atlas, or no usable durationSeconds. Nothing is playing.`,
    );
}

/**
 * What a caller declares. Everything but `clip` is optional.
 *
 * The sprite binding adds no option of its own: the surface is the one
 * `useClipPlayer` takes, so a game moving a clip between a mesh and a sprite
 * rewrites nothing but the element it sits on.
 */
export type UseSpriteClipPlayerOptions = UseClipPlaybackOptions;

/**
 * Play `options.clip` out of `sheet` across `atlas`, writing each cell into
 * `geometry` and firing the marks the sheet authors.
 *
 * All three of `atlas`, `geometry` and `sheet` may be `null` — a sprite sheet
 * loads asynchronously, so the ordinary first render has none of them. Nothing
 * is allocated, nothing is driven, and no fault is reported until there is
 * something to play; the frame subscriber is registered either way.
 *
 * Pass a STABLE `sheet` and `atlas`. Both are dependencies of the allocation
 * effect below, and allocating SETS STATE — so a fresh object per render is an
 * unbounded render loop, not a restarted clip. `useSpriteAnimationSheet` and
 * `useSpriteAtlas` both memoise what they parse, so a caller holding them passes
 * `parsed?.sheet ?? null` — the parsed wrapper carries `warnings` alongside the
 * sheet, which is what keeps surfacing those warnings the caller's decision.
 *
 * Requires a `<Canvas>`, like every `useFrame` caller.
 */
export function useSpriteClipPlayer(
    atlas: SpriteAtlas | null,
    geometry: BufferGeometry | null,
    sheet: SpriteAnimationMetadata | null,
    options: UseSpriteClipPlayerOptions,
): ClipPlayerHandle {
    const [player, setPlayer] = useState<ClipPlayer | null>(null);
    const getTimeScale = useTimeScaleGetter(options.timeScale);

    // Converted once per sheet, not per render: the specs are a dependency of
    // the allocation effect below, so a fresh object every render would tear
    // down and rebuild the backend on every frame. `warnings` is deliberately
    // not surfaced here — the caller already holds the parsed sheet that
    // produced them, and reporting them twice is what `useAnimationSheet`'s
    // returned-warnings shape exists to avoid.
    const specs = useMemo(() => toSpriteClipSpecs(sheet).specs, [sheet]);

    useEffect(() => {
        if (atlas === null || geometry === null) {
            return undefined;
        }
        const allocated = new ClipPlayer({
            backend: new SpriteClipBackend({ atlas, geometry, clips: specs }),
            getTimeScale,
            report: reportSpriteClipFault,
        });
        setPlayer(allocated);
        return () => {
            // Closes every open passage as 'released' before anything else can
            // observe the teardown, and disposes the backend under it — which
            // releases only what the backend allocated, never the caller's
            // geometry. The state must be cleared too, not just the object
            // disposed: a disposed `ClipPlayer` answers `play` with `false`,
            // which reads as an unplayable clip, so a player left in state would
            // turn the next `clip` change into a spurious authoring fault. That
            // clears the NEXT commit; the one in flight — this effect is keyed on
            // `specs`, so a `sheet` change runs this cleanup and then the
            // playback effect, which still holds the disposed player — is
            // `useClipPlayback`'s `isDisposed` guard.
            allocated.dispose();
            setPlayer(null);
        };
    }, [atlas, geometry, specs, getTimeScale]);

    return useClipPlayback(player, sheet, options, reportUnplayableSpriteClip);
}
