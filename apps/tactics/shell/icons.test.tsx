// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon, IconButton, IconProvider } from '@chimera-engine/renderer/components/ui';
import { tacticsIcons } from './icons';

afterEach(cleanup);

describe('tacticsIcons', () => {
    it('contributes the game.tactics.banner glyph', () => {
        expect(Object.keys(tacticsIcons)).toContain('game.tactics.banner');
    });

    it('defines every glyph with a non-empty viewBox and a renderable content element (fill-based, no fill attr)', () => {
        for (const [name, glyph] of Object.entries(tacticsIcons)) {
            expect(typeof glyph.viewBox, name).toBe('string');
            expect(glyph.viewBox.length, name).toBeGreaterThan(0);
            expect(React.isValidElement(glyph.content), name).toBe(true);
            // Invariant #86: colour comes from `fill: currentColor`, so a glyph
            // carries no `fill` of its own.
            expect(JSON.stringify(glyph.content), name).not.toContain('"fill"');
        }
    });

    it('renders through the engine <Icon> inside an <IconButton> when supplied via IconProvider', () => {
        const { container } = render(
            <IconProvider gameIcons={tacticsIcons}>
                <IconButton aria-label="Banner">
                    <Icon name="game.tactics.banner" />
                </IconButton>
            </IconProvider>,
        );

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        expect(button?.querySelector('svg[data-ch-icon="game.tactics.banner"]')).not.toBeNull();
    });
});
