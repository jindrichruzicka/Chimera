// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/electron/preload/api-types.js';
import { EscapeStackProvider } from '@chimera-engine/renderer/components/ui';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import type { GameHudProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';

import { ActionGameHud } from './ActionGameHud';

const P1 = playerId('player-1');

function makeSnapshot(tick: number): PlayerSnapshot {
    return {
        tick,
        viewerId: P1,
        players: { [P1]: { id: P1 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makeProps(overrides: Partial<GameHudProps> = {}): GameHudProps {
    return {
        snapshot: makeSnapshot(7),
        localPlayerId: P1,
        sendAction: vi.fn(),
        tick: 7,
        undoDisabled: true,
        redoDisabled: true,
        endTurnDisabled: true,
        handleUndo: vi.fn(),
        handleRedo: vi.fn(),
        handleEndTurn: vi.fn(),
        ...overrides,
    };
}

// `SaveGameButton` resolves its label through `useTranslate()`, and its name
// dialog is a `Modal` that registers an escape layer — both hooks throw outside
// their provider, so every render goes through the engine's default bundle and
// an escape stack. The providers are the component's real runtime contract; a
// render that skipped them would be testing a different mounting than the shell
// performs.
function renderHud(props: GameHudProps): void {
    render(
        <I18nProvider>
            <EscapeStackProvider>
                <ActionGameHud {...props} />
            </EscapeStackProvider>
        </I18nProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ActionGameHud', () => {
    it('shows the current tick', () => {
        renderHud(makeProps({ tick: 42 }));

        expect(screen.getByTestId('action-hud-tick')).toHaveTextContent('Tick 42');
    });

    it('follows the tick prop rather than the snapshot it was built from', () => {
        // The engine passes `tick` separately; reading `snapshot.tick` instead
        // would go stale wherever the two differ.
        renderHud(makeProps({ tick: 99, snapshot: makeSnapshot(7) }));

        expect(screen.getByTestId('action-hud-tick')).toHaveTextContent('Tick 99');
    });

    it('shows tick 0 rather than nothing at the start of a match', () => {
        // A falsy-check on the tick would blank the counter on beat zero.
        renderHud(makeProps({ tick: 0 }));

        expect(screen.getByTestId('action-hud-tick')).toHaveTextContent('Tick 0');
    });

    it('offers the save affordance when the engine grants the capability', () => {
        renderHud(makeProps({ saveGame: vi.fn() }));

        expect(screen.getByTestId('action-hud-save-btn')).toBeInTheDocument();
    });

    it('withholds the save affordance when the engine grants none', () => {
        // Absence of `saveGame` IS the withholding mechanism (non-host, no
        // handler wired, or controls locked after the match resolves).
        renderHud(makeProps());

        expect(screen.queryByTestId('action-hud-save-btn')).not.toBeInTheDocument();
    });

    it('passes the player-entered name straight to the engine capability', async () => {
        const saveGame = vi.fn();
        const user = userEvent.setup();
        renderHud(makeProps({ saveGame }));

        await user.click(screen.getByTestId('action-hud-save-btn'));
        await user.type(screen.getByTestId('save-name-input'), 'arena run');
        await user.click(screen.getByTestId('save-name-confirm'));

        expect(saveGame).toHaveBeenCalledTimes(1);
        expect(saveGame).toHaveBeenCalledWith('arena run');
        expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
    });
});
