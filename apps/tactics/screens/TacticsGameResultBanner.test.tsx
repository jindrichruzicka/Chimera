// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { playerId } from '@chimera-engine/electron/preload/api-types.js';
import { IconProvider } from '@chimera-engine/renderer/components/ui';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import { tacticsBundleCs } from '../shell/translations/cs.js';
import { tacticsBundleEn } from '../shell/translations/en.js';
import { tacticsIcons } from '../shell/icons.js';
import { TacticsGameResultBanner } from './TacticsGameResultBanner.js';

const TACTICS_LANGUAGES = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
] as const;

// The banner renders its outcome/hint copy through useTranslate() (which throws
// outside a provider) and its emblem through the engine <Icon>, which resolves
// `game.tactics.result-*` against the active IconProvider. Wrap in the English
// Tactics bundle + the Tactics icon set so the copy resolves and the heraldic
// glyph actually renders (mirroring the app-wide ActiveGameIconProvider).
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
});

describe('TacticsGameResultBanner', () => {
    it('shows a hint to press Enter to continue to the summary', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p1')] }}
            />,
        );

        expect(screen.getByTestId('game-result-hint').textContent).toBe('Press Enter to continue');
    });

    it('shows a tactics victory message when the local player won', () => {
        const localPlayerId = playerId('p1');

        render(
            <TacticsGameResultBanner
                localPlayerId={localPlayerId}
                gameResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.getByTestId('game-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('win');
        expect(screen.getByTestId('game-result-text').textContent).toBe('Tactical Victory');
    });

    it('renders the result message as status content rather than a document heading', () => {
        const localPlayerId = playerId('p1');

        render(
            <TacticsGameResultBanner
                localPlayerId={localPlayerId}
                gameResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.queryByRole('heading', { name: 'Tactical Victory' })).toBeNull();
    });

    it('renders the result panel with the shared card primitive', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p1')] }}
            />,
        );

        expect(screen.getByTestId('game-result-card')).toHaveAttribute(
            'data-ch-card-surface',
            'raised',
        );
        expect(screen.getByTestId('game-result-card')).toHaveAttribute(
            'data-ch-card-elevation',
            'md',
        );
        expect(screen.getByTestId('game-result-card')).toHaveAttribute(
            'data-ch-card-padding',
            'lg',
        );
    });

    it('shows a tactics defeat message when another player won', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Tactical Defeat');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('loss');
    });

    it('shows stalemate when the tactics result has no winners', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Stalemate');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('draw');
    });

    it('shows a neutral tactics message when the viewer is unknown', () => {
        render(<TacticsGameResultBanner gameResult={{ winnerIds: [playerId('p2')] }} />);

        expect(screen.getByTestId('game-result-text').textContent).toBe('Battle Concluded');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('unknown');
    });

    // The emblem is an accessible image host (role="img" + translated aria-label)
    // that renders the heraldic outcome glyph as a decorative <Icon> inside it, so
    // the emblem announces the outcome once while the SVG carries the visual. Each
    // outcome maps to its own game.tactics.result-* glyph.
    it('renders the victory emblem — accessible name plus the heraldic glyph', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p1')] }}
            />,
        );

        expect(screen.getByRole('img', { name: 'Victory' })).toBeTruthy();
        expect(
            screen
                .getByTestId('game-result-icon')
                .querySelector('svg[data-ch-icon="game.tactics.result-victory"]'),
        ).not.toBeNull();
    });

    it('renders the defeat emblem when the local player lost', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByRole('img', { name: 'Defeat' })).toBeTruthy();
        expect(
            screen
                .getByTestId('game-result-icon')
                .querySelector('svg[data-ch-icon="game.tactics.result-defeat"]'),
        ).not.toBeNull();
    });

    it('renders the draw emblem on stalemate', () => {
        render(
            <TacticsGameResultBanner
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByRole('img', { name: 'Draw' })).toBeTruthy();
        expect(
            screen
                .getByTestId('game-result-icon')
                .querySelector('svg[data-ch-icon="game.tactics.result-draw"]'),
        ).not.toBeNull();
    });

    it('renders the concluded emblem when the viewer is unknown', () => {
        render(<TacticsGameResultBanner gameResult={{ winnerIds: [playerId('p2')] }} />);

        expect(screen.getByRole('img', { name: 'Concluded' })).toBeTruthy();
        expect(
            screen
                .getByTestId('game-result-icon')
                .querySelector('svg[data-ch-icon="game.tactics.result-concluded"]'),
        ).not.toBeNull();
    });

    it('renders the victory message and hint in Czech when the Czech bundle is active', () => {
        const localPlayerId = playerId('p1');

        baseRender(
            <I18nProvider
                gameOverride={tacticsBundleCs}
                languages={TACTICS_LANGUAGES}
                locale="cs-CZ"
            >
                <IconProvider gameIcons={tacticsIcons}>
                    <TacticsGameResultBanner
                        localPlayerId={localPlayerId}
                        gameResult={{ winnerIds: [localPlayerId] }}
                    />
                </IconProvider>
            </I18nProvider>,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Taktické vítězství');
        expect(screen.getByTestId('game-result-hint').textContent).toBe(
            'Pokračuj stisknutím Enter',
        );
        expect(screen.getByRole('img', { name: 'Vítězství' })).toBeTruthy();
    });
});
