import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type {
    AssetRef,
    AudioClipAsset,
    GLTFModelAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import { audioClipEntry } from '@chimera-engine/simulation/content/audioManifest.js';

/**
 * The showcase rig (model seam adoption, §4.10): one self-contained `.glb` —
 * embedded buffer, no textures — holding a two-bone skinned quad with an
 * unlit magenta material. Both instances on the `/model-showcase/` test route
 * mount this ONE ref; independence comes from `useModelInstance`'s per-mount
 * clone. No gameplay screen mounts it.
 */
export const tacticsModelRefs = {
    showcaseRig: 'tactics/models/showcase-rig.glb' as AssetRef<GLTFModelAsset>,
} as const;

export const tacticsAudioRefs = {
    step: 'tactics/audio/sfx/step.wav' as AssetRef<AudioClipAsset>,
    swordHit: 'tactics/audio/sfx/sword-hit.wav' as AssetRef<AudioClipAsset>,
    reveal: 'tactics/audio/sfx/reveal.wav' as AssetRef<AudioClipAsset>,
    ambienceCalm: 'tactics/audio/music/ambience-calm.wav' as AssetRef<AudioClipAsset>,
    ambienceTense: 'tactics/audio/music/ambience-tense.wav' as AssetRef<AudioClipAsset>,
} as const;

/**
 * The cue offsets both ambience beds share, in seconds (§4.25).
 *
 * A MIRROR of the literals authored inline in the manifest below, not their source:
 * Invariant #125 makes a cue sheet the build gate cannot statically read a hard
 * failure, and a `tacticsMusicCues.loopStart` reference is exactly as unreadable to
 * it as a spread or a computed key — so the entries must carry bare numeric
 * literals. Keeping the mirror is what makes the duplication safe: it is the value
 * `asset-manifest.test.ts` checks the two inline sheets and the two `.wav` files on
 * disk against, so a number changed in one place and not the others reds rather
 * than mis-timing a cue at runtime.
 *
 * The two clips are cut to the same shape deliberately: a crossfade between them
 * only sounds like one continuous bed if the incoming track's loop body is the same
 * length as the outgoing one's. Every value lands on a whole sample frame at
 * 44.1 kHz, and the loop body (`loopEnd - loopStart`) is exactly the period the
 * clips' partials were synthesised against, so the wrap is sample-continuous.
 */
export const tacticsMusicCues = {
    /** End of the fade-in ramp; the bed is at full amplitude from here. */
    intro: 0.2,
    loopStart: 0.2,
    loopEnd: 1.3,
    /** Start of the tail — only reached when the bed is played without looping. */
    outro: 1.3,
    durationSeconds: 1.5,
} as const;

export const tacticsAssetManifest: AssetManifest = {
    gameId: 'tactics',
    entries: [
        // Deferred: the showcase rig loads on demand through useModelInstance
        // when the /model-showcase/ route mounts, not during scene preload —
        // no gameplay scene needs it.
        { ref: tacticsModelRefs.showcaseRig, kind: 'gltf-model', priority: 'deferred' },
        audioClipEntry({ ref: tacticsAudioRefs.step, priority: 'deferred' }),
        audioClipEntry({ ref: tacticsAudioRefs.swordHit, priority: 'deferred' }),
        audioClipEntry({ ref: tacticsAudioRefs.reveal, priority: 'deferred' }),
        // The beds preload: a deferred music track decodes on first play, and a
        // fade-in scheduled against a buffer that is not there yet starts late.
        //
        // Both sheets are written out in full rather than shared through a const —
        // see `tacticsMusicCues` above for why the gate requires it.
        audioClipEntry({
            ref: tacticsAudioRefs.ambienceCalm,
            priority: 'critical',
            metadata: {
                cues: { intro: 0.2, loopStart: 0.2, loopEnd: 1.3, outro: 1.3 },
                defaultLoopRegion: ['loopStart', 'loopEnd'],
                durationSeconds: 1.5,
            },
        }),
        audioClipEntry({
            ref: tacticsAudioRefs.ambienceTense,
            priority: 'critical',
            metadata: {
                cues: { intro: 0.2, loopStart: 0.2, loopEnd: 1.3, outro: 1.3 },
                defaultLoopRegion: ['loopStart', 'loopEnd'],
                durationSeconds: 1.5,
            },
        }),
    ],
};
