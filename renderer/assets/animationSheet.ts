/**
 * renderer/assets/animationSheet.ts
 *
 * The renderer-side readers of the opaque animation clip sheet a game authors
 * onto an `AssetManifestEntry.metadata` slot.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * These are the structural twins of `renderer/audio/audioCueSheet.ts`: `unknown`
 * in, a freshly-built object out, `null` for absent or malformed data, and
 * warnings RETURNED rather than logged — so "one warning per unusable mark"
 * stays a pure, synchronous property of the return value instead of something a
 * console spy has to count. Nothing here throws.
 *
 * **What "rebuilt" covers, and where it stops.** Every record and every mark
 * object is allocated here, so a game's authored sheet and the value the player
 * walks share no mutable structure — except the authored POSITIONS (`at`,
 * `from`, `to`), which are carried by reference, unexamined. Positions are
 * resolved by `renderer/animation/ClipPosition.ts`; the case that pins the pass
 * through is `carries an authored position through unexamined, however
 * nonsensical`.
 *
 * **Which side of the boundary decides what.** The clip map, the mark maps and
 * every scalar field are decided here. The beat window is checked for shape only
 * — that it is a pair of ascending non-negative integers; whether it AGREES with
 * `from`/`to` is `simulation/content/animationWindows.ts`'s answer, taken at
 * content load against the game's own `tickRateMs`, which the renderer does not
 * have.
 *
 * This module is a pure reader: no three.js, no React, no DOM, no logger.
 */

