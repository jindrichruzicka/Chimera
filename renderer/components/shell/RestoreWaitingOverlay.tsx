'use client';

/**
 * renderer/components/shell/RestoreWaitingOverlay.tsx
 *
 * Game-agnostic overlay shown while a multiplayer session restore waits for
 * the saved remote seats to reconnect (F68 #828). Driven entirely by the
 * saveStore restore slice — mounted app-wide in AppShell so it survives the
 * /saves → /game route hop that happens mid-restore.
 *
 * Abort path: the Cancel action deliberately has NO onClick — Modal funnels a
 * plain dismiss into onClose, and Escape (useEscapeLayer inside Modal) lands
 * there too, so both abort through this single handler: fire-and-forget
 * cancelRestore(), optimistic local dismiss, static-literal toast.
 *
 * Terminal pushes (`ready`/`cancelled`/`failed`) unmount the modal via the
 * waiting-only render gate without touching the abort path; main-initiated
 * cancelled/failed transitions surface no toast here by design — IPC wiring
 * stays presentation-free.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 *
 * Invariants upheld:
 *   #74 — toast copy is a static literal, never derived from snapshot data.
 *   #96 — composed from the shared ui primitives (Modal, Spinner, Caption).
 */

import React, { useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useSaveStore } from '../../state/saveStore';
import { useToastStore } from '../../state/toastStore';
import { useSavesApi } from '../../hooks/useSavesApi';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { Caption } from '../ui/Caption';

// The modal body is a plain block container and Spinner is inline-flex, so it
// would sit flush left and flush against the join-code caption below; this row
// centres it under the title and keeps a dialog-gap of air above the captions.
const spinnerRowStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    marginBlockEnd: 'var(--ch-space-md)',
};

export function RestoreWaitingOverlay(): React.ReactElement | null {
    const restore = useSaveStore((s) => s.restore);
    const expectedSeats = useSaveStore((s) => s.restoreExpectedSeats);
    const dismissRestore = useSaveStore((s) => s.dismissRestore);
    const savesApi = useSavesApi();

    const handleClose = useCallback(() => {
        // cancelRestore is a main-side no-op outside an in-flight restore; a
        // rejection must never block the optimistic local dismiss.
        void savesApi.cancelRestore().catch(() => undefined);
        dismissRestore();
        useToastStore.getState().push({ severity: 'info', title: 'Restore cancelled' });
    }, [savesApi, dismissRestore]);

    if (restore?.state !== 'waiting') {
        return null;
    }

    // The wire event carries only the still-missing seats; the denominator is
    // the baseline latched by the store at the waiting transition.
    const expected = expectedSeats ?? restore.pendingSeats.length;
    const connected = Math.max(0, expected - restore.pendingSeats.length);

    return (
        <Modal
            open
            title="Waiting for players"
            onClose={handleClose}
            data-testid="waiting-for-players-modal"
            actions={[{ label: 'Cancel', variant: 'danger', testId: 'waiting-cancel' }]}
        >
            <div style={spinnerRowStyle}>
                <Spinner label="Waiting for players to reconnect" />
            </div>
            <Caption data-testid="waiting-join-code">Join code: {restore.lobbyCode}</Caption>
            <Caption tone="muted" data-testid="waiting-roster">
                {connected} / {expected} players reconnected
            </Caption>
        </Modal>
    );
}
