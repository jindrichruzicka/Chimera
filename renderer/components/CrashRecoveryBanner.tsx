'use client';

// renderer/components/CrashRecoveryBanner.tsx
//
// Rendered on the home/lobby screen when a previous session terminated
// unexpectedly. Calls `checkCrashRecovery()` once on mount via useSavesApi
// and, when `needsRecovery` is true, presents two choices:
//
//   - "Resume last session" — calls `load(slotId)` via useSavesApi
//   - "Start fresh" — dismisses the banner without calling load
//
// State is local (`useState`) — not persisted in any store. Once either
// choice is made the banner does not reappear within the same session.
//
// Module boundary: must NOT import from `electron/main/`, `simulation/`, or
// `networking/`. Bridge access is routed through useSavesApi/getSavesBridge.

import React, { useEffect, useState } from 'react';
import type { SlotId } from '@chimera-engine/simulation/bridge/api-types.js';
import { useSavesApi } from '../app/saves/useSavesApi';

type BannerState =
    | { readonly phase: 'checking' }
    | { readonly phase: 'hidden' }
    | { readonly phase: 'visible'; readonly slotId: SlotId };

export function CrashRecoveryBanner(): React.ReactElement | null {
    const api = useSavesApi();
    const [state, setState] = useState<BannerState>({ phase: 'checking' });

    useEffect(() => {
        void api
            .checkCrashRecovery()
            .then((result) => {
                if (result.needsRecovery && result.slotId !== null) {
                    setState({ phase: 'visible', slotId: result.slotId });
                } else {
                    setState({ phase: 'hidden' });
                }
            })
            .catch((err: unknown) => {
                console.error('[CrashRecoveryBanner] checkCrashRecovery failed:', err);
                setState({ phase: 'hidden' });
            });
    }, [api]);

    if (state.phase !== 'visible') {
        return null;
    }

    const { slotId } = state;

    function handleResume(): void {
        void api.load(slotId).catch((err: unknown) => {
            console.error('[CrashRecoveryBanner] load failed during crash recovery:', err);
        });
        setState({ phase: 'hidden' });
    }

    function handleStartFresh(): void {
        setState({ phase: 'hidden' });
    }

    return (
        <div
            data-testid="crash-recovery-banner"
            role="alert"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--ch-space-md)',
                padding: 'calc(var(--ch-space-sm) + var(--ch-space-xs)) var(--ch-space-md)',
                backgroundColor: 'var(--ch-color-warning-surface)',
                borderBottom: 'var(--ch-border-width-sm) solid var(--ch-color-warning-border)',
                color: 'var(--ch-color-warning-text)',
                fontFamily: 'var(--ch-font-ui)',
            }}
        >
            <span>
                It looks like your last session ended unexpectedly. Would you like to resume it?
            </span>
            <button type="button" onClick={handleResume}>
                Resume last session
            </button>
            <button type="button" onClick={handleStartFresh}>
                Start fresh
            </button>
        </div>
    );
}
