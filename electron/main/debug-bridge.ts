/**
 * electron/main/debug-bridge.ts
 *
 * Runtime Debug Layer bridge (§4.12 — runtime-debug-layer.md, F47 T5,
 * issue #694).
 *
 * Started exclusively via the `IS_DEBUG_MODE` dynamic-import gate in
 * `electron/main/index.ts` (Invariant #27) — this module is therefore the
 * gated debug graph and may statically import `simulation/debug`. It:
 *
 *   - instantiates `SnapshotRingBuffer` + `SnapshotInspector` per attached
 *     session (Invariant #31),
 *   - provides the `HostSessionDebugPort` consumed by
 *     `buildHostSessionPipeline` (observer → `PipelineContext.debugObserver`),
 *   - registers the `chimera:debug` ipcMain handler, validating
 *     `event.sender.id` against the Inspector window's `webContents.id` on
 *     EVERY request (Invariant #29); foreign senders get `{ type: 'ERROR' }`,
 *   - pushes `LIVE_TICK` to subscribers from the ring buffer's `onRecord`
 *     hook on the `chimera:debug:push` channel,
 *   - registers the data-free `chimera:debug:toggle-inspector` listener that
 *     lazily creates the Inspector `BrowserWindow` on first toggle (closed
 *     by default — NO window is created at bridge startup), closes it on the
 *     next toggle, and handles user-initiated close. In production neither
 *     handler exists, so a renderer toggle send is a true no-op.
 *
 * Handlers and request schemas are deliberately self-contained here instead
 * of `ipc/ipc-handlers.ts` / `ipc/ipc-schemas.ts`: they must only ever exist
 * in debug mode, and keeping them in this module keeps the debug graph out
 * of the production bundle (Invariant #27).
 *
 * ## Bridge-side action log and mementos
 *
 * The engine's `ActionHistory` exposes no full read, so the bridge keeps its
 * own bounded log + turn mementos (see `SnapshotInspectorOptions.getActionLog`
 * contract). Bookkeeping rules:
 *   - `engine:undo`/`engine:redo` are never appended (they have no reducer —
 *     replaying them would diverge). Undo moves the undone tail into a redo
 *     stash, drops now-invalid mementos, and rolls the turn high-water back
 *     so re-entered turn boundaries capture fresh mementos; redo restores
 *     from the stash; any normal append invalidates the stash (mirrors the
 *     UndoManager's redoBuffer semantics).
 *   - A normal entry whose `tickApplied` is not beyond the current tail
 *     triggers append-time compaction (warn-logged): this self-heals
 *     out-of-band rewinds such as save-restore, which replace the session
 *     snapshot without the pipeline firing.
 *   - The ring buffer has no removal API, so entries above the latest
 *     authoritative tick survive a rewind. Every snapshot-resolving query
 *     filters/rejects those superseded ticks (`tick_superseded_by_rewind`)
 *     so the Inspector never sees superseded-timeline data.
 *   - Known limitation (latent): an outer `engine:tick` whose nested timer
 *     dispatches advance the tick by more than one produces a single log
 *     entry, so memento replay across that window under-advances and yields
 *     an explicit `TickNotAvailableError` (`reconstruction_tick_mismatch`)
 *     → `{ type: 'ERROR' }` — degraded, never wrong data. The engine's own
 *     undo replay shares this exposure (Invariant #55 timer re-derivation).
 */

import { BrowserWindow } from 'electron';
import { z } from 'zod';
import {
    DEBUG_CHANNEL,
    DEBUG_PUSH_CHANNEL,
    DEBUG_TOGGLE_INSPECTOR_CHANNEL,
} from '@chimera/shared/constants.js';
import {
    SnapshotRingBuffer,
    SnapshotInspector,
    TickNotAvailableError,
} from '@chimera/simulation/debug/index.js';
import type {
    DebugRequest,
    DebugResponse,
    InspectorMemento,
} from '@chimera/simulation/debug/index.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import type { ActionHistoryEntry } from '@chimera/simulation/engine/UndoManager.js';
import type { StateProjector } from '@chimera/simulation/projection/StateProjector.js';
import type { Logger } from './logging/logger.js';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from './renderer-url.js';
import type { HostSessionDebugPort } from './runtime/HostSessionPipeline.js';

