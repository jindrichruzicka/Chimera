/**
 * simulation/foundation/animation-clip-sheet.ts
 *
 * The sim-side authoring vocabulary for animation clip sheets: the names a game
 * uses to mark notify points inside a clip and to carve it into sub-passages,
 * so the renderer can fire markers and open/close visual passages, and so the
 * simulation can open the matching beat-denominated gameplay window.
 *
 * A clip sheet is authored as a {@link ModelAnimationMetadata} (mesh) or
 * {@link SpriteAnimationMetadata} (sprite) value and stored in the existing
 * `AssetManifestEntry.metadata` slot (typed `unknown`) — never on the asset's
 * phantom brand, and never on a `THREE.AnimationClip`, which the loader cache
 * shares by reference between every instance of a model. The sheet is
 * structurally OPAQUE to `simulation/`/`ai/`: the simulation constructs and
 * stores it, and verifies its authored beat windows at content load; the sole
 * playback parser/resolver is the renderer. These types are defined here,
 * sim-side, and flow sim → renderer — never the reverse.
 *
 * The visual passage and the mechanical window are authored TWICE — once as
 * clip-relative positions, once as beat integers — and reconciled by
 * `simulation/content/animationWindows.ts` at content load rather than converted
 * into one another at runtime, so the host pacing knob `tickRateMs` never
 * determines how long a gameplay window lasts.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Module boundary (§3): `simulation/foundation/` is the zero-dependency engine
 * leaf. This module is PURE TYPE DECLARATIONS only — zero runtime code, zero
 * workspace imports.
 */

/**
 * The name of a clip within a model's or sprite's sheet. An open `string`: for a
 * mesh it is the `THREE.AnimationClip.name` baked into the glTF; for a sprite it
 * is whatever the game calls the frame run.
 */
export type AnimationClipName = string;

/**
 * The name of a mark inside one clip — a notify point or a sub-passage. Open:
 * games author whatever names suit the clip. Mark names are the KEYS of the
 * {@link AnimationTrackSheet} records.
 */
export type AnimationMarkName = string;

/**
 * The id of the beat-denominated gameplay window a passage declares. Distinct
 * from the passage's own {@link AnimationMarkName}: several passages across
 * several clips may claim the same window id.
 */
export type AnimationWindowName = string;

/**
 * How a clip behaves when its playhead reaches the end.
 *
 * - `'once'` — plays to the end and stops.
 * - `'loop'` — restarts from the beginning, forwards, indefinitely.
 *
 * There is deliberately no ping-pong mode: nothing downstream models a reversing
 * playhead, and a mode the renderer cannot honour is refused at the type level
 * rather than clamped into one of these two later.
 */
export type AnimationLoopMode = 'once' | 'loop';

/**
 * A position inside a clip, authored in whichever unit suits the content:
 *
 * - a bare `number` — a NORMALIZED PHASE in `[0, 1]`;
 * - `{ seconds }` — an absolute offset from the clip start;
 * - `{ frame }` — a zero-based frame index into the clip's frame run.
 *
 * Resolving `{ seconds }` needs no extra data; a phase needs the clip's
 * `durationSeconds`, and `{ frame }` needs both `durationSeconds` and
 * `frameCount`. A position a resolver cannot resolve is an authoring error, not
 * a default.
 */
export type ClipPosition = number | { readonly seconds: number } | { readonly frame: number };

/**
 * A single notify point: an instant inside a clip at which the renderer emits a
 * `notify` event. A notify carries a name (its key in
 * {@link AnimationTrackSheet.notifies}) and a position, and nothing else — a
 * per-mark payload would freeze a shape before a single adopter has used one.
 */
export interface AnimationNotify {
    /** Where in the clip the notify fires. */
    readonly at: ClipPosition;
}

/**
 * A sub-passage of a clip: a span the renderer opens and closes with
 * `passage-start` / `passage-tick` / `passage-end`, optionally paired with the
 * gameplay window the simulation opens for the same span.
 *
 * `beatWindow` is the mechanical half of that pair, authored as
 * `[startBeat, endBeat]` clip-relative integers. It is VERIFIED
 * against `from`/`to` at content load, never derived from them. A passage that
 * omits it is presentation-only: at the default 20 Hz beat a 30 ms flourish
 * needs no gameplay beat at all.
 */
export interface AnimationPassage {
    /** Where the passage opens. */
    readonly from: ClipPosition;
    /** Where the passage closes. */
    readonly to: ClipPosition;
    /** The authored `[startBeat, endBeat]` mechanical span — integers, `≥ 0`. */
    readonly beatWindow?: readonly [number, number];
    /** The gameplay window id this passage claims while it is open. */
    readonly window?: AnimationWindowName;
}

/**
 * One clip's authored sheet.
 *
 * All fields are optional at the type level. `durationSeconds` is mandatory in
 * practice for any clip that authors a phase or frame position, and
 * `frameCount` for any clip that authors a frame; what
 * `compileAnimationWindows` refuses on their absence is measured in
 * `simulation/content/animationWindows.test.ts`.
 */
export interface AnimationTrackSheet {
    /** Clip length in seconds, as authored. Needed to resolve a phase or a frame. */
    readonly durationSeconds?: number;
    /** Number of frames in the clip's run. Needed to resolve a `{ frame }` position. */
    readonly frameCount?: number;
    /** How the clip behaves at its end. Absent means the player decides. */
    readonly loop?: AnimationLoopMode;
    /**
     * Seconds to blend into this clip from whatever was playing.
     *
     * Authored once here rather than at every call site, the move `loop` already
     * makes — "this clip always eases in over 0.2 s" is a property of the clip,
     * not of the moment it is played.
     *
     * It sits on the SHARED sheet rather than on a mesh-only declaration because
     * the compile half is deliberately backend-agnostic: a mesh-only home would
     * teach it the one distinction it exists not to know.
     *
     * Read by NOTHING in `simulation/`, which the census in the co-located test
     * measures. Like every other field here it is carried opaquely in
     * `AssetManifestEntry.metadata`.
     */
    readonly blendInSeconds?: number;
    /** Notify points, keyed by mark name. */
    readonly notifies?: Readonly<Record<AnimationMarkName, AnimationNotify>>;
    /** Sub-passages, keyed by mark name. */
    readonly passages?: Readonly<Record<AnimationMarkName, AnimationPassage>>;
}

/**
 * A mesh model's clip sheet, authored sim-side and carried opaquely in
 * `AssetManifestEntry.metadata` for a `'gltf-model'` entry.
 */
export interface ModelAnimationMetadata {
    /** Clip name → its sheet. A clip absent from this map is simply unmarked. */
    readonly clips?: Readonly<Record<AnimationClipName, AnimationTrackSheet>>;
}

/**
 * A sprite clip's sheet: the shared {@link AnimationTrackSheet} vocabulary plus
 * the atlas frame run the clip plays. `frames` lists atlas frame indices in play
 * order, so a clip may repeat or reorder frames without duplicating atlas cells.
 */
export interface SpriteClipDeclaration extends AnimationTrackSheet {
    /** Atlas frame indices, in play order. */
    readonly frames: readonly number[];
}

/**
 * A sprite sheet's clip sheet, authored sim-side and carried opaquely in
 * `AssetManifestEntry.metadata` for a `'sprite-sheet'` entry.
 */
export interface SpriteAnimationMetadata {
    /** Clip name → its sprite clip declaration. */
    readonly clips?: Readonly<Record<AnimationClipName, SpriteClipDeclaration>>;
}
