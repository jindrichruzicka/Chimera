'use client';

import { useEffect } from 'react';
import type { LogsAPI } from '@chimera/electron/preload/api-types.js';
import { installRendererLogger } from '../logging/rendererLogger';

export function LoggingBootstrap(): null {
    useEffect(() => {
        const logsApi = resolveLogsApi();
        if (logsApi === null) return undefined;

        return installRendererLogger(logsApi);
    }, []);

    return null;
}

function resolveLogsApi(): LogsAPI | null {
    if (typeof window === 'undefined') return null;

    const chimera = (window as unknown as { __chimera?: unknown }).__chimera;
    const logs = (chimera as { logs?: unknown } | null | undefined)?.logs;

    if (!isLogsApi(logs)) return null;
    return logs;
}

function isLogsApi(value: unknown): value is LogsAPI {
    if (value === null || typeof value !== 'object') return false;

    const candidate = value as Partial<Record<keyof LogsAPI, unknown>>;
    return typeof candidate.emit === 'function' && typeof candidate.readRecent === 'function';
}
