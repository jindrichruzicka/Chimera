// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { Icon as BarrelIcon } from '../index';
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

    it('sizes via a token and colours via currentColor with no hardcoded values (invariant #86)', () => {
        expect(css).toContain('fill: currentColor');
        expect(css).toContain('var(--ch-icon-size)');
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        const hardcoded = css.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
        expect(hardcoded).toBeNull();

        expect(tokensCss).toContain('--ch-size-icon:');
        expect(tokensCss).toContain('--ch-icon-size: var(--ch-size-icon);');
    });
});
