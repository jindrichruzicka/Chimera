// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    entityId,
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import type { GameScreenProps } from '@chimera/shared/game-screen-contract.js';
import type {
    PerspectiveReplayExportBridge,
    ReplayExportBridge,
} from '@chimera/shared/replay-bridge-contract.js';
import { TacticsPostGameSummary } from './TacticsPostGameSummary.js';

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, '__chimera');
});

/**
 * Install the export / open-in-player slice of `window.__chimera.replay` that
 * the post-game actions read off `globalThis`. The screen depends only on the
 * shared {@link ReplayExportBridge} contract, so the fixture satisfies that slice
 * directly — no cast to the full preload `ReplayAPI`.
 */
type InstalledReplayBridges = ReplayExportBridge & {
    perspective: PerspectiveReplayExportBridge;
};

function installReplayBridge(
    overrides: Partial<ReplayExportBridge> & {
        perspective?: Partial<PerspectiveReplayExportBridge>;
    } = {},
): InstalledReplayBridges {
    const exportCurrentMatch =
        overrides.exportCurrentMatch ??
        vi.fn(() => Promise.resolve('/replays/tactics/m.chimera-replay'));
    const openInPlayer = overrides.openInPlayer ?? vi.fn(() => Promise.resolve());
    const perspective: PerspectiveReplayExportBridge = {
        exportCurrent:
            overrides.perspective?.exportCurrent ??
            vi.fn(() =>
                Promise.resolve('/perspective-replays/tactics/p.chimera-perspective-replay'),
            ),
        openInPlayer: overrides.perspective?.openInPlayer ?? vi.fn(() => Promise.resolve()),
    };
    const replay: InstalledReplayBridges = { exportCurrentMatch, openInPlayer, perspective };
    Object.defineProperty(globalThis, '__chimera', { configurable: true, value: { replay } });
    return replay;
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const localPlayerId = playerId('p1');
    const remotePlayerId = playerId('p2');
    const scoutId = entityId('scout-1');
    const guardId = entityId('guard-1');

    return {
        tick: 24,
        viewerId: localPlayerId,
        players: {
            [localPlayerId]: { id: localPlayerId },
            [remotePlayerId]: { id: remotePlayerId },
        },
        entities: {
            [scoutId]: { id: scoutId },
            [guardId]: { id: guardId },
        },
        phase: gamePhase('ended'),
        events: [{ type: 'tactics:unit_defeated' }],
        gameResult: { winnerIds: [localPlayerId] },
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: false,
        ...overrides,
    };
}

/**
 * Assert that `node` renders before both replay action buttons in document
 * order — the DOM proxy for "sits to the left of the buttons", since CSS module
 * classes don't apply under jsdom.
 */
