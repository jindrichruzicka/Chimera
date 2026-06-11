/**
 * simulation/debug/SnapshotRingBuffer.ts
 *
 * Fixed-capacity ring buffer of historical authoritative snapshots backing
 * the Debug Inspector timeline (§4.12 — Runtime Debug Layer).
 *
 * Invariant #30: the capacity is fixed and explicitly set — the buffer never
 * grows unboundedly; the oldest entry is overwritten silently when full.
 * Invariant #31: instantiated only when `IS_DEBUG_MODE` is true. The
 * simulation side couples to it solely through the optional
 * `PipelineContext.debugObserver` callback — production wiring leaves that
 * field `undefined` and this module is never loaded.
 *
 * Snapshots are stored by reference (never cloned or mutated): every state
 * the pipeline emits is an immutable `BaseGameSnapshot`, so sharing the
 * reference is safe and `record()` never copies state.
 */

import type { BaseGameSnapshot } from '../engine/types.js';

/** Default capacity: 200 ticks ≈ 10 s of history at the 20 Hz simulation rate. */
export const DEFAULT_RING_BUFFER_CAPACITY = 200;

/** One recorded (tick, snapshot) pair as stored in — and pushed from — the buffer. */
export interface RingBufferEntry<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly tick: number;
    readonly snapshot: Readonly<TState>;
}

export class SnapshotRingBuffer<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    readonly #capacity: number;
    /** Fixed-size slot array; `undefined` slots have not been written yet. */
    readonly #entries: (RingBufferEntry<TState> | undefined)[];
    /**
     * Tick → slot index giving O(1) `get()` and same-tick replacement
     * (§4.12: "O(1) from ring buffer"). Holds at most one key per slot —
     * evicted ticks are deleted — so it is capacity-bounded (Invariant #30).
     */
    readonly #tickToSlot = new Map<number, number>();
    /** Next slot to overwrite — advances only when a new tick claims a slot. */
    #cursor = 0;

    /**
     * Optional live-push hook for the debug bridge (SUBSCRIBE_LIVE). Fires
     * after every `record()`, including same-tick replacements. Assigned
     * post-construction by the bridge, never by simulation code.
     */
    onRecord?: (entry: RingBufferEntry<TState>) => void;

    constructor(capacity: number = DEFAULT_RING_BUFFER_CAPACITY) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new RangeError(
                `SnapshotRingBuffer capacity must be a positive integer, got ${capacity}`,
            );
        }
        this.#capacity = capacity;
        this.#entries = new Array<RingBufferEntry<TState> | undefined>(capacity).fill(undefined);
    }

    /**
     * Store the snapshot for `tick`. A tick already in the buffer is replaced
     * in place (no extra slot) — this collapses nested-dispatch intermediate
     * states and post-undo re-plays of an earlier tick to the latest state.
     */
    record(tick: number, snapshot: Readonly<TState>): void {
        const entry: RingBufferEntry<TState> = { tick, snapshot };
        const existing = this.#tickToSlot.get(tick);
        if (existing === undefined) {
            const evicted = this.#entries[this.#cursor];
            if (evicted !== undefined) {
                this.#tickToSlot.delete(evicted.tick);
            }
            this.#entries[this.#cursor] = entry;
            this.#tickToSlot.set(tick, this.#cursor);
            this.#cursor = (this.#cursor + 1) % this.#capacity;
        } else {
            this.#entries[existing] = entry;
        }
        this.onRecord?.(entry);
    }

    /** O(1) lookup; `undefined` when the tick was never recorded or evicted. */
    get(tick: number): RingBufferEntry<TState> | undefined {
        const slot = this.#tickToSlot.get(tick);
        return slot === undefined ? undefined : this.#entries[slot];
    }

    /** All buffered ticks, sorted newest first. */
    allTicks(): number[] {
        return [...this.#tickToSlot.keys()].sort((a, b) => b - a);
    }
}
