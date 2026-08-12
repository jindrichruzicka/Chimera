/**
 * renderer/animation/SpriteClipBackend.ts
 *
 * The {@link ClipBackend} over a sprite atlas: its own integrating clock, a run
 * of atlas cells, and four `uv` pairs written into a caller-owned geometry.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **It reaches three at no point at run time.** `BufferGeometry` is imported as
 * a TYPE: the geometry arrives through the constructor and is only ever asked
 * for its `uv` attribute. That is the point of having two implementations behind
 * one seam — the second one is not a mixer wearing a different hat, so a
 * `ClipBackend` promise that only an `AnimationMixer` happens to keep breaks
 * here rather than a release later.
 *
 * **Rule SPRITE-NO-SHARED-MUTATION.** The `Texture` a sprite samples is owned by
 * the `AssetManager` and shared by every sprite cut from the same sheet
 * (Invariant #21), so this backend never receives one: it holds a measured
 * {@link SpriteAtlas}, which carries pixel rects and UVs and no texture at all.
 * Per-frame state therefore lives entirely in the caller's geometry, and neither
 * `offset`, `repeat`, `wrapS`, `wrapT`, `flipY`, `colorSpace`, `matrix` nor
 * `needsUpdate` is ever written on a shared texture, because there is nothing to
 * write them on. The atlas is not cloned either — a `Texture` clone carries an
 * unmeasured assumption about three's `Texture.source` ref-counting, whose
 * failure mode is every sibling sprite going blank.
 *
 * **Geometry lifetime belongs to whoever constructed it.**
 * {@link SpriteClipBackend.dispose} releases only what this backend allocated,
 * which is its own bookkeeping: the injected geometry is not disposed and its
 * `uv` attribute is left readable, exactly as the last frame left it.
 *
 * **One quad shows one frame.** A backend holds at most one playback: starting a
 * clip releases whatever was running, because two playbacks writing the same
 * `uv` attribute would fight over it every frame. The released handle keeps
 * answering from a captured sample.
 *
 * **The four pairs, and their order.** {@link SpriteAtlasFrame.uv} is already in
 * `PlaneGeometry`'s vertex order — top-left, top-right, bottom-left,
 * bottom-right — and is written straight through, unrecomputed. The derivation
 * that made `v` run UP the image (the sheet decodes through a `Texture` whose
 * `flipY` defaults to `true`) lives once, in `renderer/assets/spriteAtlas.ts`;
 * transcribing it into a second form here is the coin-flip on vertical
 * orientation that one form exists to avoid.
 */

import type { BufferGeometry } from 'three';

