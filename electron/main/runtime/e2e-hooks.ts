/**
 * electron/main/runtime/e2e-hooks.ts
 *
 * CHIMERA_E2E-gated __e2eHooks main-process contract.
 *
 * Registers a global `__e2eHooks` object when `CHIMERA_E2E=1` so E2E tests
 * can read live tick/checksum/snapshot/save state from the host process
 * without going through IPC.
 *
 * Architecture reference: §13.9, §13.10 — E2E hooks and CHIMERA_E2E flag.
 * Issue: #458
 * Issue: #530
 *
 * Invariants upheld:
 *   #3  — lastHostSnapshot stores PlayerSnapshot only, never GameSnapshot.
 *   #8  — hook snapshots are intended to be supplied after StateProjector.project().
 *   #27 — CHIMERA_E2E is a test-only flag and absent/0 means no hook is set.
 */

import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';
import type { ChatMessage } from '@chimera-engine/simulation/foundation/chat.js';
import { createRingBuffer } from './ws-ring-buffer.js';

/** Maximum number of WebSocket frames retained in the E2E buffer. Oldest frames are evicted when this limit is reached. */
export const MAX_WS_FRAMES = 10_000;

/** A single WebSocket frame recorded by the CHIMERA_E2E networking hook. */
export interface WsFrame {
    readonly direction: 'inbound' | 'outbound';
    readonly data: string;
    readonly timestamp: number;
}

export type E2eFirstPlayerRole = 'host' | 'client';

export interface E2eHooks {
    readonly lastHostSnapshot: PlayerSnapshot | null;
    /** Reflects the last broadcast viewer processed by StateBroadcaster, not necessarily the host. */
    readonly lastChecksum: number;
    readonly broadcastChecksums: Readonly<Record<string, number>>;
    readonly currentTick: number;
    /** Last qualified save slot persisted through the CHIMERA_E2E path, or null before the first save. */
    lastSavedSlotId: string | null;
    /** GameSnapshot.tick captured in the last persisted save, or null before the first save. */
    lastSavedTick: number | null;
    firstPlayerRole: E2eFirstPlayerRole;
    /**
     * Lobby code set by the host process in direct-game E2E mode
     * (`CHIMERA_E2E_DIRECT_GAME_ROLE=host`) so the client fixture can read
     * it via `hostApp.evaluate()` and pass it as
     * `CHIMERA_E2E_DIRECT_GAME_JOIN_ADDRESS` without going through lobby UI.
     *
     * `null` until `hostLobby()` resolves; the fixture polls until non-null.
     */
    directGameLobbyCode: string | null;
    /**
     * WebSocket frames recorded by the networking-layer CHIMERA_E2E hook. Initialized lazily by tapWebSocketFrames().
     * @chimera-review: intentionally mutable — field is assigned/reset externally by ws-inspector helpers
     * (tapWebSocketFrames/clearCapturedFrames). Uses an O(1) ring-buffer internally; assigning `[]`
     * creates a fresh ring and assigning `undefined` deactivates capture.
     */
    wsFrames: WsFrame[] | undefined;
    /**
     * Append a WebSocket frame to the bounded buffer. When the buffer reaches MAX_WS_FRAMES, the oldest
     * frame is evicted (FIFO). No-op when wsFrames has not been initialized by tapWebSocketFrames().
     * Networking-layer CHIMERA_E2E hooks must use this method rather than pushing directly.
     */
    pushWsFrame(frame: WsFrame): void;
    onBroadcastChecksum(tick: number, viewerId: string, checksum: number): void;
    onTick(tick: number, checksum: number, snapshot: PlayerSnapshot): void;
    onClockTick(tick: number, viewerId: string): void;
    /**
     * Advance the simulation clock by one tick.
     *
     * No-op until wired by the session runtime — the runtime replaces this
     * property after creating the hooks object so the tick dispatch goes
     * through the registered `ActionPipeline` path (Invariant #6).
     *
     * Must NOT be called from `simulation/` or `renderer/` — this property
     * exists only for the CHIMERA_E2E test path.
     *
     * @chimera-review: intentionally mutable — replaced by session runtime
     *   to connect the hook to the real ActionPipeline dispatch.
     */
    dispatchTick: () => void;
    /**
     * Deliver a synthetic {@link ChatMessage} straight to the local `ChatHub`,
     * bypassing the relay + rate limit (both irrelevant to the renderer rolling
     * buffer cap). Lets E2E exercise the 500-entry `chatStore` trimming through
     * the real `ChatHub → CHAT_MESSAGE_CHANNEL → chatStore → ChatPanel` path
     * without fighting the 20/minute token bucket and `Date.now` clock.
     *
     * No-op-throws until wired by the composition root (mirrors `dispatchTick`).
     * Must NOT be called from `simulation/` or `renderer/` — this property exists
     * only for the CHIMERA_E2E test path. Chat is a cosmetic side-channel and is
     * never recorded in `tick`/replays/saves (Invariant #72).
     *
     * @chimera-review: intentionally mutable — replaced by the composition root
     *   to connect the hook to the real `ChatHub.deliverLocal` sink.
     */
    deliverChat: (message: ChatMessage) => void;
}

