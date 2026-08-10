/**
 * electron/dev-tools/test-support/glbDocument.ts
 *
 * Parses the JSON chunk out of a binary glTF (`.glb`) container.
 *
 * A `.glb` is opaque to every text tool in a repo: it cannot be diffed, grepped,
 * or reviewed, so what a model actually declares is knowable only by parsing it.
 * That makes the prose around a model — which extension it uses, which bone a
 * screen poses by name, whether its buffer is embedded — unverifiable by default,
 * and it rots silently when the model is re-exported.
 *
 * `validate-assets` checks that a declared ref EXISTS (Invariant #52 is
 * membership-only); nothing reads inside the container. This does, so a test can
 * assert the model's own claims about itself.
 *
 * The glTF type surface below is deliberately partial: the fields a test asserts
 * on, not the schema. Anything outside it is reachable by widening this file,
 * which is the moment to decide whether the assertion is worth the surface.
 */

import { readFileSync } from 'node:fs';

import { MalformedAssetFileError } from './MalformedAssetFileError.js';

/** `'glTF'` as a little-endian u32 — the container's first four bytes. */
const GLB_MAGIC = 0x46546c67;
/** `'JSON'` as a little-endian u32 — the required type of the first chunk. */
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
/** The only container version the format defines. */
const GLB_CONTAINER_VERSION = 2;

export interface GltfAssetInfo {
    readonly version: string;
    readonly generator?: string;
    readonly copyright?: string;
}

export interface GltfNode {
    readonly name?: string;
    readonly children?: readonly number[];
    readonly mesh?: number;
    readonly skin?: number;
    readonly translation?: readonly number[];
    readonly rotation?: readonly number[];
    readonly scale?: readonly number[];
}

export interface GltfPrimitive {
    /** Semantic name (`POSITION`, `JOINTS_0`, …) → accessor index. */
    readonly attributes: Readonly<Record<string, number>>;
    readonly indices?: number;
    readonly material?: number;
}

export interface GltfMesh {
    readonly name?: string;
    readonly primitives: readonly GltfPrimitive[];
}

export interface GltfAccessor {
    readonly count: number;
    readonly type: string;
    readonly componentType: number;
    /** Present on POSITION accessors — the authored bounding box, in model units. */
    readonly min?: readonly number[];
    readonly max?: readonly number[];
}

export interface GltfBuffer {
    readonly byteLength: number;
    /** Absent ⇒ the buffer is the container's own BIN chunk (self-contained). */
    readonly uri?: string;
}

export interface GltfImage {
    readonly uri?: string;
    readonly bufferView?: number;
    readonly mimeType?: string;
}