import type {
    AnimationClipName,
    AnimationLoopMode,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import type { SpriteAtlas, SpriteAtlasFrame } from '../assets/spriteAtlas.js';

import { checkedLoopMode, checkedPlaybackSpeed } from './ClipBackend.js';
import type { ClipBackend, ClipPlayOptions, ClipPlayback, PlayheadSample } from './ClipBackend.js';

/** How many vertices a sprite quad's `uv` attribute has to carry to be writable. */
const QUAD_VERTEX_COUNT = 4;

/** One clip's run through the atlas. */
export interface SpriteClipSpec {
    /** Atlas frame INDICES in play order, so a run may repeat or reorder cells. */
    readonly frames: readonly number[];
    /** Frames per second. Finite and positive; the clip's length is `frames.length / fps`. */
    readonly fps: number;
    /** How the clip behaves at its end. Defaults to `'once'`. */
    readonly loop?: AnimationLoopMode;
}

/** What a sprite backend is built over. */
export interface SpriteClipBackendOptions {
    /** The measured sheet. Read only — it carries no texture, by design. */
    readonly atlas: SpriteAtlas;
    /**
     * The quad this backend writes `uv` into. Allocated and disposed by its
     * owner; a geometry with no writable 4-vertex `uv` attribute is left alone
     * rather than made an error, so a mis-built quad costs a still sprite and not
     * a throw inside a frame loop.
     */
    readonly geometry: BufferGeometry;
    /** Clip name → its run. A clip whose run is unusable is one this backend does not have. */
    readonly clips: Readonly<Record<AnimationClipName, SpriteClipSpec>>;
}

/** A clip whose frame indices have been resolved to atlas cells once, at construction. */
interface ResolvedClip {
    readonly cells: readonly SpriteAtlasFrame[];
    /** `frames.length / fps`, computed once so every phase divides by the same number. */
    readonly durationSeconds: number;
    readonly loop: AnimationLoopMode;
}

/** The one playback a sprite backend may hold. */
interface LivePlayback {
    readonly clipName: AnimationClipName;
    readonly clip: ResolvedClip;
    readonly loop: AnimationLoopMode;
    /** Seconds into the CURRENT cycle. Never negative, never past the duration. */
    elapsedSeconds: number;
    cycle: number;
    speed: number;
    /** `null` while live; the terminal sample once released. */
    frozen: PlayheadSample | null;
}

/** Plays a run of atlas cells by writing `uv` into one caller-owned quad. */
export class SpriteClipBackend implements ClipBackend {
    readonly #geometry: BufferGeometry;
    readonly #clips = new Map<AnimationClipName, ResolvedClip>();
    #live: LivePlayback | null = null;
    /** The cell currently on the quad, so an advance that changes nothing writes nothing. */
    #writtenCell: SpriteAtlasFrame | null = null;
    #disposed = false;

    constructor(options: SpriteClipBackendOptions) {
        this.#geometry = options.geometry;
        for (const [clipName, spec] of Object.entries(options.clips)) {
            const resolved = resolveClip(spec, options.atlas);
            if (resolved !== null) {
                this.#clips.set(clipName, resolved);
            }
        }
    }

    getDurationSeconds(clipName: AnimationClipName): number | null {
        return this.#clips.get(clipName)?.durationSeconds ?? null;
    }

    /**
     * @throws RangeError  when `options.loop` is not a loop mode this backend
     *                     knows, or `options.speed` is negative or not finite.
     *                     Both are checked before anything is replaced.
     */
    play(clipName: AnimationClipName, options?: ClipPlayOptions): ClipPlayback | null {
        if (this.#disposed) {
            return null;
        }
        const clip = this.#clips.get(clipName);
        if (clip === undefined) {
            return null;
        }
        const loop = checkedLoopMode(options?.loop ?? clip.loop);
        const speed = checkedPlaybackSpeed(options?.speed ?? 1, 'clip speed');

        if (this.#live !== null) {
            this.#release(this.#live);
        }
        const record: LivePlayback = {
            clipName,
            clip,
            loop,
            elapsedSeconds: 0,
            cycle: 0,
            speed,
            frozen: null,
        };
        this.#live = record;
        this.#showFrameFor(record);
        return this.#handle(record);
    }

    advance(deltaSeconds: number): void {
        const record = this.#live;
        if (this.#disposed || record === null) {
            return;
        }
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
            return;
        }
        const moved = record.elapsedSeconds + deltaSeconds * record.speed;
        if (record.loop === 'once') {
            // Clamped at the duration, which is phase 1: the last cell of the run
            // is what a finished sprite clip holds.
            record.elapsedSeconds = Math.min(moved, record.clip.durationSeconds);
        } else {
            // Arithmetic rather than a subtract-until loop, so a delta worth a
            // thousand cycles costs the same as one worth a tenth. On positive
            // operands `%` is exact and lands inside `[0, duration)`, which is
            // what lets `phaseOf` divide with no clamp of its own.
            record.cycle += Math.floor(moved / record.clip.durationSeconds);
            record.elapsedSeconds = moved % record.clip.durationSeconds;
        }
        this.#showFrameFor(record);
    }

    /**
     * Freeze the playback and stop answering. Idempotent by construction — a
     * second call finds an empty slot, so an early return would guard nothing.
     *
     * Releases only what this backend allocated — which is nothing outside itself.
     * The injected geometry is not disposed and its `uv` attribute is left as the
     * last frame wrote it, because its lifetime belongs to whoever constructed it.
     */
    dispose(): void {
        this.#disposed = true;
        if (this.#live !== null) {
            this.#release(this.#live);
        }
    }

    /** The handle a caller holds. Reads through `record`, so it survives its release. */
    #handle(record: LivePlayback): ClipPlayback {
        return {
            clipName: record.clipName,
            sample: () => sampleOf(record),
            setSpeed: (speed: number) => {
                // Checked wherever it is written, so a sign error is refused even
                // on a released handle. Written unconditionally: `advance` reads
                // the speed off the LIVE record only, and a released one is never
                // read again.
                record.speed = checkedPlaybackSpeed(speed, 'clip speed');
            },
            stop: () => {
                this.#release(record);
            },
            hold: () => {
                // The same body as `stop`, and that is the point rather than an
                // oversight: this backend writes `uv` into a geometry it does not
                // own and never writes it back, so what it poses is already left
                // on screen by a release. The mesh backend is the one where the
                // two verbs differ, because three hands a binding back.
                this.#release(record);
            },
        };
    }

    /** Capture `record`'s terminal sample and drop it, unless it is already terminal. */
    #release(record: LivePlayback): void {
        if (record.frozen !== null) {
            return;
        }
        record.frozen = { ...sampleOf(record), ended: true };
        // Exact rather than guarded: the slot holds this record whenever it is
        // unfrozen, and the guard above returns before this line once it is not.
        this.#live = null;
    }

    /** Put `record`'s current cell on the quad, if it is not already there. */
    #showFrameFor(record: LivePlayback): void {
        const cell = record.clip.cells[frameIndexAt(phaseOf(record), record.clip.cells.length)];
        if (cell === undefined || cell === this.#writtenCell) {
            return;
        }
        if (writeCellUv(this.#geometry, cell)) {
            this.#writtenCell = cell;
        }
    }
}

