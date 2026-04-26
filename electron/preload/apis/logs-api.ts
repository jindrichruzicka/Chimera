// electron/preload/logs-api.ts
//
// Implements the `window.__chimera.logs` namespace exposed to the renderer
// (§4.27, §4.32). Only depends on a narrow `LogsApiIpcPort` so the factory
// is trivially testable without spinning up Electron.
//
// Channel names live here; main-process ipc-handlers.ts imports them to
// guarantee the channel strings match on both sides (invariant 5).

import type { LogEntry } from '@chimera/shared/logging.js';
import type { LogsAPI } from '../api-types.js';

/** `ipcRenderer.send` target — renderer emits a log entry. */
export const LOGS_EMIT_CHANNEL = 'chimera:logs:emit';

/** `ipcRenderer.invoke` target — renderer requests recent log entries. */
export const LOGS_READ_RECENT_CHANNEL = 'chimera:logs:readRecent';

/**
 * Narrow port over `ipcRenderer`. Keeps the factory testable without
 * importing the real Electron module.
 */
export interface LogsApiIpcPort {
    send(channel: string, arg: unknown): void;
    invoke(channel: string, arg?: unknown): Promise<unknown>;
}

/**
 * Build the `window.__chimera.logs` namespace.
 *
 * - `emit(entry)` is fire-and-forget: the renderer does not need a
 *   round-trip response to continue execution (Invariant 5).
 * - `readRecent(maxEntries)` is an invoke so the renderer can await the
 *   result and surface the entry list to the user (e.g. a debug overlay).
 */
export function buildLogsApi(ipc: LogsApiIpcPort): LogsAPI {
    return {
        emit(entry: LogEntry): void {
            ipc.send(LOGS_EMIT_CHANNEL, entry);
        },
        readRecent(maxEntries: number): Promise<LogEntry[]> {
            return ipc.invoke(LOGS_READ_RECENT_CHANNEL, maxEntries) as Promise<LogEntry[]>;
        },
    };
}
