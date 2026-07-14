// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Icon } from './Icon';
import { Icon as BarrelIcon } from '../index';
import { IconProvider } from './IconProvider';
import type { IconGlyph } from './registry';
import css from './Icon.module.css?raw';
import tokensCss from '../../../styles/tokens.css?raw';

afterEach(cleanup);

describe('Icon', () => {
    it('renders the registered svg glyph for a name', () => {
        const { container } = render(<Icon name="chat-bubble" />);

        const svg = container.querySelector('svg[data-ch-icon="chat-bubble"]');
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(svg?.querySelector('path')).not.toBeNull();
    });

    it('is decorative by default: aria-hidden, non-focusable, and exposes no img role', () => {
        const { container } = render(<Icon name="chat-bubble" />);

        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('focusable', 'false');
        expect(screen.queryByRole('img')).toBeNull();
    });

    it('becomes an accessible labelled image when given a title', () => {
        render(<Icon name="chat-bubble" title="Chat" />);

        const img = screen.getByRole('img', { name: 'Chat' });
        expect(img).not.toHaveAttribute('aria-hidden');
        expect(img.querySelector('title')).toHaveTextContent('Chat');
    });

    it('forwards className, style, and data-testid onto the svg', () => {
        render(
            <Icon
                className="extra-class"
                data-testid="the-icon"
                name="chat-bubble"
                style={{ opacity: 0.5 }}
            />,
        );

        const svg = screen.getByTestId('the-icon');
        expect(svg).toHaveClass('extra-class');
        expect(svg).toHaveStyle({ opacity: '0.5' });
    });

    it('is exported through the components/ui barrel (invariant #96)', () => {
        expect(BarrelIcon).toBe(Icon);
    });

    it('renders nothing and does not throw for an unknown name', () => {
        // The unguarded ICON_REGISTRY[name] lookup crashed on any unknown name
        // before the game-icon seam added the guard; a missing glyph must degrade.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { container } = render(<Icon name="does-not-exist" />);

        expect(container.querySelector('svg')).toBeNull();
        warn.mockRestore();
    });

    it('renders a game-contributed glyph supplied through IconProvider', () => {
        const glyph: IconGlyph = { viewBox: '0 0 10 10', content: <path d="M0 0h10v10H0z" /> };

        const { container } = render(
            <IconProvider gameIcons={{ 'game.demo.flag': glyph }}>
                <Icon name="game.demo.flag" />
            </IconProvider>,
        );

        const svg = container.querySelector('svg[data-ch-icon="game.demo.flag"]');
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('viewBox')).toBe('0 0 10 10');
        expect(svg?.querySelector('path')).not.toBeNull();
    });

    it('lets a game re-skin a built-in by re-keying its name (game-first lookup)', () => {
        const glyph: IconGlyph = { viewBox: '0 0 99 99', content: <rect height="1" width="1" /> };

        const { container } = render(
            <IconProvider gameIcons={{ save: glyph }}>
                <Icon name="save" />
            </IconProvider>,
        );

        const svg = container.querySelector('svg[data-ch-icon="save"]');
        // The game glyph's viewBox wins over the engine save glyph (0 0 24 24).
        expect(svg?.getAttribute('viewBox')).toBe('0 0 99 99');
        expect(svg?.querySelector('rect')).not.toBeNull();
    });

    it('falls back to the engine registry when the provider set lacks the name', () => {
        const glyph: IconGlyph = { viewBox: '0 0 10 10', content: <path d="M0 0h10v10H0z" /> };

        const { container } = render(
            <IconProvider gameIcons={{ 'game.demo.flag': glyph }}>
                <Icon name="save" />
            </IconProvider>,
        );

        const svg = container.querySelector('svg[data-ch-icon="save"]');
        // Engine save glyph renders (viewBox 0 0 24 24), not the game flag.
        expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    it('sizes via a token and colours via currentColor with no hardcoded values (invariant #86)', () => {
        expect(css).toContain('fill: currentColor');
        expect(css).toContain('var(--ch-size-icon)');
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        const hardcoded = css.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
        expect(hardcoded).toBeNull();

        expect(tokensCss).toContain('--ch-size-icon:');
    });
});
