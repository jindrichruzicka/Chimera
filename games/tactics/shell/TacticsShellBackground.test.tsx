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
        expect(background).toHaveClass('menu-bg');
    });

    it('defines the menu background selector', () => {
        render(<TacticsShellBackground />);

        const styles = document.querySelector('style')?.textContent ?? '';

        expect(styles).toContain('.menu-bg {');
        expect(styles).toContain('position: absolute;');
        expect(styles).toContain('top: 0;');
        expect(styles).toContain('left: 0;');
        expect(styles).toContain('width: 100%;');
        expect(styles).toContain('height: 100%;');
        expect(styles).toContain(
            'background: radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a12 70%);',
        );
        expect(styles).toContain('z-index: 0;');
    });

    it('defines the pulsing menu background glow', () => {
        render(<TacticsShellBackground />);

        const styles = document.querySelector('style')?.textContent ?? '';

        expect(styles).toContain('.menu-bg::before {');
        expect(styles).toContain("content: '';");
        expect(styles).toContain('position: absolute;');
        expect(styles).toContain('top: 50%;');
        expect(styles).toContain('left: 50%;');
        expect(styles).toContain('transform: translate(-50%, -50%);');
        expect(styles).toContain('width: 400px;');
        expect(styles).toContain('height: 400px;');
        expect(styles).toContain(
            'background: radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, transparent 70%);',
        );
        expect(styles).toContain('animation: pulse 4s ease-in-out infinite;');
        expect(styles).toContain('@keyframes pulse');
    });
});