declare global {
    var __e2eHooks: E2eHooks | undefined;
}

export function createE2eHooks(): E2eHooks {
    const state = {
        lastHostSnapshot: null as PlayerSnapshot | null,
        lastChecksum: 0,
        broadcastChecksums: {} as Record<string, number>,
        currentTick: 0,
        lastSavedSlotId: null as string | null,
        lastSavedTick: null as number | null,
    };

    // Internal ring-buffer. `undefined` means the buffer has not yet been
    // activated (tapWebSocketFrames has not been called). When activated, any
    // assignment to `wsFrames` (including []) creates a fresh ring so that
    // pushWsFrame always uses O(1) eviction instead of Array.shift().
    let _ring: WsFrame[] | undefined = undefined;

    const hooks: E2eHooks = {
        get lastHostSnapshot() {
            return state.lastHostSnapshot;
        },
        get lastChecksum() {
            return state.lastChecksum;
        },
        get broadcastChecksums() {
            return { ...state.broadcastChecksums };
        },
        get currentTick() {
            return state.currentTick;
        },
        get lastSavedSlotId() {
            return state.lastSavedSlotId;
        },
        set lastSavedSlotId(value: string | null) {
            state.lastSavedSlotId = value;
        },
        get lastSavedTick() {
            return state.lastSavedTick;
        },
        set lastSavedTick(value: number | null) {
            state.lastSavedTick = value;
        },
        firstPlayerRole: 'host',
        directGameLobbyCode: null,
        get wsFrames(): WsFrame[] | undefined {
            return _ring;
        },
        set wsFrames(value: WsFrame[] | undefined) {
            if (value === undefined) {
                _ring = undefined;
            } else {
                // Any assignment ([] from tapWebSocketFrames / clearCapturedFrames)
                // creates a fresh O(1) ring-buffer regardless of the assigned value.
                _ring = createRingBuffer<WsFrame>(MAX_WS_FRAMES);
            }
        },
        pushWsFrame(frame: WsFrame): void {
            if (_ring === undefined) return;
            // O(1): createRingBuffer overrides push with ring-eviction logic.
            _ring.push(frame);
        },
        onBroadcastChecksum(tick, viewerId, checksum): void {
            state.currentTick = tick;
            state.lastChecksum = checksum;
            state.broadcastChecksums[viewerId] = checksum;
        },
        onTick(tick, checksum, snapshot): void {
            state.currentTick = tick;
            state.lastChecksum = checksum;
            state.broadcastChecksums[snapshot.viewerId] = checksum;
            state.lastHostSnapshot = snapshot;
        },
        onClockTick(tick): void {
            state.currentTick = tick;
        },
        // Guard: throw loudly if called before the session runtime wires a real dispatch
        // function. A silent no-op here would let soak tests (e.g. 1 000-tick convergence)
        // advance zero ticks and produce a subtly wrong checksum with no error signal.
        // The session runtime must assign: hooks.dispatchTick = () => pipeline.dispatch(tickAction)
        // before any E2E spec calls tick() (§13.7).
        dispatchTick: () => {
            throw new Error(
                'dispatchTick has not been wired by the session runtime. ' +
                    'Assign hooks.dispatchTick = () => pipeline.dispatch(tickAction) ' +
                    'in SessionRuntime (or equivalent) before calling tick() from E2E specs.',
            );
        },
        // Guard: throw loudly if called before the composition root wires the
        // real ChatHub sink. A silent no-op here would let the chat 500-cap E2E
        // spec poll on an unchanged message count and pass without delivering
        // anything. The composition root must assign:
        // hooks.deliverChat = (message) => chatHub.deliverLocal(message)
        // before any E2E spec calls deliverChat() (§13.7).
        deliverChat: () => {
            throw new Error(
                'deliverChat has not been wired by the composition root. ' +
                    'Assign hooks.deliverChat = (message) => chatHub.deliverLocal(message) ' +
                    'in index.ts before calling deliverChat() from E2E specs.',
            );
        },
    };
    return hooks;
}

export function registerE2eHooks(
    env: Readonly<Record<string, string | undefined>> = process.env,
): E2eHooks | undefined {
    if (env['CHIMERA_E2E'] !== '1') {
        Reflect.deleteProperty(globalThis, '__e2eHooks');
        return undefined;
    }

    const hooks = createE2eHooks();
    globalThis.__e2eHooks = hooks;
    return hooks;
}

export function getE2eHooks(): E2eHooks | undefined {
    return globalThis.__e2eHooks;
}
