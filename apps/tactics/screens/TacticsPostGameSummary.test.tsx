// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    entityId,
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/electron/preload/api-types.js';
import type { GameScreenProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    CURRENT_MATCH_REPLAY_PATH,
    type PerspectiveReplayExportBridge,
    type ReplayExportBridge,
} from '@chimera-engine/simulation/foundation/replay-bridge-contract.js';
import { IconProvider } from '@chimera-engine/renderer/components/ui';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import { tacticsBundleCs } from '../shell/translations/cs.js';
import { tacticsBundleEn } from '../shell/translations/en.js';
import { tacticsIcons } from '../shell/icons.js';
import { TacticsPostGameSummary } from './TacticsPostGameSummary.js';

const TACTICS_LANGUAGES = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
] as const;

// The summary renders its badge/message/panel/replay copy through useTranslate()
// (which throws outside a provider) and its crest emblem through the engine
// <Icon>, resolved against the active IconProvider. Wrap in the English Tactics
// bundle + the Tactics icon set so the copy resolves and the emblem renders
// (mirroring the app-wide ActiveGameIconProvider).
function EnProviders({ children }: { readonly children: React.ReactNode }): React.ReactElement {
    return (
        <I18nProvider gameOverride={tacticsBundleEn}>
            <IconProvider gameIcons={tacticsIcons}>{children}</IconProvider>
        </I18nProvider>
    );
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: EnProviders });

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
 * Assert that `node` renders before the Replay action button in document order —
 * the DOM proxy for "sits to the left of the button", since CSS module classes
 * don't apply under jsdom.
 */
function expectPrecedesButtons(node: HTMLElement): void {
    const button = screen.getByTestId('post-game-replay-btn');
    expect(node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    it('renders the heraldic outcome emblem in the crest for each outcome', () => {
        const localPlayerId = playerId('p1');
        const { rerender } = render(<TacticsPostGameSummary {...makeSummaryProps()} />);
        expect(
            screen
                .getByTestId('post-game-summary-emblem')
                .querySelector('svg[data-ch-icon="game.tactics.result-victory"]'),
        ).not.toBeNull();

        rerender(
            <TacticsPostGameSummary
                {...makeSummaryProps({
                    snapshot: makeSnapshot({ gameResult: { winnerIds: [playerId('p2')] } }),
                    localPlayerId,
                })}
            />,
        );
        expect(
            screen
                .getByTestId('post-game-summary-emblem')
                .querySelector('svg[data-ch-icon="game.tactics.result-defeat"]'),
        ).not.toBeNull();

        rerender(
            <TacticsPostGameSummary
                {...makeSummaryProps({ snapshot: makeSnapshot({ gameResult: null }) })}
            />,
        );
        expect(
            screen
                .getByTestId('post-game-summary-emblem')
                .querySelector('svg[data-ch-icon="game.tactics.result-concluded"]'),
        ).not.toBeNull();
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

    it('renders the summary in Czech when the Czech bundle is active', () => {
        baseRender(
            <I18nProvider
                gameOverride={tacticsBundleCs}
                languages={TACTICS_LANGUAGES}
                locale="cs-CZ"
            >
                <IconProvider gameIcons={tacticsIcons}>
                    <TacticsPostGameSummary {...makeSummaryProps()} />
                </IconProvider>
            </I18nProvider>,
        );

        expect(screen.getByRole('region', { name: 'Shrnutí po hře' })).toBeTruthy();
        expect(screen.getByTestId('post-game-summary-badge')).toHaveTextContent('Vítězství');
        expect(screen.getByTestId('post-game-summary-message')).toHaveTextContent(
            'Mise splněna. Tvá formace ovládá pole.',
        );
    });
});

describe('TacticsPostGameSummary — replay actions', () => {
    it('renders the Replay button once the match has ended, and no Save Replay button', () => {
        installReplayBridge();
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        expect(screen.getByTestId('post-game-replay-btn')).toHaveTextContent('Replay');
        // Saving moved into the replay player's compact icon — the summary no
        // longer carries a Save Replay button.
        expect(screen.queryByTestId('post-game-save-replay-btn')).toBeNull();
        expect(screen.queryByRole('button', { name: /save replay/i })).toBeNull();
        // Modernized summary: compact, end-aligned action.
        expect(screen.getByTestId('post-game-replay-btn')).toHaveAttribute(
            'data-ch-button-size',
            'sm',
        );
    });

    it('hides the Replay action while the match is unresolved', () => {
        installReplayBridge();
        render(
            <TacticsPostGameSummary
                {...makeSummaryProps({ snapshot: makeSnapshot({ gameResult: null }) })}
            />,
        );

        expect(screen.queryByTestId('post-game-replay-btn')).toBeNull();
    });

    it('previews the in-memory match (no export/write) and opens the player as saveable when Replay is clicked', async () => {
        const exportCurrentMatch = vi.fn(() =>
            Promise.resolve('/replays/tactics/done.chimera-replay'),
        );
        const bridges = installReplayBridge({ exportCurrentMatch });
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps()} />);

        await user.click(screen.getByTestId('post-game-replay-btn'));

        await waitFor(() => {
            // The post-game preview now always opens the player's OWN perspective
            // recording (host and client alike); the current-match sentinel opens
            // the in-memory recording and `true` marks it saveable so the player
            // shows its save icon. The build-specific deterministic decision lives
            // entirely in main.
            expect(bridges.perspective.openInPlayer).toHaveBeenCalledWith(
                CURRENT_MATCH_REPLAY_PATH,
                true,
            );
        });
        // Nothing is written to disk on Replay — no export on either surface.
        expect(exportCurrentMatch).not.toHaveBeenCalled();
        expect(bridges.perspective.exportCurrent).not.toHaveBeenCalled();
    });

    it('renders the replay error to the left of the action buttons', async () => {
        installReplayBridge({
            perspective: {
                openInPlayer: vi.fn(() => Promise.reject(new Error('player unavailable'))),
            },
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
                CURRENT_MATCH_REPLAY_PATH,
                true,
            );
        });
        // Previewing does not persist — no export on either surface.
        expect(bridges.perspective.exportCurrent).not.toHaveBeenCalled();
        // The authoritative deterministic replay re-runs the full sim and would
        // leak hidden information, so a client must never touch it (Invariant #71).
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

    it('a host also opens its OWN perspective replay (build-agnostic; the deterministic decision lives in main)', async () => {
        const bridges = installReplayBridge();
        const user = userEvent.setup();
        render(<TacticsPostGameSummary {...makeSummaryProps({ isHost: true })} />);

        await user.click(screen.getByTestId('post-game-replay-btn'));

        await waitFor(() => {
            expect(bridges.perspective.openInPlayer).toHaveBeenCalledWith(
                CURRENT_MATCH_REPLAY_PATH,
                true,
            );
        });
        // The host no longer previews the deterministic replay from the summary —
        // the deterministic file is a main-side co-save (dev only), never surfaced
        // here. Previewing writes nothing on either surface.
        expect(bridges.openInPlayer).not.toHaveBeenCalled();
        expect(bridges.exportCurrentMatch).not.toHaveBeenCalled();
        expect(bridges.perspective.exportCurrent).not.toHaveBeenCalled();
    });
});
