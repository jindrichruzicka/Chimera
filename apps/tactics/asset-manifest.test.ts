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
        // sizes SHOWCASE_CAMERA's frustum (±2.4 × ±1.5, centred at y 0.7) to hold
        // both instances plus the posed one's swing. A rig re-exported at another
        // scale would render off-frame or hairline-small with nothing else red.
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
