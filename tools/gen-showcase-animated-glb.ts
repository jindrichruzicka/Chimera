/**
 * Generator + drift gate for the ANIMATED showcase rig
 * (`apps/tactics/assets/models/showcase-rig-animated.glb`).
 *
 * The tactics `/model-showcase/` test route needs a model that actually carries
 * a `THREE.AnimationClip`, because the clip-player adoption has nothing to play
 * otherwise: the rig beside it (`showcase-rig.glb`) was measured to declare
 * `animations === undefined`. A `.glb` is opaque to every text tool in a repo —
 * it cannot be diffed, grepped or reviewed — so committing a second one on the
 * strength of a comment saying what it contains would put the fixture outside
 * the reach of review permanently.
 *
 * This module is that comment made executable. `buildShowcaseAnimatedGlb()`
 * emits the container from readable source numbers, and the committed file is
 * asserted EQUAL to its output byte for byte, by `gen-showcase-animated-glb.test.ts`
 * and by the `--check` arm below.
 *
 * Run modes (CLI):
 *   `tsx tools/gen-showcase-animated-glb.ts`          — (re)write the committed `.glb`.
 *   `tsx tools/gen-showcase-animated-glb.ts --check`  — fail (exit 1) if the committed
 *                                                       bytes have DRIFTED. This is
 *                                                       `verify:showcase-glb`.
 *
 * ## Determinism is a requirement, not a nicety
 *
 * The byte-equality gate is only meaningful if two machines agree on the bytes.
 * ECMAScript leaves `Math.sin`/`Math.cos` implementation-defined, so every
 * quaternion component below is an AUTHORED decimal literal. Float32 rounding is
 * exact and deterministic, so the written bytes follow from those literals alone.
 * Nothing here reads a clock, a random source, or the filesystem.
 *
 * ## What the container holds
 *
 * The same shape as the rig beside it — a two-bone skinned quad with an unlit
 * magenta material and one embedded buffer — plus TWO animations, both rotating
 * the `top` bone about Z: `wave`, which swings it, and `lean`, which holds it
 * over at a rotation the swing never reaches. The rig's node names are kept
 * (`root`, `top`, `showcase-quad`) because the showcase screen finds the posed
 * bone BY NAME, and only the scene root is renamed so the two models are
 * distinguishable in a scene-graph dump.
 *
 * Two clips rather than one because a blend needs somewhere to blend TO, and
 * their ranges are kept apart because that is what makes a blend observable: a
 * bone rotation between the swing's peak and the lean's hold is one neither clip
 * can produce alone, so a frame reading one is a frame in the middle of a
 * transition. `apps/tactics/e2e/tests/animation-blend.spec.ts` is what asks.
 *
 * The pure core is unit-tested; only the file I/O lives in the VITEST-excluded
 * CLI entry (an async IIFE — tsx transforms `tools/*.ts` as CommonJS, and
 * esbuild rejects top-level await in CJS output).
 */

/** Where the generated fixture is committed, relative to the repo root. */
export const SHOWCASE_ANIMATED_GLB_REL_PATH =
    'apps/tactics/assets/models/showcase-rig-animated.glb';

/** The clip's name — the key the manifest sheet marks and `useClipPlayer` plays. */
export const SHOWCASE_ANIMATED_CLIP_NAME = 'wave';

/**
 * The SECOND clip's name — what the showcase screen's toggle blends into.
 *
 * A container with one clip can be played; it cannot be blended, because a
 * blend needs something to blend to. That is the whole reason this one exists.
 */
export const SHOWCASE_ANIMATED_LEAN_CLIP_NAME = 'lean';

/**
 * The bone the clip rotates, and the one `TacticsModelShowcase` poses by name.
 * Shared with the rig beside it on purpose: the showcase screen reads the same
 * name off both models.
 */
export const SHOWCASE_POSED_BONE_NAME = 'top';

