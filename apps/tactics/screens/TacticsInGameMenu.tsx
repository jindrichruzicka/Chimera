'use client';

import React from 'react';
import type { InGameMenuProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { Modal } from '@chimera-engine/renderer/components/ui';
import { useTranslate } from '@chimera-engine/renderer/i18n';
import { IN_GAME_MENU_KEYS } from '../shell/translations/keys.js';

/**
 * Tactics Leave-game confirmation dialog (§4.33). Adopted via the
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
    const t = useTranslate();
    const prompt = isHost
        ? t(IN_GAME_MENU_KEYS.leavePromptHost)
        : t(IN_GAME_MENU_KEYS.leavePromptClient);

    // Cancel resumes the match: the Modal's `onClose` covers Escape and the
    // Cancel action (no `onClick` → dismiss only), both funnelling to `closeMenu`.
    // Leave runs `leaveGame`, then the modal closes like any action.
    return (
        <Modal
            open
            title={t(IN_GAME_MENU_KEYS.leaveTitle)}
            onClose={closeMenu}
            actions={[
                { label: t(IN_GAME_MENU_KEYS.cancel), testId: 'tactics-leave-cancel' },
                {
                    label: t(IN_GAME_MENU_KEYS.leaveConfirm),
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
