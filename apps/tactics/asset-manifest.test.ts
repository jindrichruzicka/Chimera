/**
 * apps/tactics/asset-manifest.test.ts
 *
 * Tactics is the reference adopter of the cue-sheet authoring surface (§4.25).
 * Three things are worth pinning here.
 *
 * First, the sheet is authored through `audioClipEntry` (Invariant #124's sanctioned
 * builder) rather than a hand-written `metadata` key, and `validate-assets`
 * range-checks it at build time (Invariant #125). Those checks compare each cue
 * against the sheet's OWN `durationSeconds` — a self-consistent sheet whose
 * `durationSeconds` is simply wrong about the file passes the build and then
 * silently mis-times every cue at runtime, because the renderer clamps against the
 * DECODED buffer instead. So the assertion that matters is the one the build gate
 * structurally cannot make: the authored `durationSeconds` equals the real length
 * of the `.wav` on disk, read from its RIFF header.
 *
 * Second, the loop region must be seamless. `loopStart`/`loopEnd` land on sample
 * indices whose amplitudes match, so a wrap produces no click — the clips are
 * synthesised with every partial an integer multiple of `1 / (loopEnd - loopStart)`
 * precisely so this holds, and a regenerated or re-encoded clip that broke it would
 * otherwise only be audible.
 *
 * Third, `showcase-rig.glb` is a binary: it cannot be diffed or grepped, so what the
 * model-showcase screen says ABOUT it — the unlit extension it relies on to need no
 * lights, the `top` bone it poses BY NAME, the embedded buffer and absent textures
 * that make it self-contained, the quad extents its camera frustum is sized to hold
 * — is checkable only by parsing the container. That is done at the bottom of this
 * file; see the docblock there for what the model-instances e2e already covers and
 * what it does not.
 *
 * Fourth, and for the same reason one level up: `showcase-rig-animated.glb` carries
 * two CLIPS, and the manifest authors a sheet for each. Every field of those sheets
 * — a clip's name, its length, where a mark sits inside it — is a claim about
 * bytes no build gate opens, so the last section reads the container and compares.
 *
 * The readers themselves are the engine's published ones
 * (`@chimera-engine/electron/test-support`): the parsing is what is easy to get
 * subtly wrong, and a game's copy of it would drift from the games it is supposed
 * to represent.
 */

import { describe, it, expect } from 'vitest';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assetPathForRef,
    readGlbDocument,
    readWavFacts,
} from '@chimera-engine/electron/test-support';

import {
    tacticsAssetManifest,
    tacticsAudioRefs,
    tacticsModelRefs,
    tacticsMusicCues,
    tacticsShowcaseLeanClip,
    tacticsShowcaseWaveClip,
} from './asset-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve a ref the same way the runtime resolver does, from the ref itself. */
const readWav = (ref: string) => readWavFacts(assetPathForRef(here, ref));

const MUSIC_CLIPS = [
    { name: 'calm', ref: tacticsAudioRefs.ambienceCalm },
    { name: 'tense', ref: tacticsAudioRefs.ambienceTense },
] as const;