/**
 * The clip's keyframe times, in seconds. The last one IS the clip's length, and
 * is what the manifest sheet's `durationSeconds` has to agree with — an
 * agreement `apps/tactics/asset-manifest.test.ts` measures by parsing the
 * container rather than by reading this constant.
 *
 * Five keys at a 0.25 s spacing: enough that a LINEAR sampler produces visible
 * motion between any two sampled frames, few enough to keep the buffer tiny.
 *
 * Every value here is exactly representable in binary floating point, so each
 * survives the float32 the accessor stores it as unchanged. That is not
 * incidental: the accessor's `max` is what a reader calls the clip's length, and
 * at a 0.3 s spacing it comes back as `1.2000000476837158` — a number the
 * manifest cannot author and no equality assertion can state without a tolerance
 * that would also accept a wrong clip.
 */
export const SHOWCASE_ANIMATED_KEY_SECONDS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** The clip's authored length in seconds — the last keyframe time. */
export const SHOWCASE_ANIMATED_DURATION_SECONDS = 1;

/**
 * The `lean` clip's keyframe times, in seconds, and its length.
 *
 * Two keys, because the clip holds ONE rotation for its whole span: a hold needs
 * a start and an end and nothing between them. Both values are exactly
 * representable in binary floating point, for the reason the swing's are.
 */
export const SHOWCASE_ANIMATED_LEAN_KEY_SECONDS: readonly number[] = [0, 0.5];

/** The lean clip's authored length in seconds — its last keyframe time. */
export const SHOWCASE_ANIMATED_LEAN_DURATION_SECONDS = 0.5;

/**
 * The largest Z rotation the `wave` clip reaches, in radians (20°).
 *
 * Stated here as an angle because that is the unit every consumer of this
 * fixture reads it in — the bone rotation a screen writes out, the band an e2e
 * calls a blend. The container states it too: the swing's rotation accessor
 * declares component-wise bounds, and `2·asin(z)` recovers this number from
 * them, which is what keeps this constant a fact about the bytes rather than a
 * comment beside them.
 */
export const SHOWCASE_ANIMATED_SWING_RADIANS = 0.3490658503988659;

/**
 * The Z rotation the `lean` clip holds, in radians (60°).
 *
 * Clear of the swing's peak, and that gap is the point: a bone rotation between
 * the two is one NEITHER clip can pose on its own, so a frame reading one is a
 * frame in the middle of a blend. A lean inside the swing's range would leave
 * that band empty and make a blend unobservable from the bone alone.
 */
export const SHOWCASE_ANIMATED_LEAN_RADIANS = 1.0471975511965976;

/**
 * The `top` bone's rotation at each key, as a quaternion about Z: a swing to
 * +20°, back through rest, out to −20°, and home.
 *
 * Written as literals rather than computed: see the determinism note in the
 * module header. `0.17364817766693033` is sin(10°) and `0.984807753012208` is
 * cos(10°) — half-angles, because a quaternion carries θ/2.
 */
const SWING_QUATERNIONS: readonly (readonly [number, number, number, number])[] = [
    [0, 0, 0, 1],
    [0, 0, 0.17364817766693033, 0.984807753012208],
    [0, 0, 0, 1],
    [0, 0, -0.17364817766693033, 0.984807753012208],
    [0, 0, 0, 1],
];

/**
 * The `top` bone's rotation at each of the lean clip's keys: the same +60° at
 * both, so the clip holds one pose for its whole length.
 *
 * Authored literals for the determinism reason above: `0.5` is sin(30°) and
 * `0.8660254037844387` is cos(30°) — half-angles again.
 */
const LEAN_QUATERNIONS: readonly (readonly [number, number, number, number])[] = [
    [0, 0, 0.5, 0.8660254037844387],
    [0, 0, 0.5, 0.8660254037844387],
];

// ── Geometry ─────────────────────────────────────────────────────────────────
//
// An upright quad in the XY plane facing +Z, sized and placed to match the rig
// beside it so the showcase camera frames both identically. Its bottom edge is
// bound to the `root` bone and its top edge to `top`, which is what makes the
// swing visible rather than a rigid-body rotation of the whole quad.

const HALF_WIDTH = 0.45;
const HEIGHT = 1.4;
/** Where the `top` bone sits along Y — the quad's waist. */
const TOP_BONE_Y = 0.7;

