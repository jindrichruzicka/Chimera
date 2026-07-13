'use client';

import React, { useEffect, useState } from 'react';
import type { ConnectionStatus } from '@chimera-engine/simulation/bridge/api-types.js';
import { CONNECTION_KEYS } from '../../i18n/engine-keys';
import type { TranslationKey } from '../../i18n/translation-bundle';
import { useTranslate } from '../../i18n/useTranslate';

// Optimistic initial state; replaced by the first onConnectionStatus event.
const DEFAULT_STATUS: ConnectionStatus = 'connected';

const STATUS_STYLES: Record<
    ConnectionStatus,
    {
        readonly backgroundColor: string;
        readonly opacity: string;
    }
> = {
    connected: {
        backgroundColor: 'var(--ch-color-success)',
        opacity: 'var(--ch-opacity-disabled)',
    },
    connecting: {
        backgroundColor: 'var(--ch-color-warning-border)',
        opacity: 'var(--ch-opacity-disabled)',
    },
    disconnected: {
        backgroundColor: 'var(--ch-color-transparent)',
        opacity: '0',
    },
    error: {
        backgroundColor: 'var(--ch-color-error)',
        opacity: 'var(--ch-opacity-disabled)',
    },
};

// The {status} slot resolves through per-status tokens: the raw ConnectionStatus
// values are wire identifiers, not display strings. Their English templates equal
// the identifiers, so en-US stays 'Connection status: connected' byte-identical.
const STATUS_TOKENS: Record<ConnectionStatus, TranslationKey> = {
    connected: CONNECTION_KEYS.statusConnected,
    connecting: CONNECTION_KEYS.statusConnecting,
    disconnected: CONNECTION_KEYS.statusDisconnected,
    error: CONNECTION_KEYS.statusError,
};

export function ConnectionStatusIndicator(): React.ReactElement {
    const t = useTranslate();
    const [status, setStatus] = useState<ConnectionStatus>(DEFAULT_STATUS);
    const statusStyle = STATUS_STYLES[status];
    const statusLabel = t(CONNECTION_KEYS.statusAriaLabel, { status: t(STATUS_TOKENS[status]) });

    useEffect(() => {
        if (!window.__chimera?.system) {
            return () => undefined;
        }

        const unsubscribe = window.__chimera.system.onConnectionStatus((nextStatus) => {
            setStatus(nextStatus);
        });

        return () => {
            unsubscribe();
        };
    }, []);

    return (
        <div
            data-testid="connection-status"
            data-status={status}
            className={`connection-status-indicator connection-status-indicator--${status}`}
            role="status"
            aria-live="polite"
            aria-label={statusLabel}
            style={{
                position: 'fixed',
                right: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                top: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                width: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                height: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                borderRadius: 'var(--ch-radius-pill)',
                backgroundColor: statusStyle.backgroundColor,
                opacity: statusStyle.opacity,
                transition:
                    'background-color var(--ch-duration-fast) var(--ch-easing-standard), opacity var(--ch-duration-fast) var(--ch-easing-standard)',
                pointerEvents: 'none',
                zIndex: 1000,
            }}
        />
    );
}
