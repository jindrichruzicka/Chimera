// renderer/logging/__test-support__/RecordingLogsApi.ts
//
// Recording LogsAPI double (testing standards: doubles live in
// __test-support__/ only). `emit` is a vi.fn so toHaveBeenCalledWith works;
// `emitCalls` records the bare entries in order for content assertions.

import { vi } from 'vitest';
import type { LogEntry } from '@chimera-engine/simulation/foundation/logging.js';
import type { LogsAPI } from '@chimera-engine/simulation/bridge/api-types.js';

export interface RecordingLogsApi extends LogsAPI {
    readonly emitCalls: LogEntry[];
}

export function createRecordingLogsApi(): RecordingLogsApi {
    const emitCalls: LogEntry[] = [];
    return {
        emit: vi.fn((entry: LogEntry) => {
            emitCalls.push(entry);
        }),
        readRecent: vi.fn(() => Promise.resolve([])),
        emitCalls,
    };
}
