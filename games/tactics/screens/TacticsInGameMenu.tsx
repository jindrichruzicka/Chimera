'use client';

// games/tactics/screens/TacticsInGameMenu.tsx

import React from 'react';
import type { InGameMenuProps } from '@chimera/simulation/foundation/game-screen-contract.js';
import { Button, Modal } from '@chimera/renderer/components/ui/index.js';

/**
 * Tactics Leave-game confirmation dialog (F55 · §4.33). Adopted via the
 * `inGameMenu` slot of {@link TacticsGameScreenRegistry}; the Escape-toggled
 * `InGameMenuHost` opens it and supplies the engine capabilities through
 * {@link InGameMenuProps}.
 *
 * A single confirmation step: Cancel resumes the match (`closeMenu`), Leave
 * abandons it (`leaveGame`, role-aware in the engine). The copy switches on
 * `isHost` — a host returns everyone to the lobby; a client disconnects to the
 * main menu. The component reaches the shell only through the provided setters
 * (Invariant #100): it never calls `useLeaveGame()` and never opens IPC.
 */
export function TacticsInGameMenu({
    closeMenu,
    leaveGame,
    isHost,
}: InGameMenuProps): React.ReactElement {
    const prompt = isHost
        ? 'Leaving ends the battle for everyone and returns all players to the lobby.'
        : 'Leaving disconnects you from the battle and returns you to the main menu.';

    // Cancel resumes the match: the Modal's `onClose` covers the close (×)
    // button, the backdrop, and Escape, so all three paths funnel to `closeMenu`.
    return (
        <Modal open title="Leave the battle?" onClose={closeMenu}>
            <div style={bodyStyle}>
                <p data-testid="tactics-leave-prompt" style={promptStyle}>
                    {prompt}
                </p>
                <div style={actionsStyle}>
                    <Button
                        data-testid="tactics-leave-cancel"
                        variant="secondary"
                        onClick={closeMenu}
                    >
                        Cancel
                    </Button>
                    <Button
                        data-testid="tactics-leave-confirm"
                        variant="danger"
                        onClick={leaveGame}
                    >
                        Leave battle
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

const bodyStyle: React.CSSProperties = {
    display: 'grid',
    gap: 'var(--ch-space-md)',
};

const promptStyle: React.CSSProperties = {
    margin: 'var(--ch-space-none)',
};

const actionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--ch-space-sm)',
    justifyContent: 'flex-end',
};

export default TacticsInGameMenu;