// Channel constants (DEBUG_CHANNEL, DEBUG_TOGGLE_INSPECTOR_CHANNEL,
// DEBUG_PUSH_CHANNEL) live in `shared/constants.ts` so the Inspector preload
// (F47 T6) shares the literals without importing this debug module graph.

// ─── Bounds (Invariant #30 spirit — nothing grows unboundedly) ────────────────

/** Bridge action-log cap; oldest entries drop FIFO beyond it. */
export const DEBUG_ACTION_LOG_CAPACITY = 5000;
/** Turn mementos retained for replay reconstruction (2× engine retention). */
export const DEBUG_MEMENTO_RETENTION = 8;

/** Inspector window dimensions — utilitarian dev tooling default. */
const INSPECTOR_WINDOW_WIDTH = 1100;
const INSPECTOR_WINDOW_HEIGHT = 800;

/**
 * Same dark bootstrap surface as the main window (`BOOTSTRAP_BACKGROUND_COLOR`
 * in `index.ts`) and the `--ch-color-surface` fallback in
 * `renderer/app/layout.tsx` — without it the window paints default white
 * while loading and stays white when the load fails (#701).
 */
const INSPECTOR_WINDOW_BACKGROUND_COLOR = '#111113';

/** Route served by the chimera:// renderer protocol (page ships in F47 T8). */
const INSPECTOR_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/debug/`;

/** Chromium net error for a superseded navigation — never a real failure. */
const ERR_ABORTED = -3;

// ─── Narrow DI interfaces (precedent: CleanExitIpcMain in index.ts) ───────────

/** Subset of `Electron.WebContents` the bridge touches. */
export interface DebugWebContentsLike {
    readonly id: number;
    send(channel: string, payload: unknown): void;
    isDestroyed(): boolean;
}

/** Subset of `Electron.IpcMainInvokeEvent` the handler reads. */
export interface DebugInvokeEvent {
    readonly sender: DebugWebContentsLike;
}

/** Subset of `Electron.BrowserWindow` the bridge manages. */
export interface DebugWindowLike {
    readonly webContents: DebugWebContentsLike;
    on(event: 'closed', handler: () => void): void;
    close(): void;
    isDestroyed(): boolean;
}

/** Web-contents surface the default Inspector window factory wires up. */
export interface InspectorWebContentsLike extends DebugWebContentsLike {
    setWindowOpenHandler(handler: () => { action: 'deny' }): void;
    on(
        event: 'will-navigate',
        listener: (event: { preventDefault(): void }, url: string) => void,
    ): void;
    on(
        event: 'did-navigate',
        listener: (
            event: unknown,
            url: string,
            httpResponseCode: number,
            httpStatusText: string,
        ) => void,
    ): void;
    on(
        event: 'did-fail-load',
        listener: (
            event: unknown,
            errorCode: number,
            errorDescription: string,
            validatedUrl: string,
            isMainFrame: boolean,
        ) => void,
    ): void;
    loadURL(url: string): Promise<void>;
}

/** `DebugWindowLike` whose web contents carries the full Inspector surface. */
export interface InspectorWindowLike extends DebugWindowLike {
    readonly webContents: InspectorWebContentsLike;
}

/** Plain-object constructor options for the Inspector `BrowserWindow`. */
export interface InspectorWindowOptions {
    readonly width: number;
    readonly height: number;
    readonly show: boolean;
    readonly backgroundColor: string;
    readonly webPreferences: {
        readonly nodeIntegration: boolean;
        readonly contextIsolation: boolean;
        readonly sandbox: boolean;
        readonly webSecurity: boolean;
        readonly preload: string;
    };
}

/** Subset of `Electron.IpcMain` the bridge registers on. */
export interface DebugIpcMain {
    handle(
        channel: string,
        handler: (event: DebugInvokeEvent, request: unknown) => DebugResponse,
    ): void;
    on(channel: string, listener: () => void): void;
    removeHandler(channel: string): void;
    removeListener(channel: string, listener: () => void): void;
}

// ─── Public surface ───────────────────────────────────────────────────────────

export interface StartDebugBridgeOptions {
    readonly ipcMain: DebugIpcMain;
    readonly logger: Logger;
    /** Compiled `debug-api.js` preload path (ships in F47 T6). */
    readonly debugPreloadPath: string;
    /** Inspector window factory override — tests inject in-process fakes. */
    readonly createWindow?: () => DebugWindowLike;
    /** Ring buffer capacity override (Invariant #30: always explicit-fixed). */
    readonly ringBufferCapacity?: number;
    /** Action-log cap override — tests only. */
    readonly actionLogCapacity?: number;
    /** Memento retention override — tests only. */
    readonly mementoRetention?: number;
}

/**
 * Per-session attach options. Both getters are lazy because the session's
 * projector and replay callback are declared after `attachSession` runs in
 * `onSessionHosted` (they are only invoked from IPC query handling, which
 * cannot run before the synchronous session wiring completes).
 */
export interface AttachSessionOptions {
    readonly getProjector: () => StateProjector;
    readonly getReplay: () => (
        state: Readonly<BaseGameSnapshot>,
        entries: readonly ActionHistoryEntry[],
    ) => Readonly<BaseGameSnapshot>;
}

export interface DebugBridge {
    /**
     * Binds the bridge to a freshly hosted session: resets the ring buffer,
     * inspector, action log, and mementos (live subscribers and the window
     * survive) and returns the `HostSessionDebugPort` to pass into
     * `buildHostSessionPipeline`. A port from a previous attach turns inert.
     */
    attachSession(options: AttachSessionOptions): HostSessionDebugPort;
    /** Removes IPC registrations and closes the Inspector window (tests). */
    stop(): void;
}

// ─── Request schema (kept local — see module header) ──────────────────────────

const tickSchema = z.number().int();

const debugRequestSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('GET_TICK_LIST') }).strict(),
    z.object({ type: z.literal('GET_SNAPSHOT'), tick: tickSchema }).strict(),
    z
        .object({
            type: z.literal('GET_PROJECTION'),
            tick: tickSchema,
            playerId: z.string().min(1).transform(toPlayerId),
        })
        .strict(),
    z.object({ type: z.literal('GET_DIFF'), fromTick: tickSchema, toTick: tickSchema }).strict(),
    z
        .object({
            type: z.literal('GET_ACTION_LOG'),
            fromTick: tickSchema.optional(),
            toTick: tickSchema.optional(),
        })
        .strict(),
    z.object({ type: z.literal('GET_PERF_STATS') }).strict(),
    z.object({ type: z.literal('SUBSCRIBE_LIVE') }).strict(),
    z.object({ type: z.literal('UNSUBSCRIBE_LIVE') }).strict(),
]);

// ─── Default Inspector window factory ─────────────────────────────────────────

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/**
 * Dark in-window diagnostic shown instead of the bare protocol 404 / load
 * error. The dominant cause is a stale renderer static export: the bridge can
 * exist while `renderer/out` predates the `/debug` route (F47 T8), in which
 * case the chimera:// protocol serves a blank "Not found" page (#701).
 */
function buildInspectorLoadFallbackUrl(failedUrl: string, detail: string): string {
    const html =
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
        '<title>Debug Inspector</title></head>' +
        `<body style="background-color:${INSPECTOR_WINDOW_BACKGROUND_COLOR};` +
        'color:#f4f4f5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'padding:24px;line-height:1.6">' +
        '<h1 style="font-size:18px;margin:0 0 12px">Debug Inspector page failed to load</h1>' +
        `<p style="margin:0 0 12px"><code>${escapeHtml(failedUrl)}</code> — ${escapeHtml(detail)}</p>` +
        '<p style="margin:0">The renderer build is likely stale and missing the /debug route. ' +
        'Rebuild it with <code>pnpm build:renderer</code>, then press F9 twice to reopen ' +
        'this window.</p>' +
        '</body></html>';
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export interface CreateInspectorWindowOptions {
    /** Window constructor — production passes `new BrowserWindow(...)`. */
    readonly newWindow: (options: InspectorWindowOptions) => InspectorWindowLike;
    readonly debugPreloadPath: string;
    readonly logger: Logger;
}

