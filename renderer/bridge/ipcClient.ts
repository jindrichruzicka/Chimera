/**
 * renderer/bridge/ipcClient.ts
 *
 * Typed bridge between renderer game state and the `window.__chimera.game`
 * IPC surface. Wires the authoritative snapshot stream into the `gameStore`
 * via `applySnapshot`.
 *
 * Snapshot application can be paced against the DISPLAY rather than against IPC
 * arrival: the newest snapshot is held and applied on the next frame. Whether
 * it is paced is the caller's, through the factory's `scheduler` argument. Under
 * pacing it is newest-wins: a snapshot superseded inside one frame is dropped,
 * never queued, because a queue would both add latency and grow without bound
 * if the host outpaced the renderer. The clock (`onTick`) is never paced, and
 * it writes the store on every beat.
 *
 * Architecture reference: §4.4 — Renderer State Stores
 *
 * Module boundary rules (hard constraints):
 *  - Must NOT import from electron/main/, apps/<name>/data, or any DOM API.
 *  - Renderer interacts with the store's `apply*` methods only; simulation
 *    types stay in simulation/.
 *
 * Invariants upheld:
 *  #3  — `GameSnapshot` never crosses the IPC boundary; only `PlayerSnapshot`.
 *  #4  — Renderer never writes simulation state directly; all writes go
 *          through `sendAction()` → IPC → `ActionPipeline`. `applySnapshot`
 *          and `applyTick` are `// ipcClient only`; components never call
 *          them.
 */

import type {
    EngineAction,
    PlayerSnapshot,
    Unsubscribe,
} from '@chimera-engine/simulation/bridge/api-types.js';

// ── Port interface ────────────────────────────────────────────────────────────

/**
 * Minimal surface of `window.__chimera.game` needed by `ipcClient`.
 * Typed as a narrow interface so tests can inject a double without
 * importing the full `GameAPI`.
 */
