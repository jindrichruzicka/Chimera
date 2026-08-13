/**
 * renderer/animation/ClipTimeline.ts
 *
 * Compiles one authored clip sheet into the sorted, phase-denominated mark list
 * the marker scheduler walks.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Three properties shape the whole module.
 *
 * **Order is decided once, here.** Marks come out ascending by phase, ties broken
 * lexicographically by name. Records preserve insertion order, so without a sort
 * the scheduler would walk marks in whatever order the sheet happened to be typed
 * in — and a sheet reformatted by a tool would change when a game's markers fire.
 * The tie-break compares the raw strings rather than going through
 * `localeCompare`, whose result depends on the host locale.
 *
 * **Range checks read the RUNTIME duration.** The authored `durationSeconds` is
 * what the content author believed; the loaded clip is what actually plays. They
 * disagree whenever a clip is re-exported, and resolving `{ seconds }` against
 * the authored value would drift every mark of that clip. `frameCount` has no
 * runtime counterpart and is read from the sheet.
 *
 * **Problems are returned, never logged.** Every authoring fault becomes a string
 * in `warnings`, at most one per authored mark, which keeps the warning count a
 * pure property of the return value rather than something a console spy counts.
 *
 * This module is the compile half: pure arithmetic, no three.js, no React, no DOM.
 */