/**
 * Creates the Inspector `BrowserWindow`, hardened like `createMainWindow`
 * (WARN-2/WARN-3: no popups, no navigation outside the renderer protocol),
 * painted with the dark bootstrap surface, and self-diagnosing: a failed
 * document load (protocol 404 or net error) is replaced with an actionable
 * dark fallback page instead of a silent white window (#701).
 */
export function createInspectorWindow(options: CreateInspectorWindowOptions): InspectorWindowLike {
    const { logger } = options;
    const window = options.newWindow({
        width: INSPECTOR_WINDOW_WIDTH,
        height: INSPECTOR_WINDOW_HEIGHT,
        show: true,
        backgroundColor: INSPECTOR_WINDOW_BACKGROUND_COLOR,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            preload: options.debugPreloadPath,
        },
    });
    const { webContents } = window;

    const loadDiagnosticPage = (failedUrl: string, detail: string): void => {
        logger.warn(`[chimera] debug inspector failed to load: ${detail}`, { url: failedUrl });
        // A data: URL here is the diagnostic page itself — never re-enter.
        if (failedUrl.startsWith('data:') || webContents.isDestroyed()) {
            return;
        }
        webContents.loadURL(buildInspectorLoadFallbackUrl(failedUrl, detail)).catch(() => {
            // A rejected fallback load re-surfaces via did-fail-load, where
            // the data: guard above stops the recursion.
        });
    };

    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(`${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/`)) {
            event.preventDefault();
        }
    });
    // The chimera:// protocol answers a missing route with an HTTP-style 404,
    // which `did-fail-load` does NOT report — inspect the navigation status.
    webContents.on('did-navigate', (_event, url, httpResponseCode, httpStatusText) => {
        if (httpResponseCode >= 400) {
            loadDiagnosticPage(url, `HTTP ${httpResponseCode} ${httpStatusText}`);
        }
    });
    webContents.on(
        'did-fail-load',
        (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
            if (!isMainFrame || errorCode === ERR_ABORTED) {
                return;
            }
            loadDiagnosticPage(validatedUrl, `${errorDescription} (${errorCode})`);
        },
    );
    webContents.loadURL(INSPECTOR_URL).catch(() => {
        // Load failures surface through did-fail-load above.
    });
    return window;
}

