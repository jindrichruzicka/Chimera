/**
 * renderer/animation/spriteClipSpecs.ts
 *
 * Turns the sprite clip sheet a game AUTHORS into the run specs
 * {@link SpriteClipBackend} PLAYS.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Why the two shapes differ at all.** A game authors `durationSeconds`,
 * because that is the unit every other half of the sheet is written in: a
 * notify's phase, a passage's span and the `beatWindow` the simulation verifies
 * against are all denominated in the clip's LENGTH. The backend takes `fps`,
 * because a run of atlas cells advances by cells. This module is the one place
 * the two meet, and it converts in the direction that keeps the authored length
 * exact — `fps = frames.length / durationSeconds`, so the backend's own
 * `frames.length / fps` returns the authored duration and every compiled mark
 * lands on the phase the game wrote.
 *
 * Deriving it the other way — letting the game author `fps` and computing the
 * duration — would make the sheet's marks depend on a number the mark author
 * never sees, which is the same class of coupling that keeps `tickRateMs` out of
 * the beat windows.
 *
 * **Fail-soft, like every reader on this path.** A clip that cannot be converted
 * is DROPPED with one warning naming it, never defaulted: an fps invented for a
 * clip with no authored duration would play at a length no mark was compiled
 * against, which is a silently wrong animation rather than a missing one. The
 * caller decides where the warnings go; nothing here logs or throws.
 *
 * This module is a pure reader: no three.js, no React, no DOM, no logger — the
 * `SpriteClipSpec` import is TYPE-ONLY, which is what keeps it inside
 * `scheduler-purity.test.ts`'s framework-free set.
 */

import type {
    AnimationClipName,
    SpriteAnimationMetadata,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import type { SpriteClipSpec } from './SpriteClipBackend.js';

/** The converted runs, paired with one warning per clip that could not be converted. */
export interface SpriteClipSpecs {
    /**
     * Clip name → the run the backend plays. Built with a `null` prototype: clip
     * names are game-authored data, and a clip called `__proto__` must define an
     * own key rather than write a prototype.
     */
    readonly specs: Readonly<Record<AnimationClipName, SpriteClipSpec>>;
    /** At most one string per dropped clip. Never empty strings. */
    readonly warnings: readonly string[];
}

/**
 * Convert `sheet`'s clips into backend run specs.
 *
 * Answers an EMPTY spec map — never `null` — for an absent sheet, a sheet with
 * no clip map, or one whose every clip was dropped. A sprite with no playable
 * clip is a sprite that shows its first cell and stands still, which is the
 * fail-soft answer the rest of this seam gives.
 */
export function toSpriteClipSpecs(sheet: SpriteAnimationMetadata | null): SpriteClipSpecs {
    const specs: Record<AnimationClipName, SpriteClipSpec> = Object.create(null) as Record<
        AnimationClipName,
        SpriteClipSpec
    >;
    const warnings: string[] = [];

    for (const [clipName, clip] of Object.entries(sheet?.clips ?? {})) {
        // Optional chaining on a field the type says is always there: the sheet
        // arrives through the `unknown` metadata slot, so a null clip body would
        // throw past the whole fail-soft posture.
        const frames: unknown = clip?.frames;
        if (!isNumberArray(frames) || frames.length === 0) {
            warnings.push(
                `Sprite clip '${clipName}' declares no frames run; the clip cannot be played.`,
            );
            continue;
        }

        const durationSeconds: unknown = clip?.durationSeconds;
        if (
            typeof durationSeconds !== 'number' ||
            !Number.isFinite(durationSeconds) ||
            durationSeconds <= 0
        ) {
            // Named rather than defaulted: the sheet's marks are compiled
            // against this number, so inventing one plays every mark at the
            // wrong phase instead of failing visibly.
            warnings.push(
                `Sprite clip '${clipName}' declares no usable durationSeconds; the clip cannot be played.`,
            );
            continue;
        }

        specs[clipName] = {
            // Copied, not shared: the backend resolves this run against an atlas
            // and holds it for the life of the playback.
            frames: [...frames],
            fps: frames.length / durationSeconds,
            loop: clip.loop ?? 'once',
        };
    }

    return { specs, warnings };
}

/**
 * A frame run this module can copy: an array whose every element is a number.
 *
 * Written as a predicate rather than a bare `Array.isArray` because the sheet
 * reaches here through the `unknown` metadata slot, and narrowing a `readonly
 * number[] | undefined` with `Array.isArray` yields `any[]` — which would spread
 * unchecked into the spec below. The elements ARE checked, because the return
 * type claims they are: a predicate that asserted `readonly number[]` off a bare
 * `Array.isArray` would be a name broader than its check.
 *
 * What is deliberately NOT checked is whether an index names a cell the atlas
 * HAS — that is `SpriteClipBackend`'s answer to give, and taking it here would
 * report the same authoring fault twice.
 */
function isNumberArray(value: unknown): value is readonly number[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}