const POSITIONS: readonly (readonly [number, number, number])[] = [
    [-HALF_WIDTH, 0, 0],
    [HALF_WIDTH, 0, 0],
    [HALF_WIDTH, HEIGHT, 0],
    [-HALF_WIDTH, HEIGHT, 0],
];
/** Bottom two vertices follow joint 0 (`root`), top two follow joint 1 (`top`). */
const JOINTS: readonly (readonly [number, number, number, number])[] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
];
const WEIGHTS: readonly (readonly [number, number, number, number])[] = [
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
];
const NORMALS: readonly (readonly [number, number, number])[] = [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
];
const INDICES: readonly number[] = [0, 1, 2, 0, 2, 3];

/**
 * Inverse bind matrices, column-major, one per joint: identity for `root` at the
 * origin, and a −0.7 Y translation for `top`, which sits at +0.7.
 */
const INVERSE_BIND_MATRICES: readonly (readonly number[])[] = [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -TOP_BONE_Y, 0, 1],
];

// ── glTF / GLB constants ─────────────────────────────────────────────────────

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
const GLB_BIN_CHUNK_TYPE = 0x004e4942; // 'BIN\0'
const GLB_CONTAINER_VERSION = 2;

const COMPONENT_TYPE_UNSIGNED_SHORT = 5123;
const COMPONENT_TYPE_FLOAT = 5126;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const PRIMITIVE_MODE_TRIANGLES = 4;

// ── Buffer authoring ─────────────────────────────────────────────────────────

/** A slice of the BIN chunk, plus the accessor bookkeeping it needs. */
export interface PackedView {
    readonly bytes: Buffer;
    readonly byteOffset: number;
}

/**
 * Accumulates BIN-chunk slices, each 4-byte aligned as the glTF spec requires.
 *
 * EXPORTED for its own tests, not because anything else composes it. Every view
 * this generator packs today happens to be a multiple of 4 bytes long, so the
 * alignment arms below are unreachable through `buildShowcaseAnimatedGlb` and a
 * generator with no alignment at all would emit byte-identical output. That is
 * exactly the shape of a guard that rots: correct, load-bearing the first time
 * an odd-sized view is added, and invisible to the committed-bytes gate until
 * then. `gen-showcase-animated-glb.test.ts` drives it directly instead.
 */
export class BufferPacker {
    private readonly chunks: Buffer[] = [];
    private length = 0;

    public push(bytes: Buffer): PackedView {
        // Every bufferView offset must be a multiple of 4. Padding BEFORE the
        // slice rather than after keeps the last view's byteLength honest.
        const padding = (4 - (this.length % 4)) % 4;
        if (padding > 0) {
            this.chunks.push(Buffer.alloc(padding));
            this.length += padding;
        }
        const byteOffset = this.length;
        this.chunks.push(bytes);
        this.length += bytes.length;
        return { bytes, byteOffset };
    }

    public concat(): Buffer {
        // The BIN chunk itself pads to 4 with NULs, per the spec.
        const padding = (4 - (this.length % 4)) % 4;
        return Buffer.concat([...this.chunks, Buffer.alloc(padding)]);
    }
}

function packFloats(values: readonly number[]): Buffer {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    return bytes;
}

function packUnsignedShorts(values: readonly number[]): Buffer {
    const bytes = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
    return bytes;
}

/**
 * Component-wise min/max of a flat run of `stride`-wide elements.
 *
 * Computed from the packed values rather than authored beside them: an accessor
 * whose declared bounds disagree with its data is a defect a loader silently
 * culls geometry over, and a hand-written bound is exactly how that happens.
 */
function boundsOf(values: readonly number[], stride: number): { min: number[]; max: number[] } {
    const min = values.slice(0, stride);
    const max = values.slice(0, stride);
    for (let index = stride; index < values.length; index += stride) {
        for (let lane = 0; lane < stride; lane += 1) {
            const value = values[index + lane]!;
            if (value < min[lane]!) min[lane] = value;
            if (value > max[lane]!) max[lane] = value;
        }
    }
    return { min, max };
}

