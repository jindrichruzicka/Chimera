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
        borderColor: '#86efac',
        backgroundColor: '#f0fdf4',
        color: '#166534',
    },
    connecting: {
        borderColor: '#fcd34d',
        backgroundColor: '#fffbeb',
        color: '#92400e',
    },
    disconnected: {
        borderColor: '#fca5a5',
        backgroundColor: '#fef2f2',
        color: '#991b1b',
    },
    error: {
        borderColor: '#f87171',
        backgroundColor: '#fee2e2',
        color: '#7f1d1d',
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
                right: '12px',
                top: '12px',
                borderRadius: '999px',
                border: `1px solid ${statusStyle.borderColor}`,
                backgroundColor: statusStyle.backgroundColor,
                color: statusStyle.color,
                fontSize: '12px',
                fontWeight: 600,
                padding: '6px 10px',
                textTransform: 'capitalize',
                zIndex: 1000,
            }}
        >
            {status}
        </div>
    );
}
