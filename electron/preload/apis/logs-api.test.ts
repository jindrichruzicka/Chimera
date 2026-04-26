// electron/preload/logs-api.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { LogEntry } from '@chimera/shared/logging.js';
import { buildLogsApi, LOGS_EMIT_CHANNEL, LOGS_READ_RECENT_CHANNEL } from './logs-api.js';

const SAMPLE_ENTRY: LogEntry = {
    level: 'info',
    message: 'test',
    timestamp: 1000,
    source: { process: 'renderer', module: 'test' },
};

describe('buildLogsApi', () => {
    it('emit() calls ipcRenderer.send with LOGS_EMIT_CHANNEL and the entry', () => {
        const send = vi.fn<(channel: string, arg: unknown) => void>();
        const invoke = vi.fn<(channel: string, arg?: unknown) => Promise<unknown>>();
        const api = buildLogsApi({ send, invoke });

        api.emit(SAMPLE_ENTRY);

        expect(send).toHaveBeenCalledWith(LOGS_EMIT_CHANNEL, SAMPLE_ENTRY);
    });

    it('readRecent(10) calls ipcRenderer.invoke with LOGS_READ_RECENT_CHANNEL and maxEntries=10', async () => {
        const send = vi.fn<(channel: string, arg: unknown) => void>();
        const invoke = vi
            .fn<(channel: string, arg?: unknown) => Promise<unknown>>()
            .mockResolvedValue([SAMPLE_ENTRY]);
        const api = buildLogsApi({ send, invoke });

        const result = await api.readRecent(10);

        expect(invoke).toHaveBeenCalledWith(LOGS_READ_RECENT_CHANNEL, 10);
        expect(result).toEqual([SAMPLE_ENTRY]);
    });

    it('readRecent returns empty array when invoke resolves with empty array', async () => {
        const send = vi.fn<(channel: string, arg: unknown) => void>();
        const invoke = vi
            .fn<(channel: string, arg?: unknown) => Promise<unknown>>()
            .mockResolvedValue([]);
        const api = buildLogsApi({ send, invoke });

        const result = await api.readRecent(5);

        expect(result).toEqual([]);
    });
});