/**
 * Round every element to the float32 value the buffer will actually hold.
 *
 * The accessor's declared min/max must bound the STORED data, not the authored
 * doubles: `0.3` stored as float32 reads back as `0.30000001192092896`, so a
 * `max` of `0.3` would be below the value it is meant to bound — which is what
 * makes a strict glTF validator reject the container.
 */
function asFloat32(values: readonly number[]): number[] {
    const view = new Float32Array(values);
    return Array.from(view);
}

// ── The document ─────────────────────────────────────────────────────────────

/**
 * Build the animated showcase rig as a binary glTF container.
 *
 * Deterministic and dependency-free: the same bytes on every machine and every
 * Node version.
 */
export function buildShowcaseAnimatedGlb(): Uint8Array {
    const packer = new BufferPacker();

    const positionValues = POSITIONS.flatMap((vertex) => [...vertex]);
    const jointValues = JOINTS.flatMap((vertex) => [...vertex]);
    const weightValues = WEIGHTS.flatMap((vertex) => [...vertex]);
    const normalValues = NORMALS.flatMap((vertex) => [...vertex]);
    const inverseBindValues = INVERSE_BIND_MATRICES.flatMap((matrix) => [...matrix]);
    const keySeconds = [...SHOWCASE_ANIMATED_KEY_SECONDS];
    const rotationValues = SWING_QUATERNIONS.flatMap((quaternion) => [...quaternion]);
    const leanKeySeconds = [...SHOWCASE_ANIMATED_LEAN_KEY_SECONDS];
    const leanRotationValues = LEAN_QUATERNIONS.flatMap((quaternion) => [...quaternion]);

    const positionView = packer.push(packFloats(positionValues));
    const jointView = packer.push(packUnsignedShorts(jointValues));
    const weightView = packer.push(packFloats(weightValues));
    const normalView = packer.push(packFloats(normalValues));
    const indexView = packer.push(packUnsignedShorts([...INDICES]));
    const inverseBindView = packer.push(packFloats(inverseBindValues));
    const keyTimeView = packer.push(packFloats(keySeconds));
    const rotationView = packer.push(packFloats(rotationValues));
    const leanKeyTimeView = packer.push(packFloats(leanKeySeconds));
    const leanRotationView = packer.push(packFloats(leanRotationValues));

    const bin = packer.concat();

    const positionBounds = boundsOf(asFloat32(positionValues), 3);
    const keyTimeBounds = boundsOf(asFloat32(keySeconds), 1);
    const rotationBounds = boundsOf(asFloat32(rotationValues), 4);
    const leanKeyTimeBounds = boundsOf(asFloat32(leanKeySeconds), 1);
    const leanRotationBounds = boundsOf(asFloat32(leanRotationValues), 4);

    const json = {
        asset: { version: '2.0', generator: 'chimera gen-showcase-animated-glb' },
        scene: 0,
        scenes: [{ name: 'AuxScene', nodes: [0] }],
        nodes: [
            { name: 'showcase-rig-animated', children: [1] },
            { name: 'showcase-quad', mesh: 0, skin: 0, children: [2] },
            { name: 'root', children: [3] },
            { name: SHOWCASE_POSED_BONE_NAME, translation: [0, TOP_BONE_Y, 0] },
        ],
        meshes: [
            {
                primitives: [
                    {
                        mode: PRIMITIVE_MODE_TRIANGLES,
                        attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2, NORMAL: 3 },
                        indices: 4,
                        material: 0,
                    },
                ],
            },
        ],
        skins: [{ inverseBindMatrices: 5, joints: [2, 3], skeleton: 2 }],
        animations: [
            {
                name: SHOWCASE_ANIMATED_CLIP_NAME,
                channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }],
                samplers: [{ input: 6, output: 7, interpolation: 'LINEAR' }],
            },
            // The same bone, a second curve. Both clips driving one node is what
            // makes a blend between them visible on a single rotation, which is
            // the only channel a DOM-observable game screen has.
            {
                name: SHOWCASE_ANIMATED_LEAN_CLIP_NAME,
                channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }],
                samplers: [{ input: 8, output: 9, interpolation: 'LINEAR' }],
            },
        ],
        materials: [
            {
                // The same unlit magenta the rig beside it uses: the showcase
                // scene mounts no lights, and the e2e counts magenta pixels.
                pbrMetallicRoughness: {
                    baseColorFactor: [1, 0, 1, 1],
                    metallicFactor: 0,
                    roughnessFactor: 0.9,
                },
                extensions: { KHR_materials_unlit: {} },
            },
        ],
        accessors: [
            {
                bufferView: 0,
                componentType: COMPONENT_TYPE_FLOAT,
                count: POSITIONS.length,
                type: 'VEC3',
                min: positionBounds.min,
                max: positionBounds.max,
            },
            {
                bufferView: 1,
                componentType: COMPONENT_TYPE_UNSIGNED_SHORT,
                count: JOINTS.length,
                type: 'VEC4',
            },
            {
                bufferView: 2,
                componentType: COMPONENT_TYPE_FLOAT,
                count: WEIGHTS.length,
                type: 'VEC4',
            },
            {
                bufferView: 3,
                componentType: COMPONENT_TYPE_FLOAT,
                count: NORMALS.length,
                type: 'VEC3',
            },
            {
                bufferView: 4,
                componentType: COMPONENT_TYPE_UNSIGNED_SHORT,
                count: INDICES.length,
                type: 'SCALAR',
            },
            {
                bufferView: 5,
                componentType: COMPONENT_TYPE_FLOAT,
                count: INVERSE_BIND_MATRICES.length,
                type: 'MAT4',
            },
            {
                // An animation sampler's INPUT accessor must declare min/max —
                // the one place the spec requires them outside POSITION, and the
                // pair every reader (including this repo's) derives the clip's
                // length from.
                bufferView: 6,
                componentType: COMPONENT_TYPE_FLOAT,
                count: keySeconds.length,
                type: 'SCALAR',
                min: keyTimeBounds.min,
                max: keyTimeBounds.max,
            },
            {
                // min/max on a rotation accessor is optional — the spec asks for
                // it on POSITION and on a sampler INPUT only — and is authored
                // here on purpose: the angles it bounds are what this clip puts
                // on screen, and a reader outside this file (the manifest's own
                // test, the game's blend band) can then check the pose rather
                // than trust a comment about it.
                bufferView: 7,
                componentType: COMPONENT_TYPE_FLOAT,
                count: SWING_QUATERNIONS.length,
                type: 'VEC4',
                min: rotationBounds.min,
                max: rotationBounds.max,
            },
            {
                bufferView: 8,
                componentType: COMPONENT_TYPE_FLOAT,
                count: leanKeySeconds.length,
                type: 'SCALAR',
                min: leanKeyTimeBounds.min,
                max: leanKeyTimeBounds.max,
            },
            {
                // Bounded for the reason above, and here they are also EQUAL:
                // the clip holds one rotation, so its min and max are the pose.
                bufferView: 9,
                componentType: COMPONENT_TYPE_FLOAT,
                count: LEAN_QUATERNIONS.length,
                type: 'VEC4',
                min: leanRotationBounds.min,
                max: leanRotationBounds.max,
            },
        ],
        bufferViews: [
            {
                buffer: 0,
                byteOffset: positionView.byteOffset,
                byteLength: positionView.bytes.length,
                target: TARGET_ARRAY_BUFFER,
            },
            {
                buffer: 0,
                byteOffset: jointView.byteOffset,
                byteLength: jointView.bytes.length,
                target: TARGET_ARRAY_BUFFER,
            },
            {
                buffer: 0,
                byteOffset: weightView.byteOffset,
                byteLength: weightView.bytes.length,
                target: TARGET_ARRAY_BUFFER,
            },
            {
                buffer: 0,
                byteOffset: normalView.byteOffset,
                byteLength: normalView.bytes.length,
                target: TARGET_ARRAY_BUFFER,
            },
            {
                buffer: 0,
                byteOffset: indexView.byteOffset,
                byteLength: indexView.bytes.length,
                target: TARGET_ELEMENT_ARRAY_BUFFER,
            },
            {
                buffer: 0,
                byteOffset: inverseBindView.byteOffset,
                byteLength: inverseBindView.bytes.length,
            },
            { buffer: 0, byteOffset: keyTimeView.byteOffset, byteLength: keyTimeView.bytes.length },
            {
                buffer: 0,
                byteOffset: rotationView.byteOffset,
                byteLength: rotationView.bytes.length,
            },
            {
                buffer: 0,
                byteOffset: leanKeyTimeView.byteOffset,
                byteLength: leanKeyTimeView.bytes.length,
            },
            {
                buffer: 0,
                byteOffset: leanRotationView.byteOffset,
                byteLength: leanRotationView.bytes.length,
            },
        ],
        // No `uri`: the buffer IS this container's BIN chunk, which is what
        // makes the fixture self-contained and reviewable as one file.
        buffers: [{ byteLength: bin.length }],
        extensionsUsed: ['KHR_materials_unlit'],
    };

    return packGlb(JSON.stringify(json), bin);
}

