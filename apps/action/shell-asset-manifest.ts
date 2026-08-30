// The action app's SHELL inventory — what the menu sounds, loaded outside a
// match (§4.25).
//
// A separate file from `asset-manifest.ts`, and the separation is a build fact
// rather than taste: `validate-assets` tells a shell inventory from a match one
// by the file's NAME, and the two shell payload fields that carry one
// (`shellBackgroundAssets`, `shellAudioAssets`) resolve against owners the match
// manager is not inside. The background renders r3f geometry with plain
// materials and loads no file, so only `shellAudioAssets` is forwarded from
// `renderer/loaders.ts`; this manifest is the audio one.
//
// Both clips are `critical`, so the shell session's own warm-up decodes them
// before the menu needs them: a bed that streamed in after the menu painted
// would start late, and a blip that decoded on the first click would miss it.
//
// Module boundary: `@chimera-engine/simulation` content contracts and this
// app's own constants. No renderer, no electron.

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import { audioClipEntry } from '@chimera-engine/simulation/content/audioManifest.js';

import { ACTION_GAME_ID } from './simulation/constants.js';

/**
 * The two clips the shell plays.
 *
 * Both are synthesised 44.1 kHz mono 16-bit PCM, committed as-is:
 *
 *   - `menuBed` — a 2.000 s drone of three sine partials at 110 / 220 / 330 Hz,
 *     ramped in over the first 0.25 s and out over the last. Its loop body
 *     (0.25 s → 1.75 s) is 1.5 s long, which holds 165 / 330 / 495 WHOLE cycles
 *     of those three partials, so the wrap is sample-continuous rather than a
 *     click once a second.
 *   - `select` — a 0.120 s 880 Hz sine under an exponential decay: a dry UI tick
 *     with no tail, so two quick picks do not overlap into a smear.
 *
 * What `shell-asset-manifest.test.ts` measures against the bytes on disk — by
 * reading the RIFF header rather than trusting this comment — is written there.
 */
export const actionShellAudioRefs = {
    menuBed: 'action/audio/music/menu-bed.wav' as AssetRef<AudioClipAsset>,
    select: 'action/audio/sfx/select.wav' as AssetRef<AudioClipAsset>,
} as const;

/**
 * The menu bed's cue offsets, in seconds.
 *
 * A MIRROR of the literals authored inline in the manifest below, not their
 * source: Invariant #125 makes a cue sheet the build gate cannot statically read
 * a hard failure, and an `actionShellMusicCues.loopStart` reference is exactly as
 * unreadable to it as a spread or a computed key — so the entry must carry bare
 * numeric literals. Keeping the mirror is what makes the duplication safe: it is
 * the value `shell-asset-manifest.test.ts` checks the inline sheet and the `.wav`
 * on disk against, so a number changed in one place and not the others reds
 * rather than mis-timing a cue at runtime.
 *
 * `outro` is the load-bearing one. `ShellAudioSession` looks for exactly that
 * cue on the declared bed and, finding it, hands the menu off to the match with
 * a CUE-ALIGNED fade instead of a fade timed from the moment the player pressed
 * Start — so the bed leaves on its own musical boundary (§4.25, F85).
 */
export const actionShellMusicCues = {
    /** End of the fade-in ramp; the bed is at full amplitude from here. */
    intro: 0.25,
    loopStart: 0.25,
    loopEnd: 1.75,
    /** Start of the tail — where the menu→match handoff begins. */
    outro: 1.75,
    durationSeconds: 2,
} as const;

export const actionShellAssetManifest: AssetManifest = {
    gameId: ACTION_GAME_ID,
    entries: [
        audioClipEntry({
            ref: actionShellAudioRefs.menuBed,
            priority: 'critical',
            metadata: {
                cues: { intro: 0.25, loopStart: 0.25, loopEnd: 1.75, outro: 1.75 },
                defaultLoopRegion: ['loopStart', 'loopEnd'],
                durationSeconds: 2,
            },
        }),
        // No sheet: a 120 ms tick has no intro, no loop and no tail to name, and
        // an entry with `cues` would owe a `durationSeconds` for nothing to read.
        audioClipEntry({ ref: actionShellAudioRefs.select, priority: 'critical' }),
    ],
};
