import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type {
    AssetRef,
    AudioClipAsset,
    GLTFModelAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import { audioClipEntry } from '@chimera-engine/simulation/content/audioManifest.js';
import { modelAnimationEntry } from '@chimera-engine/simulation/content/animationManifest.js';

/**
 * The showcase rigs (model seam adoption, §4.10): self-contained `.glb` files —
 * embedded buffer, no textures — each holding a two-bone skinned quad with an
 * unlit magenta material. No gameplay screen mounts either one.
 *
 * `showcaseRig` carries NO animation, which is what makes the pair a proof
 * rather than a demo: it is mounted twice on the `/model-showcase/` test route
 * to show that independence comes from `useModelInstance`'s per-mount clone.
 * `showcaseRigAnimated` carries one clip, `wave`, and is the model the clip
 * player drives. It is GENERATED — `tools/gen-showcase-animated-glb.ts`, gated
 * by `pnpm verify:showcase-glb` — because a `.glb` cannot be reviewed, so the
 * only honest way to state what it contains is a program that emits it.
 */
export const tacticsModelRefs = {
    showcaseRig: 'tactics/models/showcase-rig.glb' as AssetRef<GLTFModelAsset>,
    showcaseRigAnimated: 'tactics/models/showcase-rig-animated.glb' as AssetRef<GLTFModelAsset>,
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

/**
 * The `wave` clip's sheet values, mirrored out of the manifest entry below.
 *
 * A MIRROR, not the source, for the same reason `tacticsMusicCues` is one: the
 * build gate reads the sheet as SYNTAX, so a `tacticsShowcaseClip.durationSeconds`
 * reference is exactly as unreadable to it as a spread or a computed key. The
 * entry must therefore carry bare numeric literals, and this constant is what
 * makes that duplication safe — `asset-manifest.test.ts` checks the inline sheet,
 * this mirror, and the committed `.glb` against each other, so a number changed
 * in one place and not the others reds instead of desynchronising a marker from
 * the motion it is meant to land on.
 *
 * The two halves of the passage are authored in DIFFERENT units on purpose:
 * `from`/`to` are normalized phases (what the renderer plays) and `beatWindow`
 * is beat integers (what the simulation would open). They are reconciled by
 * `compileAnimationWindows` at content load — see `content/tacticsAnimations.ts`
 * — never derived from one another, so the host's `tickRateMs` cannot silently
 * resize the window.
 */
export const tacticsShowcaseClip = {
    /** The clip name baked into the `.glb`, and the key `useClipPlayer` plays. */
    name: 'wave',
    /** The clip's real length, which the generated container's sampler input maxes at. */
    durationSeconds: 1,
    /** The notify's offset from the clip start — strictly inside the clip. */
    notifySeconds: 0.5,
    /** The passage span, as normalized phases of the clip. */
    passageFromPhase: 0.25,
    passageToPhase: 0.75,
    /** The same span as beat integers, at the engine's default 50 ms beat. */
    passageBeatWindow: [5, 15],
    /** The gameplay window id the passage claims while it is open. */
    windowName: 'showcase-swing',
    /** The passage's own mark name — its key in the clip's `passages` record. */
    passageName: 'swing',
    /** The notify's own mark name. */
    notifyName: 'crest',
} as const;

export const tacticsAssetManifest: AssetManifest = {
    gameId: 'tactics',
    entries: [
        // Deferred: the showcase rig loads on demand through useModelInstance
        // when the /model-showcase/ route mounts, not during scene preload —
        // no gameplay scene needs it.
        { ref: tacticsModelRefs.showcaseRig, kind: 'gltf-model', priority: 'deferred' },
        // The animated twin, with its clip sheet inline — see
        // `tacticsShowcaseClip` above for why the numbers are written out here
        // rather than referenced.
        modelAnimationEntry({
            ref: tacticsModelRefs.showcaseRigAnimated,
            priority: 'deferred',
            metadata: {
                clips: {
                    wave: {
                        durationSeconds: 1,
                        loop: 'loop',
                        notifies: { crest: { at: { seconds: 0.5 } } },
                        passages: {
                            swing: {
                                from: 0.25,
                                to: 0.75,
                                beatWindow: [5, 15],
                                window: 'showcase-swing',
                            },
                        },
                    },
                },
            },
        }),
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
