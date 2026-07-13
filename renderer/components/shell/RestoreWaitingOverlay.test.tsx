// @vitest-environment jsdom

/**
 * renderer/components/shell/RestoreWaitingOverlay.test.tsx
 *
 * Unit tests for the RestoreWaitingOverlay shell component.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #828
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import type { RestoreStatusEvent } from '@chimera-engine/simulation/bridge/api-types.js';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TranslationBundle } from '../../i18n/translation-bundle';
import { useSaveStore } from '../../state/saveStore';
import { useToastStore } from '../../state/toastStore';
import { EscapeStackProvider } from './EscapeStack';
import { RestoreWaitingOverlay } from './RestoreWaitingOverlay';

// Modal routes Escape-to-close through the shared overlay stack, so every render
// must sit inside an EscapeStackProvider (useEscapeLayer throws otherwise). The
// overlay also calls useTranslate(); the inert I18nProvider resolves engine
// English so the existing copy assertions hold. A gameOverride exercises the
// translate-at-the-render-site path.
const render = (
    ui: React.ReactElement,
    gameOverride?: TranslationBundle,
): ReturnType<typeof baseRender> => {
    const providerProps = gameOverride !== undefined ? { gameOverride } : {};
    return baseRender(
        <I18nProvider {...providerProps}>
            <EscapeStackProvider>{ui}</EscapeStackProvider>
        </I18nProvider>,
    );
};

function makeRestoreEvent(overrides: Partial<RestoreStatusEvent> = {}): RestoreStatusEvent {
    return {
        state: 'waiting',
        gameId: 'tactics',
        matchId: 'match-1',
        lobbyCode: 'ABCD',
        pendingSeats: [playerId('p2'), playerId('p3')],
        ...overrides,
    };
}

// Terminal events carry no lobbyCode and empty pendingSeats (schema-enforced);
// built separately because exactOptionalPropertyTypes forbids `lobbyCode: undefined`.
function makeReadyRestoreEvent(): RestoreStatusEvent {
    return {
        state: 'ready',
        gameId: 'tactics',
        matchId: 'match-1',
        pendingSeats: [],
    };
}

const cancelRestore = vi.fn(async () => undefined);

beforeEach(() => {
    cancelRestore.mockClear();
    useSaveStore.setState({
        slots: [],
        isLoading: true,
        restore: null,
        restoreExpectedSeats: null,
        restoreLatchMatchId: null,
        restoreAbortPending: false,
    });
    useToastStore.getState().dismissAll();
    (globalThis as { __chimera?: unknown }).__chimera = { saves: { cancelRestore } };
});

afterEach(() => {
    cleanup();
    delete (globalThis as { __chimera?: unknown }).__chimera;
});

describe('RestoreWaitingOverlay — visibility', () => {
    it('renders nothing while idle', () => {
        render(<RestoreWaitingOverlay />);
        expect(screen.queryByTestId('waiting-for-players-modal')).not.toBeInTheDocument();
    });

    it('shows the modal with spinner, join code, and roster while waiting', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });

        expect(screen.getByTestId('waiting-for-players-modal')).toBeInTheDocument();
        expect(
            screen.getByRole('status', { name: 'Waiting for players to reconnect' }),
        ).toBeInTheDocument();
        expect(screen.getByTestId('waiting-join-code')).toHaveTextContent('ABCD');
        expect(screen.getByTestId('waiting-roster')).toHaveTextContent('0 / 2 players reconnected');
    });

    it('resolves the title, join code, and roster copy through the active-locale translator', () => {
        render(<RestoreWaitingOverlay />, {
            'engine.restore.waitingTitle': 'Standby',
            'engine.restore.joinCode': 'Code {code}',
            'engine.restore.rosterProgress': '{connected} of {expected} back',
        });

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });

        expect(screen.getByRole('dialog', { name: 'Standby' })).toBeInTheDocument();
        expect(screen.getByTestId('waiting-join-code')).toHaveTextContent('Code ABCD');
        expect(screen.getByTestId('waiting-roster')).toHaveTextContent('0 of 2 back');
    });

    it('centres the spinner horizontally and keeps clearance above the join code', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });

        const spinner = screen.getByRole('status', { name: 'Waiting for players to reconnect' });
        expect(spinner.parentElement).toHaveStyle({
            display: 'flex',
            justifyContent: 'center',
            marginBlockEnd: 'var(--ch-space-md)',
        });
    });

    it('updates the roster count as pending seats shrink, keeping the latched total', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });
        act(() => {
            useSaveStore
                .getState()
                .applyRestoreStatus(makeRestoreEvent({ pendingSeats: [playerId('p3')] }));
        });

        expect(screen.getByTestId('waiting-roster')).toHaveTextContent('1 / 2 players reconnected');
    });

    it('closes on a ready push without calling cancelRestore or toasting', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });
        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeReadyRestoreEvent());
        });

        expect(screen.queryByTestId('waiting-for-players-modal')).not.toBeInTheDocument();
        expect(cancelRestore).not.toHaveBeenCalled();
        expect(useToastStore.getState().queue).toHaveLength(0);
        // Terminal pushes complete the restore in place — no abort exit.
        expect(useSaveStore.getState().restoreAbortPending).toBe(false);
    });
});

describe('RestoreWaitingOverlay — abort path', () => {
    it('Cancel click aborts: cancelRestore + optimistic dismiss + toast', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });

        fireEvent.click(screen.getByTestId('waiting-cancel'));

        expect(cancelRestore).toHaveBeenCalledOnce();
        expect(useSaveStore.getState().restore).toBeNull();
        expect(screen.queryByTestId('waiting-for-players-modal')).not.toBeInTheDocument();

        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]).toMatchObject({ severity: 'info', title: 'Restore cancelled' });
    });

    it('Cancel raises the abort-exit marker so the game page routes the host off the dead /game (#842)', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });

        fireEvent.click(screen.getByTestId('waiting-cancel'));

        expect(useSaveStore.getState().restoreAbortPending).toBe(true);
    });

    it('resurrects with the original roster baseline when a waiting push follows a failed cancel', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });

        fireEvent.click(screen.getByTestId('waiting-cancel'));
        expect(screen.queryByTestId('waiting-for-players-modal')).not.toBeInTheDocument();

        // Main-side cancel failed; the restore kept running and pushes again.
        act(() => {
            useSaveStore
                .getState()
                .applyRestoreStatus(makeRestoreEvent({ pendingSeats: [playerId('p3')] }));
        });

        expect(screen.getByTestId('waiting-roster')).toHaveTextContent('1 / 2 players reconnected');
    });

    it('Escape takes the identical abort path', () => {
        render(<RestoreWaitingOverlay />);

        act(() => {
            useSaveStore.getState().applyRestoreStatus(makeRestoreEvent());
        });

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(cancelRestore).toHaveBeenCalledOnce();
        expect(useSaveStore.getState().restore).toBeNull();
        expect(screen.queryByTestId('waiting-for-players-modal')).not.toBeInTheDocument();

        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]).toMatchObject({ severity: 'info', title: 'Restore cancelled' });

        // Same #842 abort exit as the Cancel click.
        expect(useSaveStore.getState().restoreAbortPending).toBe(true);
    });
});