export interface IpcGamePort {
    /** Dispatch an action to the simulation host via IPC (fire-and-forget). */
    sendAction(action: EngineAction): void;
    /** Subscribe to projected `PlayerSnapshot` pushes. */
    onSnapshot(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe;
    /** Subscribe to tick-only clock updates. */
    onTick(cb: (tick: number) => void): Unsubscribe;
}

// ── Store interface ───────────────────────────────────────────────────────────

/**
 * Narrow `GameStore` snapshot surface that `ipcClient` is allowed to write.
 * Components must never call these methods directly.
 */
export interface IpcSnapshotStore {
    /** ipcClient only — applies authoritative snapshot from host. */
    applySnapshot(snapshot: PlayerSnapshot): void;
    /** ipcClient only — applies authoritative tick-only updates from host. */
    applyTick(tick: number): void;
}

// ── IpcClient interface ───────────────────────────────────────────────────────

export interface IpcClient {
    /** Dispatch `action` via IPC. */
    sendAction(action: EngineAction): void;
    /**
     * Register the `onSnapshot` push listener. Must be called once at
     * renderer bootstrap. Returns an `Unsubscribe` function.
     */
    bootstrap(): Unsubscribe;
    /**
     * Apply a snapshot waiting on the frame clock NOW, and take that frame off
     * the clock.
     *
     * For a caller that is about to write the store from outside this client
     * and needs the two writes ordered — `bootstrapGameStore`'s catch-up, which
     * compares against the newest snapshot it has seen APPLIED. A pending
     * arrival flushing after that comparison would land an older snapshot on
     * top of a newer one.
     */
    flush(): void;
}

// ── Frame clock ───────────────────────────────────────────────────────────────

/**
 * The display clock snapshot application is paced against.
 *
 * Injected rather than reached for, so tests drive frames by hand — jsdom's
 * `requestAnimationFrame` has no real display timing — and so a host with no
 * frame clock at all has somewhere to say so.
 */
export interface FrameScheduler {
    /** Run `callback` on the next frame; returns a handle for {@link cancel}. */
    request(callback: () => void): number;
    /** Withdraw a frame requested earlier. */
    cancel(handle: number): void;
}

/**
 * Applies on arrival, exactly as the bridge did before it was paced.
 *
 * The off switch: a consumer that must see a snapshot in the same turn it
 * arrives passes this. It runs its callback BEFORE returning a handle, which
 * the client accounts for — see the `scheduled` flag in `createIpcClient`.
 */
export const immediateFrameScheduler: FrameScheduler = {
    request(callback: () => void): number {
        callback();
        return 0;
    },
    cancel(): void {
        // Nothing is ever outstanding: `request` finished the work.
    },
};

/**
 * Picks per request: the frame clock while `shouldPace()` holds, application on
 * arrival otherwise.
 *
 * Per REQUEST rather than once, because the two ends do not meet — the client is
 * built at app start and the declaration that decides pacing arrives when a
 * match loads.
 */
export function createConditionalFrameScheduler(
    shouldPace: () => boolean,
    frames: FrameScheduler = defaultFrameScheduler(),
): FrameScheduler {
    return {
        request(callback: () => void): number {
            return (shouldPace() ? frames : immediateFrameScheduler).request(callback);
        },
        cancel(handle: number): void {
            // The immediate arm finishes inside `request`, so a handle worth
            // cancelling can only have come from the frame clock. A caller that
            // cancels a handle the immediate arm returned reaches a no-op here,
            // which is what that arm's own `cancel` is.
            frames.cancel(handle);
        },
    };
}

/**
 * The frame clock when one exists, and application on arrival when it does not
 * — a renderer bundle evaluated with no DOM must not silently stop applying
 * snapshots.
 */
export function defaultFrameScheduler(): FrameScheduler {
    const request = globalThis.requestAnimationFrame;
    const cancel = globalThis.cancelAnimationFrame;
    if (typeof request !== 'function' || typeof cancel !== 'function') {
        return immediateFrameScheduler;
    }
    return {
        request: (callback: () => void): number => request(() => callback()),
        cancel: (handle: number): void => {
            cancel(handle);
        },
    };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a typed IPC client.
 *
 * @param port          - Narrow `GameAPI` surface (`window.__chimera.game`).
 * @param store         - `GameStore` snapshot write surface (ipcClient only).
 * @param scheduler     - What snapshot application is paced against. Defaults to
 *                        application on arrival, the behaviour every game had
 *                        before the pacing existed: pacing is opted into, never
 *                        inherited, and a default that paced would opt a new
 *                        call site into the configuration measured to break the
 *                        turn-based e2e suite.
 */
export function createIpcClient(
    port: IpcGamePort,
    store: IpcSnapshotStore,
    scheduler: FrameScheduler = immediateFrameScheduler,
): IpcClient {
    // NEWEST-WINS, never a queue. A snapshot superseded inside one frame is
    // dropped where it stands: draining it on a later frame would put the
    // renderer a whole frame behind the host for no gain, and a backlog the
    // host can outpace has no bound.
    let pending: PlayerSnapshot | null = null;
    // The newest clock-only beat that landed WHILE a snapshot was waiting on a
    // frame, and nothing else. Deliberately not a running high-water mark of
    // every beat: a snapshot may legitimately carry a LOWER tick than the clock
    // — a restore rewinds the match to a checkpoint — and only a beat that
    // arrived inside the pending window is evidence that the host's clock has
    // genuinely moved past what this snapshot carries.
    let beatWhilePending: number | null = null;
    // Separate from the handle because a scheduler may run its callback BEFORE
    // returning one (`immediateFrameScheduler`). The flag is raised before the
    // request and lowered by the frame, so a synchronous scheduler leaves it
    // down and the next arrival schedules again.
    let scheduled = false;
    let frameHandle: number | null = null;

    function applyPending(): void {
        const snapshot = pending;
        const beat = beatWhilePending;
        pending = null;
        beatWhilePending = null;
        if (snapshot === null) {
            return;
        }
        store.applySnapshot(snapshot);
        // `applySnapshot` writes `currentTick: snapshot.tick`, so a snapshot
        // held for a frame can put the clock BEHIND a beat that already
        // arrived on the un-paced channel. Un-paced this was impossible —
        // arrival order was tick order — and the store clock is what stamps
        // every dispatched action, so a rewind sends the host an envelope from
        // its own past. Re-assert the beat, and only when it is genuinely
        // ahead.
        if (beat !== null && beat > snapshot.tick) {
            store.applyTick(beat);
        }
    }

    function onFrame(): void {
        scheduled = false;
        frameHandle = null;
        applyPending();
    }

    function cancelFrame(): void {
        if (frameHandle !== null) {
            scheduler.cancel(frameHandle);
        }
        scheduled = false;
        frameHandle = null;
    }

    return {
        sendAction(action: EngineAction): void {
            port.sendAction(action);
        },

        flush(): void {
            cancelFrame();
            applyPending();
        },

        bootstrap(): Unsubscribe {
            const unsubscribeSnapshot = port.onSnapshot((snapshot: PlayerSnapshot) => {
                pending = snapshot;
                if (scheduled) {
                    return;
                }
                scheduled = true;
                const handle = scheduler.request(onFrame);
                // Only record the handle if the frame has not already run: a
                // synchronous scheduler has lowered the flag by now, and
                // storing its handle would leave a cancel to fire against
                // nothing.
                if (scheduled) {
                    frameHandle = handle;
                }
            });
            const unsubscribeTick = port.onTick((tick: number) => {
                // NOT coalesced: a clock-only beat carries one scalar, and
                // holding it for a frame would delay the cheapest update the
                // bridge has for the sake of the most expensive one.
                store.applyTick(tick);
                if (pending !== null) {
                    beatWhilePending = tick;
                }
            });

            return (): void => {
                unsubscribeSnapshot();
                unsubscribeTick();
                cancelFrame();
                // Dropped as well as cancelled: a scheduler that fires a
                // cancelled frame anyway must find nothing to write, because
                // the store this would write to is being torn down. The beat
                // window needs no matching line — it is only ever spent
                // alongside a snapshot, and a frame that finds none clears it
                // on the way out.
                pending = null;
            };
        },
    };
}
