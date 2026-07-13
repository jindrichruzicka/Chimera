// @vitest-environment jsdom
/**
 * apps/tactics/screens/TacticsInGameMenu.test.tsx
 *
 * RTL tests for the tactics in-game Leave-game confirmation dialog (F55 ·
 * §4.33). The component receives `closeMenu`/`leaveGame`/`isHost` through
 * `InGameMenuProps` (Invariant #100 — provided setters only, never IPC) and
 * renders a single-step confirmation: Cancel resumes, Leave abandons the match
 * with host-vs-client copy.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EscapeStackProvider } from '@chimera-engine/renderer/components/ui';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import type { TranslationBundle } from '@chimera-engine/renderer/i18n';
import { tacticsBundleCs } from '../shell/translations/cs.js';
import { tacticsBundleEn } from '../shell/translations/en.js';
import { TacticsInGameMenu } from './TacticsInGameMenu.js';

const TACTICS_LANGUAGES = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
] as const;

afterEach(() => {
    cleanup();
});

function renderMenu(
    props: Partial<React.ComponentProps<typeof TacticsInGameMenu>> = {},
    bundle: TranslationBundle = tacticsBundleEn,
    locale = 'en-US',
): {
    closeMenu: ReturnType<typeof vi.fn>;
    leaveGame: ReturnType<typeof vi.fn>;
} {
    const closeMenu = vi.fn();
    const leaveGame = vi.fn();
    // The dialog copy resolves through useTranslate() (throws outside a provider),
    // and the Modal registers an Escape layer needing an EscapeStackProvider.
    render(
        <I18nProvider gameOverride={bundle} languages={TACTICS_LANGUAGES} locale={locale}>
            <EscapeStackProvider>
                <TacticsInGameMenu
                    closeMenu={closeMenu}
                    leaveGame={leaveGame}
                    isHost={false}
                    {...props}
                />
            </EscapeStackProvider>
        </I18nProvider>,
    );
    return { closeMenu, leaveGame };
}

describe('TacticsInGameMenu', () => {
    it('invokes leaveGame then closes the menu when the leave action is confirmed', () => {
        const { closeMenu, leaveGame } = renderMenu();

        fireEvent.click(screen.getByTestId('tactics-leave-confirm'));

        // Every modal action runs, then the modal always dismisses (onClose).
        expect(leaveGame).toHaveBeenCalledTimes(1);
        expect(closeMenu).toHaveBeenCalledTimes(1);
    });

    it('invokes closeMenu (and not leaveGame) when cancelled', () => {
        const { closeMenu, leaveGame } = renderMenu();

        fireEvent.click(screen.getByTestId('tactics-leave-cancel'));

        expect(closeMenu).toHaveBeenCalledTimes(1);
        expect(leaveGame).not.toHaveBeenCalled();
    });

    it('shows host copy (returns everyone to the lobby) when isHost', () => {
        renderMenu({ isHost: true });

        const prompt = screen.getByTestId('tactics-leave-prompt').textContent ?? '';
        expect(prompt).toMatch(/lobby/i);
        expect(prompt).not.toMatch(/main menu/i);
    });

    it('shows client copy (disconnect to the main menu) when not host', () => {
        renderMenu({ isHost: false });

        const prompt = screen.getByTestId('tactics-leave-prompt').textContent ?? '';
        expect(prompt).toMatch(/main menu/i);
        expect(prompt).not.toMatch(/lobby/i);
    });

    it('renders the dialog title and actions in Czech when the Czech bundle is active', () => {
        renderMenu({ isHost: true }, tacticsBundleCs, 'cs-CZ');

        expect(screen.getByRole('dialog', { name: 'Opustit bitvu?' })).toBeTruthy();
        expect(screen.getByTestId('tactics-leave-cancel')).toHaveTextContent('Zrušit');
        expect(screen.getByTestId('tactics-leave-confirm')).toHaveTextContent('Opustit bitvu');
        expect(screen.getByTestId('tactics-leave-prompt').textContent).toContain('lobby');
    });
});