describe('Tactics asset manifest — cue-sheet adoption', () => {
    it('declares every audio ref exactly once, and the music refs among them', () => {
        const refs = tacticsAssetManifest.entries.map((entry) => entry.ref);
        expect(new Set(refs).size).toBe(refs.length);
        for (const ref of Object.values(tacticsAudioRefs)) {
            expect(refs).toContain(ref);
        }
    });

    it.each(MUSIC_CLIPS)(
        'attaches a cue sheet to the $name ambience entry via audioClipEntry',
        ({ ref }) => {
            const entry = tacticsAssetManifest.entries.find((candidate) => candidate.ref === ref);
            expect(entry).toBeDefined();
            expect(entry?.kind).toBe('audio-clip');
            // Cue-sheet-bearing entries preload: a music bed that has to decode on
            // first use cannot fade in on time (priority is the only lever there).
            expect(entry?.priority).toBe('critical');
            expect(entry?.metadata).toEqual({
                cues: {
                    intro: tacticsMusicCues.intro,
                    loopStart: tacticsMusicCues.loopStart,
                    loopEnd: tacticsMusicCues.loopEnd,
                    outro: tacticsMusicCues.outro,
                },
                defaultLoopRegion: ['loopStart', 'loopEnd'],
                durationSeconds: tacticsMusicCues.durationSeconds,
            });
        },
    );

    it.each(MUSIC_CLIPS)(
        "the $name sheet's durationSeconds is the real length of the file on disk",
        ({ ref }) => {
            const wav = readWav(ref);
            // The gate compares cues against the AUTHORED duration; only this compares
            // the authored duration against the ASSET. Exact, not approximate: the clip
            // is synthesised to a whole number of frames at this length.
            expect(wav.durationSeconds).toBe(tacticsMusicCues.durationSeconds);
        },
    );

    it.each(MUSIC_CLIPS)('the $name cues land on whole sample frames', ({ ref }) => {
        const wav = readWav(ref);
        for (const seconds of [
            tacticsMusicCues.intro,
            tacticsMusicCues.loopStart,
            tacticsMusicCues.loopEnd,
            tacticsMusicCues.outro,
        ]) {
            expect(Number.isInteger(seconds * wav.sampleRate)).toBe(true);
        }
    });

    it.each(MUSIC_CLIPS)('the $name loop region wraps without a discontinuity', ({ ref }) => {
        const wav = readWav(ref);
        // `sampleAt` reads 16-bit LE and the tolerance below is stated in 16-bit LSBs;
        // both are silently wrong for any other encoding.
        expect(wav.bitsPerSample).toBe(16);
        expect(wav.channels).toBe(1);
        // The manifest comment states the cue offsets land on whole frames "at
        // 44.1 kHz"; a re-encode to 48 kHz keeps every other assertion green.
        expect(wav.sampleRate).toBe(44100);
        const startFrame = tacticsMusicCues.loopStart * wav.sampleRate;
        const endFrame = tacticsMusicCues.loopEnd * wav.sampleRate;
        expect(endFrame).toBeLessThan(wav.frames);
        // Identical amplitude AND identical local slope: matching one sample can happen
        // by coincidence at a zero crossing, matching the step into the next cannot.
        expect(wav.sampleAt(endFrame)).toBe(wav.sampleAt(startFrame));
        // Within a couple of LSBs: the two steps are the same curve sampled at the
        // same phase, and only 16-bit rounding separates them.
        const wrapStep = wav.sampleAt(endFrame + 1) - wav.sampleAt(endFrame);
        const loopStep = wav.sampleAt(startFrame + 1) - wav.sampleAt(startFrame);
        expect(Math.abs(wrapStep - loopStep)).toBeLessThanOrEqual(2);
    });

    // A plain `it`: the shared sheet is one value, so running this per clip would
    // report one assertion's worth of work as two clips' worth of coverage.
    it('orders the shared cue offsets inside the clip', () => {
        const { intro, loopStart, loopEnd, outro, durationSeconds } = tacticsMusicCues;
        expect(intro).toBeGreaterThanOrEqual(0);
        expect(loopStart).toBeGreaterThanOrEqual(intro);
        expect(loopEnd).toBeGreaterThan(loopStart);
        expect(outro).toBeGreaterThanOrEqual(loopEnd);
        expect(durationSeconds).toBeGreaterThanOrEqual(outro);
    });
});

/**
 * The showcase rig, read out of its own container.
 *
 * Each assertion below restates a claim some OTHER file makes in prose:
 * `TacticsModelShowcaseScreen` mounts no lights and says the material is unlit;
 * `TacticsModelShowcase` looks a bone up by the name `top`; the manifest calls the
 * file self-contained; the showcase camera's frustum is sized to the quads'
 * authored extents.
 *
 * These are not the only thing standing between a bad re-export and a merge:
 * `e2e/tests/model-instances.spec.ts` reddens on several of them too — a renamed
 * bone reports `NaN` for the pose, a lit material renders black in an unlit scene,
 * and a buffer that grew a `uri` fails to fetch and surfaces as a model error. It
 * gets there by launching Electron and comparing a pixel or an attribute, which
 * says the frame is wrong without saying why. These read the fact off the bytes,
 * and name it.
 */
