// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React, { useContext } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { IconContext } from './icon-context';
import { IconProvider } from './IconProvider';
import { IconProvider as BarrelIconProvider } from '../index';
import type { GameIconSet, IconGlyph } from './registry';

afterEach(cleanup);

const bannerGlyph: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M6 2h12v18l-6-4-6 4z" />,
};

const GAME_ICONS: GameIconSet = { 'game.demo.banner': bannerGlyph };

/** A probe that reports the context value it reads back. */
function ContextProbe(): React.ReactElement {
    const gameIcons = useContext(IconContext);
    return (
        <span data-testid="probe">
            {gameIcons === null ? 'null' : Object.keys(gameIcons).sort().join(',')}
        </span>
    );
}

describe('IconProvider', () => {
    it('publishes the contributed set to IconContext', () => {
        render(
            <IconProvider gameIcons={GAME_ICONS}>
                <ContextProbe />
            </IconProvider>,
        );

        expect(screen.getByTestId('probe').textContent).toBe('game.demo.banner');
    });

    it('is inert by default: publishes null when no gameIcons are supplied', () => {
        render(
            <IconProvider>
                <ContextProbe />
            </IconProvider>,
        );

        expect(screen.getByTestId('probe').textContent).toBe('null');
    });

    it('is exported through the components/ui barrel (invariant #96)', () => {
        expect(BarrelIconProvider).toBe(IconProvider);
    });
});
