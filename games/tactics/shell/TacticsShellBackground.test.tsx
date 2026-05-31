// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TacticsShellBackground } from './TacticsShellBackground';

const { navigationState } = vi.hoisted(() => ({
    navigationState: {
        pathname: '/main-menu',
    },
}));

vi.mock('next/navigation', () => ({
    usePathname: () => navigationState.pathname,
}));

function setPathname(pathname: string): void {
    navigationState.pathname = pathname;
}

beforeEach(() => {
    setPathname('/main-menu');
});

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

    it('renders game title and subtitle on the main-menu overlay', () => {
        render(<TacticsShellBackground />);

        const overlay = screen.getByTestId('tactics-shell-background-main-menu-overlay');
        expect(overlay).toBeTruthy();

        const title = screen.getByTestId('tactics-shell-background-title');
        expect(title).toBeTruthy();
        expect(title.textContent).toBe('Tactics');

        const subtitle = screen.getByTestId('tactics-shell-background-subtitle');
        expect(subtitle).toBeTruthy();
        expect(subtitle.textContent).toBe('Chimera testing stub');
    });

    it('positions the main-menu overlay above the animated background', () => {
        render(<TacticsShellBackground />);

        expect(screen.getByTestId('tactics-shell-background')).toHaveClass('menu-bg');
        expect(screen.getByTestId('tactics-shell-background-main-menu-overlay')).toHaveClass(
            'main-menu-overlay',
        );

        const styles = document.querySelector('style')?.textContent ?? '';

        expect(styles).toContain('.main-menu-overlay {');
        expect(styles).toContain('position: absolute;');
        expect(styles).toContain('inset: 0;');
        expect(styles).toContain('z-index: 1;');
    });

    it('renders game title and subtitle when the main-menu route has a trailing slash', () => {
        setPathname('/main-menu/');

        render(<TacticsShellBackground />);

        expect(screen.getByTestId('tactics-shell-background-title').textContent).toBe('Tactics');
        expect(screen.getByTestId('tactics-shell-background-subtitle').textContent).toBe(
            'Chimera testing stub',
        );
    });

    it('shifts the main-menu overlay content 100px above center', () => {
        render(<TacticsShellBackground />);

        const styles = document.querySelector('style')?.textContent ?? '';

        expect(styles).toContain('transform: translateY(-100px);');
    });

    it('defines .game-title and .subtitle CSS rules', () => {
        render(<TacticsShellBackground />);

        const styles = document.querySelector('style')?.textContent ?? '';

        expect(styles).toContain('.game-title {');
        expect(styles).toContain("font-family: 'Cinzel', serif;");
        expect(styles).toContain('font-size: 4rem;');
        expect(styles).toContain('font-weight: 900;');
        expect(styles).toContain('background: linear-gradient(135deg, #f4d03f, #e67e22, #f4d03f);');
        expect(styles).toContain('.subtitle {');
        expect(styles).toContain('font-size: 1.2rem;');
        expect(styles).toContain('color: #9b8ec4;');
        expect(styles).toContain('font-style: italic;');
    });
});
