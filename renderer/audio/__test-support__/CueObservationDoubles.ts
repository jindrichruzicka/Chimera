/**
 * renderer/audio/__test-support__/CueObservationDoubles.ts
 *
 * The two doubles cue observation is measured through: the per-frame clock the
 * sampler's chain runs on, under a test's control — nothing fires until
 * {@link FrameSourceDouble.fire} is called — and an observer that keeps its batch.
 *
 * Shared by the sampler's own tests and the manager's, so both measure the chain the
 * same way — "how many frames were REQUESTED" and "how many are in flight" are
 * different questions, and a chain that re-arms twice per frame is only visible in the
 * second one.
 */

import type { CueEvent, CueHandlers } from '../cueMarkerScheduler';
import type { FrameSource } from '../cueSampler';

export class FrameSourceDouble implements FrameSource {
    /** Every id handed to {@link cancel}, in order. */
    public readonly cancelled: number[] = [];
    /** How many frames were ever asked for — a chain that never re-arms stops rising. */
    public requestCount = 0;

    private nextId = 1;
    private readonly scheduled = new Map<number, () => void>();

    public request(callback: () => void): number {
        this.requestCount += 1;
        const id = this.nextId;
        this.nextId += 1;
        this.scheduled.set(id, callback);
        return id;
    }

    public cancel(id: number): void {
        this.cancelled.push(id);
        this.scheduled.delete(id);
    }

    /**
     * Run every frame currently scheduled. Drained BEFORE the callbacks run, so a chain
     * that re-arms leaves exactly one new frame behind rather than re-entering this one.
     */
    public fire(): void {
        const callbacks = Array.from(this.scheduled.values());
        this.scheduled.clear();
        for (const callback of callbacks) {
            callback();
        }
    }

    /** Frames in flight. More than one means the chain armed itself twice. */
    public get pendingCount(): number {
        return this.scheduled.size;
    }
}

/**
 * An observer that keeps every event it is handed, in order — so a test asserts one
 * batch rather than three separate handler spies whose relative order it cannot see.
 */
export function recordCueEvents(): {
    readonly events: CueEvent[];
    readonly handlers: CueHandlers;
} {
    const events: CueEvent[] = [];
    return {
        events,
        handlers: {
            onCue: (event) => events.push(event),
            onLoop: (event) => events.push(event),
            onEnd: (event) => events.push(event),
        },
    };
}