import type {
    AnimationClipName,
    AnimationLoopMode,
    AnimationMarkName,
    AnimationNotify,
    AnimationPassage,
    AnimationTrackSheet,
    ClipPosition,
    ModelAnimationMetadata,
    SpriteAnimationMetadata,
    SpriteClipDeclaration,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

/**
 * A parsed sheet, paired with every authoring fault found while parsing it.
 *
 * The two travel together because a caller that wants the sheet almost always
 * wants to surface the faults once, at the point it decides where warnings go.
 */
export interface ParsedAnimationSheet<TSheet> {
    /** The rebuilt sheet. Present even when every clip in it was dropped. */
    readonly sheet: TSheet;
    /** At most one string per unusable clip, mark or field. Never empty strings. */
    readonly warnings: readonly string[];
}

/** What {@link parseModelAnimationMetadata} answers with. */
export type ParsedModelAnimationSheet = ParsedAnimationSheet<ModelAnimationMetadata>;

/** What {@link parseSpriteAnimationMetadata} answers with. */
export type ParsedSpriteAnimationSheet = ParsedAnimationSheet<SpriteAnimationMetadata>;

/** The loop modes a sheet may author. Any other value is dropped with a warning. */
const LOOP_MODES: readonly AnimationLoopMode[] = ['once', 'loop'];

/**
 * Read a mesh model's clip sheet out of the opaque `metadata` slot.
 *
 * Returns `null` when there is no sheet to read at all — the metadata is absent,
 * is not an object, or carries no `clips` map. A sheet whose every clip is
 * unusable parses to an EMPTY clip map instead, which is a different answer: the
 * game did author a sheet, and the warnings say what went wrong with it.
 */
export function parseModelAnimationMetadata(metadata: unknown): ParsedModelAnimationSheet | null {
    return parseSheet(metadata, parseTrackSheet);
}

/**
 * Read a sprite sheet's clip sheet out of the opaque `metadata` slot.
 *
 * Identical to {@link parseModelAnimationMetadata} but for one extra, mandatory
 * field: `frames`, the atlas frame indices the clip plays in order. A sprite clip
 * without a usable frame run is dropped rather than kept, because there is
 * nothing for it to show.
 */
export function parseSpriteAnimationMetadata(metadata: unknown): ParsedSpriteAnimationSheet | null {
    return parseSheet(metadata, parseSpriteClip);
}

// ─── internals ──────────────────────────────────────────────────────────────────

/**
 * Parses one clip's record, or returns `null` to drop it. Appends its own
 * warnings. The record gate is the caller's, so no parser repeats it.
 */
type ClipParser<TClip> = (
    clipName: AnimationClipName,
    rawClip: Readonly<Record<string, unknown>>,
    warnings: string[],
) => TClip | null;

function parseSheet<TClip extends AnimationTrackSheet>(
    metadata: unknown,
    parseClip: ClipParser<TClip>,
): ParsedAnimationSheet<{ readonly clips?: Readonly<Record<AnimationClipName, TClip>> }> | null {
    if (!isPlainObject(metadata)) {
        return null;
    }
    const rawClips = metadata['clips'];
    if (!isPlainObject(rawClips)) {
        return null;
    }

    const warnings: string[] = [];
    const clips: [AnimationClipName, TClip][] = [];
    for (const [clipName, rawClip] of Object.entries(rawClips)) {
        if (!isPlainObject(rawClip)) {
            warnings.push(`Animation clip '${clipName}' is not an object; dropping the clip.`);
            continue;
        }
        const clip = parseClip(clipName, rawClip, warnings);
        if (clip !== null) {
            clips.push([clipName, clip]);
        }
    }

    return { sheet: { clips: fromEntries(clips) }, warnings };
}

function parseTrackSheet(
    clipName: AnimationClipName,
    rawClip: Readonly<Record<string, unknown>>,
    warnings: string[],
): AnimationTrackSheet {
    const sheet: {
        durationSeconds?: number;
        frameCount?: number;
        loop?: AnimationLoopMode;
        notifies?: Readonly<Record<AnimationMarkName, AnimationNotify>>;
        passages?: Readonly<Record<AnimationMarkName, AnimationPassage>>;
    } = {};

    const rawDuration = rawClip['durationSeconds'];
    if (rawDuration !== undefined) {
        if (isFinitePositive(rawDuration)) {
            sheet.durationSeconds = rawDuration;
        } else {
            warnings.push(
                `Animation clip '${clipName}' declares a durationSeconds that is not a finite positive number; dropping the field.`,
            );
        }
    }

    const rawFrameCount = rawClip['frameCount'];
    if (rawFrameCount !== undefined) {
        if (isPositiveInteger(rawFrameCount)) {
            sheet.frameCount = rawFrameCount;
        } else {
            warnings.push(
                `Animation clip '${clipName}' declares a frameCount that is not a positive whole number; dropping the field.`,
            );
        }
    }

    const rawLoop = rawClip['loop'];
    if (rawLoop !== undefined) {
        if (isLoopMode(rawLoop)) {
            sheet.loop = rawLoop;
        } else {
            warnings.push(
                `Animation clip '${clipName}' declares a loop mode that is neither 'once' nor 'loop'; dropping the field.`,
            );
        }
    }

    const notifies = parseMarks(clipName, 'notifies', rawClip['notifies'], warnings, parseNotify);
    if (notifies !== undefined) {
        sheet.notifies = notifies;
    }

    const passages = parseMarks(clipName, 'passages', rawClip['passages'], warnings, parsePassage);
    if (passages !== undefined) {
        sheet.passages = passages;
    }

    return sheet;
}

function parseSpriteClip(
    clipName: AnimationClipName,
    rawClip: Readonly<Record<string, unknown>>,
    warnings: string[],
): SpriteClipDeclaration | null {
    const sheet = parseTrackSheet(clipName, rawClip, warnings);

    const rawFrames = rawClip['frames'];
    if (!Array.isArray(rawFrames) || rawFrames.length === 0 || !rawFrames.every(isFrameIndex)) {
        warnings.push(
            `Sprite clip '${clipName}' declares no usable frames run; dropping the clip.`,
        );
        return null;
    }

    return { ...sheet, frames: [...rawFrames] };
}

/**
 * Parses one `notifies` / `passages` map.
 *
 * Returns `undefined` both for an absent map and for a malformed one — the
 * difference is the warning, and the caller has nothing else to do with either.
 */
function parseMarks<TMark>(
    clipName: AnimationClipName,
    field: 'notifies' | 'passages',
    rawMarks: unknown,
    warnings: string[],
    parseMark: (
        clipName: AnimationClipName,
        markName: AnimationMarkName,
        rawMark: Readonly<Record<string, unknown>>,
        warnings: string[],
    ) => TMark | null,
): Readonly<Record<AnimationMarkName, TMark>> | undefined {
    if (rawMarks === undefined) {
        return undefined;
    }
    if (!isPlainObject(rawMarks)) {
        warnings.push(
            `Animation clip '${clipName}' declares ${field} that is not an object; dropping them.`,
        );
        return undefined;
    }

    const marks: [AnimationMarkName, TMark][] = [];
    for (const [markName, rawMark] of Object.entries(rawMarks)) {
        if (!isPlainObject(rawMark)) {
            warnings.push(
                `Animation mark '${clipName}.${markName}' is not an object; dropping the mark.`,
            );
            continue;
        }
        const mark = parseMark(clipName, markName, rawMark, warnings);
        if (mark !== null) {
            marks.push([markName, mark]);
        }
    }
    return fromEntries(marks);
}

function parseNotify(
    clipName: AnimationClipName,
    markName: AnimationMarkName,
    rawMark: Readonly<Record<string, unknown>>,
    warnings: string[],
): AnimationNotify | null {
    const at = rawMark['at'];
    if (at === undefined) {
        warnings.push(
            `Animation notify '${clipName}.${markName}' declares no position; dropping the mark.`,
        );
        return null;
    }
    return { at: at as ClipPosition };
}

function parsePassage(
    clipName: AnimationClipName,
    markName: AnimationMarkName,
    rawMark: Readonly<Record<string, unknown>>,
    warnings: string[],
): AnimationPassage | null {
    const from = rawMark['from'];
    const to = rawMark['to'];
    if (from === undefined || to === undefined) {
        warnings.push(
            `Animation passage '${clipName}.${markName}' declares no from/to span; dropping the mark.`,
        );
        return null;
    }

    const passage: {
        from: ClipPosition;
        to: ClipPosition;
        beatWindow?: readonly [number, number];
        window?: string;
    } = { from: from as ClipPosition, to: to as ClipPosition };

    const rawBeatWindow = rawMark['beatWindow'];
    if (rawBeatWindow !== undefined) {
        const beatWindow = readBeatWindow(rawBeatWindow);
        if (beatWindow === null) {
            warnings.push(
                `Animation passage '${clipName}.${markName}' declares a beatWindow that is not an ascending pair of whole beats; dropping the field.`,
            );
        } else {
            passage.beatWindow = beatWindow;
        }
    }

    const rawWindow = rawMark['window'];
    if (rawWindow !== undefined) {
        if (typeof rawWindow === 'string' && rawWindow.length > 0) {
            passage.window = rawWindow;
        } else {
            warnings.push(
                `Animation passage '${clipName}.${markName}' declares a window id that is not a non-empty string; dropping the field.`,
            );
        }
    }

    return passage;
}

/** A fresh `[start, end]` tuple, or `null` when the authored value is not one. */
function readBeatWindow(value: unknown): readonly [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) {
        return null;
    }
    const [start, end] = value as readonly unknown[];
    if (!isNonNegativeInteger(start) || !isNonNegativeInteger(end) || end <= start) {
        return null;
    }
    return [start, end];
}

/**
 * Builds a record from entries.
 *
 * `Object.fromEntries` defines own properties, so a clip or mark a game happens
 * to name `'__proto__'` becomes a key of the result. Plain assignment would
 * instead write the result's prototype and lose the entry — and the names here
 * arrive through an `unknown` slot, so they are data, not identifiers.
 */
function fromEntries<TValue>(
    entries: readonly (readonly [string, TValue])[],
): Readonly<Record<string, TValue>> {
    return Object.fromEntries(entries);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFrameIndex(value: unknown): value is number {
    return isNonNegativeInteger(value);
}

function isLoopMode(value: unknown): value is AnimationLoopMode {
    return LOOP_MODES.some((mode) => mode === value);
}
