/**
 * simulation/foundation/audio-cue-sheet.ts
 *
 * The sim-side authoring vocabulary for audio cue sheets: the names a game uses
 * to mark timestamps inside an audio clip (an intro tail, a loop region, an
 * outro) so the renderer can play from/to a cue and loop between two of them.
 *
 * A cue sheet is authored as an {@link AudioClipMetadata} value and stored in the
 * existing `AssetManifestEntry.metadata` slot (typed `unknown`) — never on the
 * `AudioClipAsset` phantom brand, which decodes to a bare `AudioBuffer` with no
 * sidecar. The sheet is structurally OPAQUE to `simulation/`/`ai/`: the
 * simulation only constructs and stores it; the sole parser/resolver is
 * `renderer/audio`. These types are defined here, sim-side, and flow
 * sim → renderer — never the reverse (Invariant #124, extends #20).
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions
 * (`docs/core-components/audio-system.md`).
 *
 * Module boundary (§3): `simulation/foundation/` is the zero-dependency engine
 * leaf. This module is PURE TYPE DECLARATIONS only — zero runtime code, zero
 * workspace imports.
 */

/**
 * The name of a cue within a clip's sheet. An open `string`: games author
 * whatever names suit the clip. See {@link WellKnownAudioCueName} for the
 * conventional names the engine recognises by convention.
 */
export type AudioCueName = string;

/**
 * The conventional cue names the audio system understands by convention. This
 * is an advisory subset of {@link AudioCueName} — sheets may use any string
 * name, but these four carry shared meaning: `'intro'` (end of the intro / start
 * of the main body), `'loopStart'`/`'loopEnd'` (the default loop region bounds),
 * and `'outro'` (start of the tail).
 */
export type WellKnownAudioCueName = 'intro' | 'loopStart' | 'loopEnd' | 'outro';

/**
 * A clip's cue sheet, authored sim-side and carried opaquely in
 * `AssetManifestEntry.metadata` for an `'audio-clip'` entry (Invariant #124).
 *
 * All fields are optional at the type level. The presence/range rules are NOT
 * encodable in the type and are enforced by `renderer/audio` at parse time and
 * by `validate-assets` at build time (Invariant #125): every cue second must be
 * finite and `≥ 0`; `defaultLoopRegion` names must both exist in `cues` with
 * `end > start`; and a sheet that declares `cues` or `defaultLoopRegion` WITHOUT
 * `durationSeconds` fails the build.
 */
export interface AudioClipMetadata {
    /** Named cues within the clip: cue name → offset in seconds (finite, ≥ 0). */
    readonly cues?: Readonly<Record<AudioCueName, number>>;
    /** Default loop bounds, as `[startCue, endCue]` names present in {@link cues}. */
    readonly defaultLoopRegion?: readonly [AudioCueName, AudioCueName];
    /** Clip length in seconds. MANDATORY when `cues`/`defaultLoopRegion` are present (Invariant #125). */
    readonly durationSeconds?: number;
}