export interface GltfMaterial {
    readonly name?: string;
    readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface GltfNamed {
    readonly name?: string;
}

/**
 * One animation sampler: the keyframe curve a channel reads.
 *
 * `input` and `output` are ACCESSOR INDICES, and the clip's length lives at
 * `accessors[input].max[0]` — the one place outside `POSITION` where the glTF
 * spec requires an accessor to declare its bounds, and therefore the only way to
 * learn how long a clip runs without decoding the buffer.
 *
 * Every field is optional, as everywhere else in this reader: `readGlbDocument`
 * casts unvalidated JSON, so a required field would be a type-level lie for
 * exactly the malformed container {@link MalformedAssetFileError} exists to make
 * loud.
 */
export interface GltfAnimationSampler {
    /** Accessor index of the keyframe times. */
    readonly input?: number;
    /** Accessor index of the keyframe values. */
    readonly output?: number;
    /** `'LINEAR'`, `'STEP'` or `'CUBICSPLINE'`; absent means the spec default, LINEAR. */
    readonly interpolation?: string;
}

/** One animation channel: which sampler drives which node property. */
export interface GltfAnimationChannel {
    /** Index into the animation's own `samplers`. */
    readonly sampler?: number;
    /** The node and property the sampler animates. */
    readonly target?: {
        readonly node?: number;
        readonly path?: string;
    };
}

/**
 * One animation. Its `name` is what `THREE.AnimationClip.name` becomes at load,
 * which is the key a game's clip sheet marks and `useClipPlayer` plays — so a
 * re-export that renamed a clip breaks the sheet with nothing else to notice.
 */
export interface GltfAnimation extends GltfNamed {
    readonly channels?: readonly GltfAnimationChannel[];
    readonly samplers?: readonly GltfAnimationSampler[];
}

/** The glTF JSON document carried by a `.glb`, narrowed to the asserted fields. */
export interface GltfDocument {
    readonly asset: GltfAssetInfo;
    readonly extensionsUsed?: readonly string[];
    readonly extensionsRequired?: readonly string[];
    readonly scenes?: readonly GltfNamed[];
    readonly nodes?: readonly GltfNode[];
    readonly meshes?: readonly GltfMesh[];
    readonly materials?: readonly GltfMaterial[];
    readonly skins?: readonly GltfNamed[];
    readonly animations?: readonly GltfAnimation[];
    readonly accessors?: readonly GltfAccessor[];
    readonly buffers?: readonly GltfBuffer[];
    readonly images?: readonly GltfImage[];
    readonly textures?: readonly GltfNamed[];
}

/**
 * Read the glTF JSON document out of the `.glb` at `filePath`.
 *
 * @throws {MalformedAssetFileError} When the file is not a version-2 glTF
 *   container, does not carry its declared length, or leads with a chunk that is
 *   not the JSON chunk.
 */
export function readGlbDocument(filePath: string): GltfDocument {
    const bytes = readFileSync(filePath);
    if (bytes.length < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) {
        throw new MalformedAssetFileError(filePath, 'shorter than a glTF header and one chunk');
    }

    const magic = bytes.readUInt32LE(0);
    if (magic !== GLB_MAGIC) {
        throw new MalformedAssetFileError(
            filePath,
            `expected the 'glTF' magic 0x${GLB_MAGIC.toString(16)}, found 0x${magic.toString(16)}`,
        );
    }

    const version = bytes.readUInt32LE(4);
    if (version !== GLB_CONTAINER_VERSION) {
        throw new MalformedAssetFileError(
            filePath,
            `container version ${version}; only version ${GLB_CONTAINER_VERSION} is defined`,
        );
    }

    // The declared total is the only in-band signal that the tail survived the
    // copy: a truncated model otherwise parses and loads with pieces missing.
    const declaredLength = bytes.readUInt32LE(8);
    if (declaredLength !== bytes.length) {
        throw new MalformedAssetFileError(
            filePath,
            `declares ${declaredLength} bytes but the file is ${bytes.length}`,
        );
    }

    const jsonChunkLength = bytes.readUInt32LE(GLB_HEADER_BYTES);
    const jsonChunkType = bytes.readUInt32LE(GLB_HEADER_BYTES + 4);
    if (jsonChunkType !== GLB_JSON_CHUNK_TYPE) {
        throw new MalformedAssetFileError(
            filePath,
            `the first chunk is type 0x${jsonChunkType.toString(16)}, not the required JSON chunk`,
        );
    }

    const jsonStart = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
    const jsonEnd = jsonStart + jsonChunkLength;
    if (jsonEnd > bytes.length) {
        throw new MalformedAssetFileError(
            filePath,
            `the JSON chunk declares ${jsonChunkLength} bytes but only ${bytes.length - jsonStart} follow it`,
        );
    }

    // Stop at the declared length, never at end-of-file: reading on would append
    // the BIN chunk's binary payload to the JSON text, turning a length mismatch
    // into an unrelated parse error. The spec pads this chunk with spaces, which
    // `JSON.parse` accepts.
    const json = bytes.toString('utf8', jsonStart, jsonEnd);
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (cause) {
        throw new MalformedAssetFileError(
            filePath,
            `the JSON chunk is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`,
        );
    }

    // `null`, `[]` and `5` are all valid JSON, so the parse above admits them and
    // the cast would hand back a `GltfDocument` whose required `asset` is absent.
    // The caller's first property read then throws a bare TypeError naming no
    // file — exactly the cryptic failure this error type exists to replace.
    //
    // One check, not four: optional chaining already yields `undefined` for a
    // null, an array and a primitive alike, so a `typeof`/`Array.isArray` pair in
    // front of it could never be the reason anything is rejected.
    if (typeof (parsed as GltfDocument | null)?.asset?.version !== 'string') {
        throw new MalformedAssetFileError(
            filePath,
            'the JSON chunk parsed but is not a glTF document (no `asset.version` string)',
        );
    }
    return parsed as GltfDocument;
}
