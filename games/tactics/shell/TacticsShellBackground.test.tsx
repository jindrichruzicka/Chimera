// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TacticsShellBackground } from './TacticsShellBackground';

afterEach(() => {
    cleanup();
});

describe('TacticsShellBackground', () => {
    it('renders a game-owned shell background surface', () => {
        render(<TacticsShellBackground />);

        const background = screen.getByTestId('tactics-shell-background');
        expect(background).toBeTruthy();
        expect(background).toHaveStyle({ minHeight: '100vh' });
    });

    it('uses the token cascade for its gradient colors', () => {
        render(<TacticsShellBackground />);

        const background = screen.getByTestId('tactics-shell-background');
        const backgroundStyle = background.getAttribute('style') ?? '';

        expect(backgroundStyle).toContain('var(--ch-color-surface)');
        expect(backgroundStyle).toContain('var(--ch-color-surface-raised)');
        expect(backgroundStyle).toContain('var(--ch-color-accent)');
    });

    it('applies a top-to-bottom gradient direction', () => {
        render(<TacticsShellBackground />);

        const background = screen.getByTestId('tactics-shell-background');
        const backgroundStyle = background.getAttribute('style') ?? '';

        expect(backgroundStyle).toContain('to bottom');
    });
});