describe('Tactics asset manifest — the showcase rig container', () => {
    const rig = () => readGlbDocument(assetPathForRef(here, tacticsModelRefs.showcaseRig));

    it('declares the unlit extension the showcase screen mounts no lights for', () => {
        // GLTFLoader maps KHR_materials_unlit to MeshBasicMaterial. Lose the
        // extension and the quads become lit — in a scene with no light, black.
        expect(rig().extensionsUsed).toContain('KHR_materials_unlit');
    });

    it('carries the bone the showcase poses BY NAME', () => {
        // `getObjectByName('top')` returns undefined on a rename, and the pose is
        // then simply skipped: the e2e reads a bone rotation that never changed.
        expect(rig().nodes?.map((node) => node.name)).toContain('top');
    });

    it('embeds its buffer and references no texture', () => {
        // A `uri` on a buffer, or any image, is a SECOND file to resolve over
        // `chimera://` — one the manifest does not declare and validate-assets
        // therefore never checks for existence.
        const document = rig();
        expect(document.buffers ?? []).not.toHaveLength(0);
        for (const buffer of document.buffers ?? []) {
            expect(buffer.uri).toBeUndefined();
        }
        expect(document.images ?? []).toHaveLength(0);
        expect(document.textures ?? []).toHaveLength(0);
    });

    it('authors the quads at the extents the showcase camera is sized for', () => {
        // TacticsModelShowcaseScreen states the extents as "x ±0.45, y 0→1.4" and
        // sizes SHOWCASE_CAMERA's frustum (±3.4 × ±2.125, centred at y 0.7) to
        // hold all four instances plus the posed one's swing. A rig re-exported
        // at another scale would render off-frame or hairline-small with nothing
        // else red.
        const document = rig();
        const positionAccessors = (document.meshes ?? [])
            .flatMap((mesh) => mesh.primitives)
            .map((primitive) => primitive.attributes['POSITION'])
            .filter((index): index is number => index !== undefined)
            .map((index) => document.accessors?.[index]);

        expect(positionAccessors).not.toHaveLength(0);
        for (const accessor of positionAccessors) {
            // glTF POSITION accessors are required to carry min/max, so their
            // absence is itself a malformed rig rather than a skipped assertion.
            expect(accessor?.min).toBeDefined();
            expect(accessor?.max).toBeDefined();
            const [minX, minY] = accessor?.min ?? [];
            const [maxX, maxY] = accessor?.max ?? [];
            expect(Math.abs(minX ?? 0)).toBeCloseTo(0.45, 5);
            expect(maxX).toBeCloseTo(0.45, 5);
            expect(minY).toBeCloseTo(0, 5);
            expect(maxY).toBeCloseTo(1.4, 5);
        }
    });
});

/**
 * The ANIMATED showcase rig, and the agreement between the clips inside it and
 * the sheets the manifest authors for them.
 *
 * A clip sheet names a clip, a length and positions inside it. Every one of
 * those is a claim about bytes no build gate opens: `validate-assets` checks the
 * sheet is SELF-consistent (Invariant #125) and that the file exists (Invariant
 * #52), and `compileAnimationWindows` checks the authored beat window against
 * the authored phases — all three read the sheet, none reads the model. A
 * re-export that
 * renamed a clip, shortened it, or dropped the animated bone leaves every gate
 * green and the marker firing at the wrong instant, or not at all.
 *
 * These read that agreement off the container. The fixture is generated
 * (`tools/gen-showcase-animated-glb.ts`) and its bytes are gated by
 * `pnpm verify:showcase-glb`, so what is checked here is the AUTHORING, not the
 * generator: a manifest number changed without the generator, or the reverse.
 */