function expectPrecedesButtons(node: HTMLElement): void {
    for (const testId of ['post-game-replay-btn', 'post-game-save-replay-btn']) {
        const button = screen.getByTestId(testId);
        expect(
            node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    }
}

function makeSummaryProps(overrides: Partial<GameScreenProps> = {}): GameScreenProps {
    return {
        snapshot: makeSnapshot(),
        localPlayerId: playerId('p1'),
        sendAction: vi.fn(),
        ...overrides,
    };
}

describe('TacticsPostGameSummary', () => {
    it('renders the summary through shared UI primitives', () => {
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'win');
        expect(screen.getByTestId('post-game-summary-panel')).toHaveAttribute(
            'data-ch-panel-variant',
            'raised',
        );
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'success',
        );
        expect(screen.getByTestId('post-game-summary-message')).toHaveAttribute(
            'data-ch-caption-tone',
            'success',
        );
    });

    it('summarizes the outcome through the badge and message, without redundant chrome', () => {
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        expect(screen.getByRole('region', { name: 'Post-Game Summary' })).toBeTruthy();
        expect(screen.getByTestId('post-game-summary-badge')).toHaveTextContent('Victory');
        expect(screen.getByTestId('post-game-summary-message')).toHaveTextContent(
            'Mission accomplished. Your formation controls the field.',
        );

        // The redundant outcome heading and the battlefield-metric cards were
        // removed during the summary modernization — the badge carries the
        // outcome on its own.
        expect(screen.queryByTestId('post-game-summary-heading')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Tactical Victory' })).toBeNull();
        expect(screen.queryByTestId('post-game-summary-final-tick')).toBeNull();
        expect(screen.queryByTestId('post-game-summary-visible-units')).toBeNull();
        expect(screen.queryByTestId('post-game-summary-commanders')).toBeNull();
        expect(screen.queryByRole('separator')).toBeNull();
    });

    it('uses defeat, draw, and unknown outcome variants', () => {
        const localPlayerId = playerId('p1');

        const { rerender } = render(
            <TacticsPostGameSummary
                {...makeSummaryProps({
                    snapshot: makeSnapshot({ gameResult: { winnerIds: [playerId('p2')] } }),
                    localPlayerId,
                })}
            />,
        );

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'loss');
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'error',
        );
        expect(screen.getByTestId('post-game-summary-badge')).toHaveTextContent('Defeat');

        rerender(
            <TacticsPostGameSummary
                {...makeSummaryProps({
                    snapshot: makeSnapshot({ gameResult: { winnerIds: [] } }),
                    localPlayerId,
                })}
            />,
        );

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'draw');
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'warning',
        );
        expect(screen.getByTestId('post-game-summary-badge')).toHaveTextContent('Stalemate');

        rerender(
            <TacticsPostGameSummary
                {...makeSummaryProps({
                    snapshot: makeSnapshot({ gameResult: null }),
                })}
            />,
        );

        expect(screen.getByTestId('post-game-summary')).toHaveAttribute('data-outcome', 'unknown');
        expect(screen.getByTestId('post-game-summary-badge')).toHaveAttribute(
            'data-ch-badge-variant',
            'neutral',
        );
        expect(screen.getByTestId('post-game-summary-badge')).toHaveTextContent('Concluded');
    });
});

describe('TacticsPostGameSummary — replay actions', () => {
    it('renders Replay and Save Replay buttons once the match has ended', () => {
        installReplayBridge();
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        expect(screen.getByTestId('post-game-replay-btn')).toHaveTextContent('Replay');
        expect(screen.getByTestId('post-game-save-replay-btn')).toHaveTextContent('Save Replay');
        // Modernized summary: compact, end-aligned actions.
        expect(screen.getByTestId('post-game-replay-btn')).toHaveAttribute(
            'data-ch-button-size',
            'sm',
        );
        expect(screen.getByTestId('post-game-save-replay-btn')).toHaveAttribute(
            'data-ch-button-size',
            'sm',
        );
    });

    it('hides both replay actions while the match is unresolved', () => {
        installReplayBridge();
        render(
            <TacticsPostGameSummary
                {...makeSummaryProps({ snapshot: makeSnapshot({ gameResult: null }) })}
            />,
        );

        expect(screen.queryByTestId('post-game-replay-btn')).toBeNull();
        expect(screen.queryByTestId('post-game-save-replay-btn')).toBeNull();
    });

    it('exports the current match and confirms when Save Replay is clicked', async () => {
        const { exportCurrentMatch } = installReplayBridge();
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        await user.click(screen.getByTestId('post-game-save-replay-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('post-game-replay-status')).toHaveTextContent('Replay saved');
        });
        expect(exportCurrentMatch).toHaveBeenCalledOnce();
        // 'save' intent → main raises the "Replay saved" toast (§4.30).
        expect(exportCurrentMatch).toHaveBeenCalledWith('save');
        expect(screen.queryByTestId('post-game-replay-error')).toBeNull();
        // The status leads the actions row, so it sits to the left of the buttons.
        expectPrecedesButtons(screen.getByTestId('post-game-replay-status'));
    });

    it('surfaces safe generic copy when exporting fails, never the raw bridge error', async () => {
        installReplayBridge({
            exportCurrentMatch: vi.fn(() => Promise.reject(new Error('no active hosted session'))),
        });
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        await user.click(screen.getByTestId('post-game-save-replay-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('post-game-replay-error')).toHaveTextContent(
                'Could not save replay.',
            );
        });
        // Raw main-process error text must not reach the game UI.
        expect(screen.queryByText(/no active hosted session/)).toBeNull();
        expect(screen.queryByTestId('post-game-replay-status')).toBeNull();
    });

    it('exports then opens the player when Replay is clicked', async () => {
        const exportCurrentMatch = vi.fn(() =>
            Promise.resolve('/replays/tactics/done.chimera-replay'),
        );
        const { openInPlayer } = installReplayBridge({ exportCurrentMatch });
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        await user.click(screen.getByTestId('post-game-replay-btn'));

        await waitFor(() => {
            expect(openInPlayer).toHaveBeenCalledWith('/replays/tactics/done.chimera-replay');
        });
        expect(exportCurrentMatch).toHaveBeenCalledOnce();
        // 'view' intent → main suppresses the "Replay saved" toast (§4.30): the
        // export only obtains a stable on-disk path for the player.
        expect(exportCurrentMatch).toHaveBeenCalledWith('view');
    });

    it('renders the replay error to the left of the action buttons', async () => {
        installReplayBridge({
            openInPlayer: vi.fn(() => Promise.reject(new Error('player unavailable'))),
        });
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        await user.click(screen.getByTestId('post-game-replay-btn'));

        const error = await screen.findByTestId('post-game-replay-error');
        expect(error).toHaveTextContent('Could not open replay.');
        // The error caption leads the actions row, so it renders to the left of
        // the buttons rather than crowding their right edge.
        expectPrecedesButtons(error);
    });
});