import type {
    AnimationClipName,
    AnimationLoopMode,
    AnimationMarkName,
    AnimationTrackSheet,
    AnimationWindowName,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { resolveClipPosition } from './ClipPosition.js';
import type { ClipPositionContext } from './ClipPosition.js';

/** A notify point, compiled to the phase at which the scheduler emits it. */
export interface CompiledNotify {
    readonly kind: 'notify';
    readonly name: AnimationMarkName;
    readonly phase: number;
}

/** A sub-passage, compiled to the span the scheduler opens and closes it across. */
export interface CompiledPassage {
    readonly kind: 'passage';
    readonly name: AnimationMarkName;
    readonly fromPhase: number;
    readonly toPhase: number;
    /** The gameplay window this passage claims while open, if it claims one. */
    readonly window?: AnimationWindowName;
}

export type CompiledMark = CompiledNotify | CompiledPassage;

/** One clip's compiled sheet. `marks` may be empty; the clip still plays. */
export interface CompiledClipTimeline {
    readonly clipName: AnimationClipName;
    /** The runtime duration every phase here was compiled against. Finite and positive. */
    readonly durationSeconds: number;
    /** The authored loop mode. Absent leaves the choice to the player. */
    readonly loop?: AnimationLoopMode;
    /**
     * The authored blend-in length in seconds, carried through untouched. Absent
     * rather than defaulted, so the player's resolution chain can tell "the sheet
     * says nothing" from "the sheet says cut".
     */
    readonly blendInSeconds?: number;
    /** Ascending by phase, ties by name. Every name appears at most once. */
    readonly marks: readonly CompiledMark[];
    /** Every authoring fault found, at most one per authored mark. */
    readonly warnings: readonly string[];
}

/**
 * Anything carrying a map of clip name → sheet. Both `ModelAnimationMetadata`
 * and `SpriteAnimationMetadata` satisfy it, so the compiler needs no knowledge of
 * which of the two it was handed.
 */
export interface ClipSheetSource {
    readonly clips?: Readonly<Record<AnimationClipName, AnimationTrackSheet>>;
}

/**
 * Compile `clipName` out of `sheet` against the clip's real, loaded duration.
 *
 * Returns `null` only when there is nothing to play: no sheet, no clip map, no
 * such clip, or a `runtimeDurationSeconds` that is not a finite positive number.
 * A clip whose every mark is unusable compiles to an EMPTY mark list instead —
 * a different answer, because that clip does play, just unmarked.
 */
export function compileClipTimeline(
    sheet: ClipSheetSource | null | undefined,
    clipName: AnimationClipName,
    runtimeDurationSeconds: number,
): CompiledClipTimeline | null {
    const clip = sheet?.clips?.[clipName];
    if (clip === undefined) {
        return null;
    }
    if (!Number.isFinite(runtimeDurationSeconds) || runtimeDurationSeconds <= 0) {
        return null;
    }

    // The conditional spread is required by `exactOptionalPropertyTypes`, not by
    // behaviour: `resolveClipPosition` treats an absent and an explicitly
    // undefined `frameCount` alike, so flattening it to `frameCount:
    // clip.frameCount` reds `pnpm typecheck` (TS2375) and no test. Unlike the two
    // spreads on the returned object below, which decide whether a KEY exists on
    // a value callers inspect, and are pinned as such.
    const ctx: ClipPositionContext = {
        durationSeconds: runtimeDurationSeconds,
        ...(clip.frameCount !== undefined ? { frameCount: clip.frameCount } : {}),
    };
    const warnings: string[] = [];
    const byName = new Map<AnimationMarkName, CompiledMark>();

    for (const [name, notify] of Object.entries(clip.notifies ?? {})) {
        // Optional chaining on a field the type says is always there: the record
        // AROUND a position arrives through the same `unknown` metadata slot the
        // position does, so a null body would throw past the whole fail-soft
        // posture. An absent `at` rejects with a warning like any other.
        const at = resolveClipPosition(notify?.at, ctx);
        if (at.kind === 'rejected') {
            warnings.push(markWarning(clipName, name, at.warning));
            continue;
        }
        byName.set(name, { kind: 'notify', name, phase: at.phase });
    }

    // Passages compile AFTER notifies, so which mark survives a shared name is
    // fixed by this order and not by the key order of either record.
    for (const [name, passage] of Object.entries(clip.passages ?? {})) {
        // As above. `to` and `window` below need no guard: they are read only
        // after `from` resolved, which a non-object body cannot do.
        const from = resolveClipPosition(passage?.from, ctx);
        if (from.kind === 'rejected') {
            // Short-circuit rather than also resolving `to`: one authored mark
            // yields at most one warning, so the count never reports how broken
            // a single mark is.
            warnings.push(markWarning(clipName, name, from.warning));
            continue;
        }
        const to = resolveClipPosition(passage.to, ctx);
        if (to.kind === 'rejected') {
            warnings.push(markWarning(clipName, name, to.warning));
            continue;
        }
        if (to.phase <= from.phase) {
            // Covers both the collapsed passage and the one authored to wrap past
            // the loop point. Splitting a wrap in two would emit two
            // `passage-start`s for one authored passage, and the beat window it
            // may claim has no matching split at all.
            warnings.push(
                markWarning(
                    clipName,
                    name,
                    `passage ends at phase ${to.phase} which is not after its start ${from.phase}`,
                ),
            );
            continue;
        }
        if (byName.has(name)) {
            // A mark name is the key a handler record is written against, so one
            // name meaning both `notify` and `passage-start` would make a
            // handler's own type ambiguous.
            warnings.push(
                markWarning(
                    clipName,
                    name,
                    'a notify and a passage share this name; the passage wins',
                ),
            );
        }
        byName.set(name, {
            kind: 'passage',
            name,
            fromPhase: from.phase,
            toPhase: to.phase,
            ...(passage.window !== undefined ? { window: passage.window } : {}),
        });
    }

    const marks = [...byName.values()].sort(byPhaseThenName);

    return {
        clipName,
        durationSeconds: runtimeDurationSeconds,
        ...(clip.loop !== undefined ? { loop: clip.loop } : {}),
        ...(clip.blendInSeconds !== undefined ? { blendInSeconds: clip.blendInSeconds } : {}),
        marks,
        warnings,
    };
}

// ─── internals ──────────────────────────────────────────────────────────────────

/** Where a mark sits on the timeline: a notify's instant, or a passage's start. */
function startPhaseOf(mark: CompiledMark): number {
    return mark.kind === 'notify' ? mark.phase : mark.fromPhase;
}

function byPhaseThenName(a: CompiledMark, b: CompiledMark): number {
    const byPhase = startPhaseOf(a) - startPhaseOf(b);
    if (byPhase !== 0) {
        return byPhase;
    }
    if (a.name === b.name) {
        return 0;
    }
    return a.name < b.name ? -1 : 1;
}

function markWarning(
    clipName: AnimationClipName,
    markName: AnimationMarkName,
    detail: string,
): string {
    return `Animation clip "${clipName}" mark "${markName}": ${detail}; dropping the mark.`;
}