describe('Tactics asset manifest — the animated showcase clips', () => {
    const animatedRig = () =>
        readGlbDocument(assetPathForRef(here, tacticsModelRefs.showcaseRigAnimated));

    /** The animation the container declares under `name`. */
    const animationNamed = (name: string) => {
        const animation = (animatedRig().animations ?? []).find(
            (candidate) => candidate.name === name,
        );
        expect(animation, `the animated rig declares no clip named '${name}'`).toBeDefined();
        return animation!;
    };

    /** The sheets the manifest entry carries, read back out of the entry. */
    const clipSheets = (): Readonly<Record<string, { readonly blendInSeconds?: number }>> => {
        const entry = tacticsAssetManifest.entries.find(
            (candidate) => candidate.ref === tacticsModelRefs.showcaseRigAnimated,
        );
        return (
            (entry?.metadata as { clips?: Record<string, { blendInSeconds?: number }> })?.clips ??
            {}
        );
    };

    /** Both clips, each paired with the mirror of its own sheet. */
    const CLIPS = [
        { name: tacticsShowcaseWaveClip.name, sheet: tacticsShowcaseWaveClip },
        { name: tacticsShowcaseLeanClip.name, sheet: tacticsShowcaseLeanClip },
    ] as const;

    it('declares the animated rig once, through modelAnimationEntry, with both sheets inline', () => {
        const entry = tacticsAssetManifest.entries.find(
            (candidate) => candidate.ref === tacticsModelRefs.showcaseRigAnimated,
        );

        expect(entry).toBeDefined();
        expect(entry?.kind).toBe('gltf-model');
        // Deferred like its unanimated twin: the showcase route loads on demand
        // and no gameplay scene needs either model.
        expect(entry?.priority).toBe('deferred');
        expect(entry?.metadata).toEqual({
            clips: {
                [tacticsShowcaseWaveClip.name]: {
                    durationSeconds: tacticsShowcaseWaveClip.durationSeconds,
                    loop: 'loop',
                    notifies: {
                        [tacticsShowcaseWaveClip.notifyName]: {
                            at: { seconds: tacticsShowcaseWaveClip.notifySeconds },
                        },
                    },
                    passages: {
                        [tacticsShowcaseWaveClip.passageName]: {
                            from: tacticsShowcaseWaveClip.passageFromPhase,
                            to: tacticsShowcaseWaveClip.passageToPhase,
                            beatWindow: tacticsShowcaseWaveClip.passageBeatWindow,
                            window: tacticsShowcaseWaveClip.windowName,
                        },
                    },
                },
                [tacticsShowcaseLeanClip.name]: {
                    durationSeconds: tacticsShowcaseLeanClip.durationSeconds,
                    loop: 'loop',
                    blendInSeconds: tacticsShowcaseLeanClip.blendInSeconds,
                    passages: {
                        [tacticsShowcaseLeanClip.passageName]: {
                            from: tacticsShowcaseLeanClip.passageFromPhase,
                            to: tacticsShowcaseLeanClip.passageToPhase,
                            beatWindow: tacticsShowcaseLeanClip.passageBeatWindow,
                            window: tacticsShowcaseLeanClip.windowName,
                        },
                    },
                },
            },
        });
    });

    it('authors a blend length on the incoming clip alone', () => {
        // The asymmetry is what makes the SHEET-resolved blend reachable from a
        // game at all: the showcase screen names no `blendSeconds`, so a
        // transition into `lean` blends for exactly as long as this field says,
        // and the way back is a cut. A `blendInSeconds` on both clips would
        // still blend — and would no longer say which value did it.
        const sheets = clipSheets();

        expect(sheets[tacticsShowcaseLeanClip.name]?.blendInSeconds).toBe(
            tacticsShowcaseLeanClip.blendInSeconds,
        );
        expect(sheets[tacticsShowcaseWaveClip.name]?.blendInSeconds).toBeUndefined();
    });

    it.each(CLIPS)('names the $name clip the sheet marks and the screen plays', ({ name }) => {
        // `useClipPlayer` looks the clip up by name on the loaded model. A
        // rename here reports "not a playable clip" at runtime and nowhere else.
        expect(animationNamed(name).name).toBe(name);
    });

    it.each(CLIPS)(
        "the $name sheet's durationSeconds is that clip's real length",
        ({ name, sheet }) => {
            // The length lives at `accessors[sampler.input].max[0]` — an
            // animation sampler input is required to declare its bounds, which is
            // the only reason a clip's length is knowable without decoding the
            // buffer.
            //
            // Per clip, and that is what makes it worth asserting twice: the two
            // are authored at different lengths, so a sheet carrying the other
            // one's would put every phase-authored mark somewhere it was not
            // written.
            const document = animatedRig();
            const lengths = (animationNamed(name).samplers ?? []).map((sampler) => {
                const input =
                    sampler.input === undefined ? undefined : document.accessors?.[sampler.input];
                return input?.max?.[0];
            });

            expect(lengths).not.toHaveLength(0);
            expect(Math.max(...lengths.map((length) => length ?? 0))).toBe(sheet.durationSeconds);
        },
    );

    it('places the authored notify strictly inside the clip', () => {
        // A notify at or past the end never fires on a 'once' clip and fires at
        // the wrap on a looping one — either way it is not where it was written.
        expect(tacticsShowcaseWaveClip.notifySeconds).toBeGreaterThan(0);
        expect(tacticsShowcaseWaveClip.notifySeconds).toBeLessThan(
            tacticsShowcaseWaveClip.durationSeconds,
        );
    });

    it.each(CLIPS)('opens the $name passage strictly inside its own clip', ({ sheet }) => {
        // Authored as phases, so the bounds are the unit interval. An inverted or
        // collapsed span is DROPPED by `compileClipTimeline` with a warning
        // nothing in a running game reads, and a passage at phase 0 or 1 sits on
        // the wrap.
        expect(sheet.passageFromPhase).toBeGreaterThan(0);
        expect(sheet.passageToPhase).toBeGreaterThan(sheet.passageFromPhase);
        expect(sheet.passageToPhase).toBeLessThan(1);
    });

    it.each(CLIPS)('drives the bone the $name sheet is written against', ({ name }) => {
        // Each passage is a span of a MOTION. A channel targeting some other node
        // leaves the marks firing on a bone that never moves.
        const document = animatedRig();
        const targets = (animationNamed(name).channels ?? []).map(
            (channel) => document.nodes?.[channel.target?.node ?? -1]?.name,
        );

        expect(targets).toContain('top');
    });

    it('is self-contained and unlit, like its unanimated twin', () => {
        const document = animatedRig();

        expect(document.buffers ?? []).not.toHaveLength(0);
        for (const buffer of document.buffers ?? []) {
            expect(buffer.uri).toBeUndefined();
        }
        expect(document.images ?? []).toHaveLength(0);
        expect(document.extensionsUsed).toContain('KHR_materials_unlit');
    });
});