// ─── Implementation ───────────────────────────────────────────────────────────

interface SessionState {
    readonly generation: number;
    readonly ringBuffer: SnapshotRingBuffer;
    readonly inspector: SnapshotInspector;
    readonly log: ActionHistoryEntry[];
    readonly mementos: InspectorMemento[];
    redoStash: ActionHistoryEntry[];
    lastTurnNumber: number | null;
    /**
     * Tick of the latest authoritative state seen (last observer/action
     * feed). After a rewind (undo or out-of-band) the ring buffer still
     * holds entries ABOVE this tick — the buffer has no removal API — and
     * those are superseded-timeline data: every query path filters them out
     * ("degraded, never wrong data").
     */
    latestTick: number | null;
}

export function startDebugBridge(options: StartDebugBridgeOptions): DebugBridge {
    const { ipcMain, logger } = options;
    const actionLogCapacity = options.actionLogCapacity ?? DEBUG_ACTION_LOG_CAPACITY;
    const mementoRetention = options.mementoRetention ?? DEBUG_MEMENTO_RETENTION;

    let session: SessionState | null = null;
    let generation = 0;
    let inspectorWindow: DebugWindowLike | null = null;
    const subscribers = new Map<number, DebugWebContentsLike>();

    // ── Live push ──────────────────────────────────────────────────────────
    const pushLiveTick = (tick: number, snapshot: Readonly<BaseGameSnapshot>): void => {
        if (subscribers.size === 0) {
            return;
        }
        const push: DebugResponse = { type: 'LIVE_TICK', tick, snapshot };
        for (const [id, sender] of subscribers) {
            if (sender.isDestroyed()) {
                subscribers.delete(id);
                continue;
            }
            sender.send(DEBUG_PUSH_CHANNEL, push);
        }
    };

    // ── Inspector window lifecycle ─────────────────────────────────────────
    const defaultCreateWindow = (): DebugWindowLike =>
        createInspectorWindow({
            newWindow: (windowOptions) => new BrowserWindow(windowOptions),
            debugPreloadPath: options.debugPreloadPath,
            logger,
        });
    const createWindow = options.createWindow ?? defaultCreateWindow;

    const handleToggle = (): void => {
        if (inspectorWindow !== null && !inspectorWindow.isDestroyed()) {
            inspectorWindow.close();
            return;
        }
        const window = createWindow();
        inspectorWindow = window;
        window.on('closed', () => {
            // Re-toggle race guard: only clear state if the ref still points
            // at THIS window — a stale event from a dead window must not
            // affect its successor.
            if (inspectorWindow === window) {
                inspectorWindow = null;
                subscribers.clear();
            }
        });
    };

    // ── chimera:debug request handling (Invariant #29) ─────────────────────
    const isInspectorSender = (event: DebugInvokeEvent): boolean =>
        inspectorWindow !== null &&
        !inspectorWindow.isDestroyed() &&
        event.sender.id === inspectorWindow.webContents.id;

    /**
     * Rejects snapshot-resolving queries for ticks above the latest
     * authoritative tick: such ring-buffer entries survive a rewind only
     * because the buffer has no removal API, and serving them would expose
     * superseded-timeline data with no indication. Thrown errors map to
     * `{ type: 'ERROR' }` in `handleDebugRequest`.
     */
    const assertTickNotSuperseded = (state: SessionState, tick: number): void => {
        if (state.latestTick !== null && tick > state.latestTick) {
            throw new TickNotAvailableError(tick, 'tick_superseded_by_rewind');
        }
    };

    const dispatchQuery = (
        state: SessionState,
        request: Exclude<DebugRequest, { type: 'SUBSCRIBE_LIVE' | 'UNSUBSCRIBE_LIVE' }>,
    ): DebugResponse => {
        const { inspector, latestTick } = state;
        switch (request.type) {
            case 'GET_TICK_LIST': {
                const ticks = inspector.listTicks();
                return {
                    type: 'TICK_LIST',
                    ticks:
                        latestTick === null
                            ? ticks
                            : ticks.filter((entry) => entry.tick <= latestTick),
                };
            }
            case 'GET_SNAPSHOT':
                assertTickNotSuperseded(state, request.tick);
                return {
                    type: 'SNAPSHOT',
                    tick: request.tick,
                    snapshot: inspector.getSnapshot(request.tick),
                };
            case 'GET_PROJECTION':
                assertTickNotSuperseded(state, request.tick);
                return {
                    type: 'PROJECTION',
                    tick: request.tick,
                    playerId: request.playerId,
                    snapshot: inspector.getProjection(request.tick, request.playerId),
                };
            case 'GET_DIFF':
                assertTickNotSuperseded(state, request.fromTick);
                assertTickNotSuperseded(state, request.toTick);
                return {
                    type: 'DIFF',
                    diff: inspector.diff(request.fromTick, request.toTick),
                };
            case 'GET_ACTION_LOG':
                return {
                    type: 'ACTION_LOG',
                    entries: inspector.getActionLog(request.fromTick, request.toTick),
                };
            case 'GET_PERF_STATS':
                return { type: 'PERF_STATS', stats: inspector.getPerfStats() };
        }
    };

    const handleDebugRequest = (event: DebugInvokeEvent, rawRequest: unknown): DebugResponse => {
        if (!isInspectorSender(event)) {
            return { type: 'ERROR', message: 'unauthorized sender' };
        }
        const parsed = debugRequestSchema.safeParse(rawRequest);
        if (!parsed.success) {
            return { type: 'ERROR', message: 'malformed debug request' };
        }
        // Subscription state is bridge-level: the Inspector window outlives
        // sessions, so subscribe/unsubscribe never require an attached one.
        if (parsed.data.type === 'SUBSCRIBE_LIVE') {
            subscribers.set(event.sender.id, event.sender);
            return { type: 'ACK' };
        }
        if (parsed.data.type === 'UNSUBSCRIBE_LIVE') {
            subscribers.delete(event.sender.id);
            return { type: 'ACK' };
        }
        if (session === null) {
            return { type: 'ERROR', message: 'no active session' };
        }
        // Zod `.optional()` infers `number | undefined`, which
        // `exactOptionalPropertyTypes` rejects against the protocol's
        // exact-optional GET_ACTION_LOG fields — rebuild that member with
        // absent (not undefined-assigned) keys so no assertion is needed.
        const request: Exclude<DebugRequest, { type: 'SUBSCRIBE_LIVE' | 'UNSUBSCRIBE_LIVE' }> =
            parsed.data.type === 'GET_ACTION_LOG'
                ? {
                      type: 'GET_ACTION_LOG',
                      ...(parsed.data.fromTick !== undefined
                          ? { fromTick: parsed.data.fromTick }
                          : {}),
                      ...(parsed.data.toTick !== undefined ? { toTick: parsed.data.toTick } : {}),
                  }
                : parsed.data;
        try {
            return dispatchQuery(session, request);
        } catch (err: unknown) {
            return { type: 'ERROR', message: err instanceof Error ? err.message : String(err) };
        }
    };

    ipcMain.handle(DEBUG_CHANNEL, handleDebugRequest);
    ipcMain.on(DEBUG_TOGGLE_INSPECTOR_CHANNEL, handleToggle);

    // ── Session bookkeeping ────────────────────────────────────────────────
    const recordSnapshot = (
        state: SessionState,
        tick: number,
        snapshot: Readonly<BaseGameSnapshot>,
    ): void => {
        state.latestTick = tick;
        state.ringBuffer.record(tick, snapshot);
        if (state.lastTurnNumber === null || snapshot.turnNumber > state.lastTurnNumber) {
            state.lastTurnNumber = snapshot.turnNumber;
            state.mementos.push({ tickAtTurnStart: tick, snapshotAtTurnStart: snapshot });
            while (state.mementos.length > mementoRetention) {
                state.mementos.shift();
            }
        }
    };

    const dropMementosAbove = (state: SessionState, tick: number): void => {
        for (let i = state.mementos.length - 1; i >= 0; i--) {
            if ((state.mementos[i]?.tickAtTurnStart ?? 0) > tick) {
                state.mementos.splice(i, 1);
            }
        }
    };

    const recordActionApplied = (
        state: SessionState,
        entry: ActionHistoryEntry,
        next: Readonly<BaseGameSnapshot>,
        durationMs: number,
    ): void => {
        // Belt-and-braces with recordSnapshot — the observer fires first on
        // every pipeline path, but a failed observer must not leave query
        // filtering on a stale authoritative tick.
        state.latestTick = next.tick;
        const actionType = entry.action.type;
        if (actionType === 'engine:undo') {
            // Move the undone tail into the redo stash (chronological order
            // preserved: compacted ticks are strictly below existing stash
            // ticks). The undo action itself is never logged.
            const splitIndex = state.log.findIndex((e) => e.tickApplied >= next.tick);
            if (splitIndex !== -1) {
                const removed = state.log.splice(splitIndex);
                state.redoStash = [...removed, ...state.redoStash];
            }
            dropMementosAbove(state, next.tick);
            // Roll the turn high-water back with the rewind so a re-entered
            // turn boundary captures a FRESH memento — without this the
            // `snapshot.turnNumber > lastTurnNumber` guard in recordSnapshot
            // would suppress it and reconstruction would lean on a stale,
            // earlier base than the documented retention implies.
            state.lastTurnNumber = next.turnNumber;
        } else if (actionType === 'engine:redo') {
            // No lastTurnNumber bookkeeping needed here: redo only moves
            // forward, and the observer fired first with the redone state,
            // so recordSnapshot already advanced the high-water (and captured
            // a memento) when the redo crossed a turn boundary.
            const restored = state.redoStash.filter((e) => e.tickApplied < next.tick);
            state.redoStash = state.redoStash.filter((e) => e.tickApplied >= next.tick);
            state.log.push(...restored);
        } else {
            // Append-time defensive compaction: self-heals out-of-band
            // rewinds (e.g. save restore) that bypass the pipeline. O(1)
            // fast path: the log is tickApplied-ascending, so an entry
            // strictly beyond the current tail can never need compaction.
            const tail = state.log[state.log.length - 1];
            if (tail !== undefined && entry.tickApplied <= tail.tickApplied) {
                // The tail satisfies the predicate, so findIndex always hits.
                const splitIndex = state.log.findIndex((e) => e.tickApplied >= entry.tickApplied);
                const dropped = state.log.splice(splitIndex);
                logger.warn('debug action log compacted on out-of-band tick regression', {
                    droppedEntries: dropped.length,
                    tickApplied: entry.tickApplied,
                });
                dropMementosAbove(state, entry.tickApplied);
                // Same high-water rollback as the undo branch — an
                // out-of-band rewind re-enters earlier turns too.
                state.lastTurnNumber = next.turnNumber;
            }
            state.redoStash = [];
            state.log.push(entry);
            while (state.log.length > actionLogCapacity) {
                state.log.shift();
            }
        }
        state.inspector.recordTickDuration(next.tick, durationMs);
    };

    const attachSession = (attachOptions: AttachSessionOptions): HostSessionDebugPort => {
        generation += 1;
        const myGeneration = generation;
        const ringBuffer =
            options.ringBufferCapacity === undefined
                ? new SnapshotRingBuffer()
                : new SnapshotRingBuffer(options.ringBufferCapacity);
        ringBuffer.onRecord = (entry) => {
            pushLiveTick(entry.tick, entry.snapshot);
        };
        const log: ActionHistoryEntry[] = [];
        const mementos: InspectorMemento[] = [];
        const inspector = new SnapshotInspector({
            ringBuffer,
            // Lazy wrappers — see AttachSessionOptions.
            projector: {
                project: (fullState, viewerId) =>
                    attachOptions.getProjector().project(fullState, viewerId),
            },
            getActionLog: () => log,
            getMementos: () => mementos,
            replay: (state, entries) => attachOptions.getReplay()(state, entries),
        });
        const state: SessionState = {
            generation: myGeneration,
            ringBuffer,
            inspector,
            log,
            mementos,
            redoStash: [],
            lastTurnNumber: null,
            latestTick: null,
        };
        session = state;

        // Both callbacks run on the live action path and must NEVER throw —
        // `observer` is invoked unguarded by ActionPipeline (§4.12 observer
        // contract); failures are logged and reported over the debug channel
        // only as missing data.
        return {
            observer: (tick, snapshot) => {
                if (myGeneration !== generation) {
                    return;
                }
                try {
                    recordSnapshot(state, tick, snapshot);
                } catch (err: unknown) {
                    logger.error(
                        'debug observer failed',
                        err instanceof Error ? err : new Error(String(err)),
                        { tick },
                    );
                }
            },
            onActionApplied: (entry, next, durationMs) => {
                if (myGeneration !== generation) {
                    return;
                }
                try {
                    recordActionApplied(state, entry, next, durationMs);
                } catch (err: unknown) {
                    logger.error(
                        'debug onActionApplied failed',
                        err instanceof Error ? err : new Error(String(err)),
                        { actionType: entry.action.type },
                    );
                }
            },
        };
    };

    const stop = (): void => {
        ipcMain.removeHandler(DEBUG_CHANNEL);
        ipcMain.removeListener(DEBUG_TOGGLE_INSPECTOR_CHANNEL, handleToggle);
        if (inspectorWindow !== null && !inspectorWindow.isDestroyed()) {
            inspectorWindow.close();
        }
        inspectorWindow = null;
        subscribers.clear();
        session = null;
        generation += 1;
    };

    return { attachSession, stop };
}
