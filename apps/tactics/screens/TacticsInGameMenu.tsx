'use client';

// apps/tactics/screens/TacticsInGameMenu.tsx

import React from 'react';
import type { InGameMenuProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { Modal } from '@chimera-engine/renderer/components/ui';

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

    // Cancel resumes the match: the Modal's `onClose` covers Escape and the
    // Cancel action (no `onClick` → dismiss only), both funnelling to `closeMenu`.
    // Leave runs `leaveGame`, then the modal closes like any action.
    return (
        <Modal
            open
            title="Leave the battle?"
            onClose={closeMenu}
            actions={[
                { label: 'Cancel', testId: 'tactics-leave-cancel' },
                {
                    label: 'Leave battle',
                    variant: 'danger',
                    testId: 'tactics-leave-confirm',
                    onClick: leaveGame,
                },
            ]}
        >
            <p data-testid="tactics-leave-prompt" style={promptStyle}>
                {prompt}
            </p>
        </Modal>
    );
}

const promptStyle: React.CSSProperties = {
    margin: 'var(--ch-space-none)',
};

export default TacticsInGameMenu;
