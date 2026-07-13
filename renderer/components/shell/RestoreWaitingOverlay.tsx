'use client';

/**
 * Game-agnostic overlay shown while a multiplayer session restore waits for
 * the saved remote seats to reconnect. Driven entirely by the
 * saveStore restore slice — mounted app-wide in AppShell so it survives the
 * /saves → /game route hop that happens mid-restore.
 *
 * Abort path: the Cancel action deliberately has NO onClick — Modal funnels a
 * plain dismiss into onClose, and Escape (useEscapeLayer inside Modal) lands
 * there too, so both abort through this single handler: fire-and-forget
 * cancelRestore(), optimistic local dismiss, static-literal toast, and the
 * `markRestoreAborted()` exit marker. The waiting host sits on the
 * mid-restore /game hop, and the unwound session never broadcasts the
 * phase:'lobby' snapshot that drives the usual reverse navigation — but this
 * overlay must NOT navigate directly: the game page's no-session redirect
 * fires once the cancelled lobby empties and would race (and beat) any exit
 * issued from here. Instead the game page consumes the marker and owns the
 * /game → /saves exit, mirroring the leave-to-main-menu flag.
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

import React, { useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { RESTORE_KEYS, TOAST_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
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
    const t = useTranslate();
    const restore = useSaveStore((s) => s.restore);
    const expectedSeats = useSaveStore((s) => s.restoreExpectedSeats);
    const dismissRestore = useSaveStore((s) => s.dismissRestore);
    const markRestoreAborted = useSaveStore((s) => s.markRestoreAborted);
    const savesApi = useSavesApi();

    // Read the latest translator through a ref so the abort toast stays current
    // without widening handleClose's deps. The resolved token is a static title
    // (Invariant #74).
    const tRef = useRef(t);
    tRef.current = t;

    const handleClose = useCallback(() => {
        // cancelRestore is a main-side no-op outside an in-flight restore; a
        // rejection must never block the optimistic local dismiss.
        void savesApi.cancelRestore().catch(() => undefined);
        dismissRestore();
        useToastStore
            .getState()
            .push({ severity: 'info', title: tRef.current(TOAST_KEYS.restoreCancelled) });
        // Exit marker (see module header) — the game page consumes it
        // and routes the host back to /saves.
        markRestoreAborted();
    }, [savesApi, dismissRestore, markRestoreAborted]);

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
            title={t(RESTORE_KEYS.waitingTitle)}
            onClose={handleClose}
            data-testid="waiting-for-players-modal"
            actions={[
                { label: t(RESTORE_KEYS.cancel), variant: 'danger', testId: 'waiting-cancel' },
            ]}
        >
            <div style={spinnerRowStyle}>
                <Spinner label={t(RESTORE_KEYS.spinnerLabel)} />
            </div>
            <Caption data-testid="waiting-join-code">
                {/* lobbyCode is wire-optional; `?? ''` keeps the prior empty
                    render when a waiting event omits it. */}
                {t(RESTORE_KEYS.joinCode, { code: restore.lobbyCode ?? '' })}
            </Caption>
            <Caption tone="muted" data-testid="waiting-roster">
                {t(RESTORE_KEYS.rosterProgress, { connected, expected })}
            </Caption>
        </Modal>
    );
}