/** Assemble the container: header, JSON chunk (space-padded), BIN chunk (NUL-padded). */
function packGlb(jsonText: string, bin: Buffer): Uint8Array {
    const jsonChunk = glbChunk(GLB_JSON_CHUNK_TYPE, Buffer.from(jsonText, 'utf8'), 0x20);
    const binChunk = glbChunk(GLB_BIN_CHUNK_TYPE, bin, 0x00);

    const header = Buffer.alloc(12);
    header.writeUInt32LE(GLB_MAGIC, 0);
    header.writeUInt32LE(GLB_CONTAINER_VERSION, 4);
    header.writeUInt32LE(header.length + jsonChunk.length + binChunk.length, 8);

    return new Uint8Array(Buffer.concat([header, jsonChunk, binChunk]));
}

/** One glTF chunk: an 8-byte header plus a body padded to a 4-byte boundary. */
function glbChunk(type: number, body: Buffer, padWith: number): Buffer {
    const padding = (4 - (body.length % 4)) % 4;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(body.length + padding, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, body, Buffer.alloc(padding, padWith)]);
}

/** True when the committed bytes differ from the freshly built ones (drift). */
export function checkGlbDrift(committed: Uint8Array, expected: Uint8Array): boolean {
    if (committed.length !== expected.length) return true;
    return !committed.every((byte, index) => byte === expected[index]);
}