describe('TacticsPostGameSummary — client perspective replay', () => {
    it('a client opens its OWN perspective replay, never the deterministic one', async () => {
        const bridges = installReplayBridge();
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps({ isHost: false })} />);

        await user.click(screen.getByTestId('post-game-replay-btn'));

        await waitFor(() => {
            expect(bridges.perspective.openInPlayer).toHaveBeenCalledWith(
                '/perspective-replays/tactics/p.chimera-perspective-replay',
            );
        });
        expect(bridges.perspective.exportCurrent).toHaveBeenCalledOnce();
        // The authoritative deterministic replay re-runs the full sim and would
        // leak hidden information, so a client must never touch it (Invariant #71).
        expect(bridges.exportCurrentMatch).not.toHaveBeenCalled();
    });

    it('a client saves its perspective replay and sees the inline confirmation', async () => {
        const bridges = installReplayBridge();
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps({ isHost: false })} />);

        await user.click(screen.getByTestId('post-game-save-replay-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('post-game-replay-status')).toHaveTextContent('Replay saved');
        });
        expect(bridges.perspective.exportCurrent).toHaveBeenCalledOnce();
        expect(bridges.exportCurrentMatch).not.toHaveBeenCalled();
    });

    it('surfaces the generic error when the client perspective open fails', async () => {
        installReplayBridge({
            perspective: {
                openInPlayer: vi.fn(() => Promise.reject(new Error('player unavailable'))),
            },
        });
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps({ isHost: false })} />);

        await user.click(screen.getByTestId('post-game-replay-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('post-game-replay-error')).toHaveTextContent(
                'Could not open replay.',
            );
        });
    });

    it('a host still uses the authoritative deterministic replay', async () => {
        const bridges = installReplayBridge();
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps({ isHost: true })} />);

        await user.click(screen.getByTestId('post-game-replay-btn'));

        await waitFor(() => {
            expect(bridges.openInPlayer).toHaveBeenCalledWith('/replays/tactics/m.chimera-replay');
        });
        expect(bridges.exportCurrentMatch).toHaveBeenCalledWith('view');
        expect(bridges.perspective.exportCurrent).not.toHaveBeenCalled();
    });
});
