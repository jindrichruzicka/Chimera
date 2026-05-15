'use client';

// renderer/components/shell/ConnectionStatusIndicator.tsx

import React, { useEffect, useState } from 'react';
import type { ConnectionStatus } from '@chimera/electron/preload/api-types.js';

// Optimistic initial state; replaced by the first onConnectionStatus event.
const DEFAULT_STATUS: ConnectionStatus = 'connected';

const STATUS_STYLES: Record<
    ConnectionStatus,
    {
        readonly borderColor: string;
        readonly backgroundColor: string;
        readonly color: string;
    }
> = {
    connected: {
        borderColor: 'var(--ch-color-success-border)',
        backgroundColor: 'var(--ch-color-success-surface)',
        color: 'var(--ch-color-success-text)',
    },
    connecting: {
        borderColor: 'var(--ch-color-warning-border)',
        backgroundColor: 'var(--ch-color-warning-surface)',
        color: 'var(--ch-color-warning-text)',
    },
    disconnected: {
        borderColor: 'var(--ch-color-error-border)',
        backgroundColor: 'var(--ch-color-error-surface)',
        color: 'var(--ch-color-error-text)',
    },
    error: {
        borderColor: 'var(--ch-color-error-border-strong)',
        backgroundColor: 'var(--ch-color-error-surface-strong)',
        color: 'var(--ch-color-error-text-strong)',
    },
};

export function ConnectionStatusIndicator(): React.ReactElement {
    const [status, setStatus] = useState<ConnectionStatus>(DEFAULT_STATUS);
    const statusStyle = STATUS_STYLES[status];

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
            className={`connection-status-pill connection-status-pill--${status}`}
            aria-live="polite"
            style={{
                position: 'fixed',
                right: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                top: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                borderRadius: 'var(--ch-radius-pill)',
                border: `var(--ch-border-width-sm) solid ${statusStyle.borderColor}`,
                backgroundColor: statusStyle.backgroundColor,
                color: statusStyle.color,
                fontSize: 'var(--ch-font-size-sm)',
                fontWeight: 600,
                padding: 'var(--ch-space-status-padding-y) var(--ch-space-status-padding-x)',
                textTransform: 'capitalize',
                zIndex: 1000,
            }}
        >
            {status}
        </div>
    );
}