// ── CLI entry (not exercised by unit tests) ──────────────────────────────────
//
// Runs only via `tsx tools/gen-showcase-animated-glb.ts [--check]`. The VITEST
// guard keeps the disk I/O out of the unit surface; the body is an async IIFE
// because tsx transforms `tools/*.ts` as CommonJS and esbuild rejects top-level
// await in CJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const path = await import('node:path');
        const { readFile, writeFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const committedPath = path.join(repoRoot, SHOWCASE_ANIMATED_GLB_REL_PATH);

        try {
            const expected = buildShowcaseAnimatedGlb();

            if (process.argv.includes('--check')) {
                let committed = new Uint8Array(0);
                try {
                    committed = new Uint8Array(await readFile(committedPath));
                } catch {
                    committed = new Uint8Array(0);
                }
                if (checkGlbDrift(committed, expected)) {
                    console.error(
                        '[verify:showcase-glb] FAILED — showcase-rig-animated.glb is not the generator output.\n' +
                            '  The committed binary was hand-edited, re-exported, or the generator changed without a regenerate.\n' +
                            '  Run `pnpm gen:showcase-glb` and commit the result.',
                    );
                    process.exitCode = 1;
                    return;
                }
                console.log('[verify:showcase-glb] OK — committed bytes match the generator.');
                return;
            }

            await writeFile(committedPath, expected);
            console.log(`[gen:showcase-glb] Wrote ${committedPath} (${expected.length} bytes).`);
        } catch (error) {
            console.error(
                `[gen:showcase-glb] ${error instanceof Error ? error.message : String(error)}`,
            );
            process.exitCode = 1;
        }
    })();
}
