'use client';

import { useCallback } from 'react';
import type { EngineAction } from '@chimera/simulation/bridge/api-types.js';
import { usePerfStore } from '../components/shell/perf/perfStore.js';

export type SendAction = (action: EngineAction) => void;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isSendAction(value: unknown): value is SendAction {
    return typeof value === 'function';
}

function resolveSendAction(source: unknown): SendAction | undefined {
    if (!isRecord(source)) {
        return undefined;
    }
    const chimera = source['__chimera'];
    if (!isRecord(chimera)) {
        return undefined;
    }
    const game = chimera['game'];
    if (!isRecord(game)) {
        return undefined;
    }
    const sendAction = game['sendAction'];
    if (!isSendAction(sendAction)) {
        return undefined;
    }
    return sendAction;
}

export function useSendAction(source: unknown = globalThis): SendAction {
    return useCallback(
        (action: EngineAction): void => {
            const sendAction = resolveSendAction(source);
            if (sendAction === undefined) {
                throw new Error('Chimera game API not available');
            }
            sendAction(action);
            usePerfStore.getState().recordActionDispatched(performance.now());
        },
        [source],
    );
}