// ─── internals ──────────────────────────────────────────────────────────────────

/** The playhead right now, or the sample captured when this playback was released. */
function sampleOf(record: LivePlayback): PlayheadSample {
    if (record.frozen !== null) {
        return record.frozen;
    }
    const phase = phaseOf(record);
    return { phase, cycle: record.cycle, ended: record.loop === 'once' && phase >= 1 };
}

/**
 * The playhead as a phase in `[0, 1]`, with no clamp of its own: `advance` is the
 * one ceiling on `elapsedSeconds`, holding a `'once'` clip at the duration and a
 * looping one below it. A second clamp here would be invisible behind that one
 * and would hide its removal.
 */
function phaseOf(record: LivePlayback): number {
    return record.elapsedSeconds / record.clip.durationSeconds;
}

/**
 * Which entry of a `count`-long run a phase sits on.
 *
 * `floor(phase x count)` is `count` at phase 1 and at nothing below it, so the
 * clamp is load-bearing for exactly one input — the one a finished `'once'` clip
 * always reports.
 */
function frameIndexAt(phase: number, count: number): number {
    return Math.min(Math.floor(phase * count), count - 1);
}

/**
 * `spec` with its frame indices resolved to atlas cells, or `null` when the run
 * is not playable: an empty run, an index the atlas has no cell for, or an fps
 * that is not a finite positive number.
 *
 * Resolved once at construction rather than per frame, so a missing cell is an
 * answer of `null` from `getDurationSeconds` and `play` — the same fail-soft
 * answer the seam gives for a clip the backend simply does not have — instead of
 * a hole that only shows up mid-playback.
 */
function resolveClip(spec: SpriteClipSpec, atlas: SpriteAtlas): ResolvedClip | null {
    if (spec.frames.length === 0 || !Number.isFinite(spec.fps) || spec.fps <= 0) {
        return null;
    }
    const cells: SpriteAtlasFrame[] = [];
    for (const index of spec.frames) {
        const cell = atlas.frames[index];
        if (cell === undefined) {
            return null;
        }
        cells.push(cell);
    }
    return {
        cells,
        durationSeconds: cells.length / spec.fps,
        loop: spec.loop ?? 'once',
    };
}

/** The slice of a `uv` attribute this backend writes. */
interface UvAttribute {
    readonly count: number;
    setXY(index: number, x: number, y: number): unknown;
    needsUpdate: boolean;
}

/**
 * `geometry`'s `uv` attribute, or `null` when it has none this backend can write
 * — a geometry carrying no `uv` at all, one whose `uv` is a `GLBufferAttribute`
 * with no CPU-side setter, or one whose quad is too small to hold four pairs.
 */
function uvAttributeOf(geometry: BufferGeometry): UvAttribute | null {
    const attribute: unknown = geometry.attributes['uv'];
    if (typeof attribute !== 'object' || attribute === null) {
        return null;
    }
    const candidate = attribute as Partial<UvAttribute>;
    if (typeof candidate.setXY !== 'function' || typeof candidate.count !== 'number') {
        return null;
    }
    return candidate.count >= QUAD_VERTEX_COUNT ? (candidate as UvAttribute) : null;
}

/** Write `cell`'s four pairs onto the quad. `false` when the geometry has nowhere to put them. */
function writeCellUv(geometry: BufferGeometry, cell: SpriteAtlasFrame): boolean {
    const uv = uvAttributeOf(geometry);
    if (uv === null) {
        return false;
    }
    for (let vertex = 0; vertex < QUAD_VERTEX_COUNT; vertex += 1) {
        const pair = cell.uv[vertex];
        if (pair !== undefined) {
            uv.setXY(vertex, pair[0], pair[1]);
        }
    }
    uv.needsUpdate = true;
    return true;
}
