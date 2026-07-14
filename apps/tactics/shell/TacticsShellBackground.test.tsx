// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import { TacticsShellBackground } from './TacticsShellBackground';
import { tacticsManifest } from '../manifest';
import { tacticsBundleCs } from './translations/cs';
import { tacticsBundleEn } from './translations/en';
import styles from './TacticsShellBackground.module.css';
import css from './TacticsShellBackground.module.css?raw';

const TACTICS_LANGUAGES = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
] as const;

// The subtitle resolves through useTranslate() (throws outside a provider). Wrap
// every render in the English Tactics bundle so `game.tactics.shell.subtitle`
// resolves to the pre-tokenisation text.
function EnProviders({ children }: { readonly children: React.ReactNode }): React.ReactElement {
    return <I18nProvider gameOverride={tacticsBundleEn}>{children}</I18nProvider>;
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: EnProviders });

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
    it('renders a game-owned shell background surface styled by the CSS module', () => {
        const { container } = render(<TacticsShellBackground />);

        const background = screen.getByTestId('tactics-shell-background');
        expect(background).toBeTruthy();
        expect(background).toHaveClass(styles['menu-bg'] ?? 'menu-bg');
        // The background is a CSS module now — no raw <style> injection.
        expect(container.querySelector('style')).toBeNull();
    });

    it('defines the menu background selector', () => {
        const menuBgRule = /\.menu-bg\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';

        expect(menuBgRule).toContain('position: absolute;');
        expect(menuBgRule).toContain('top: 0;');
        expect(menuBgRule).toContain('left: 0;');
        expect(menuBgRule).toContain('width: 100%;');
        expect(menuBgRule).toContain('height: 100%;');
        expect(menuBgRule).toContain(
            'background: radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a12 70%);',
        );
        expect(menuBgRule).toContain('z-index: var(--ch-z-base);');
    });

    it('defines the pulsing menu background glow with a game-namespaced, token-timed animation', () => {
        const glowRule = /\.menu-bg::before\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';

        expect(glowRule).toContain("content: '';");
        expect(glowRule).toContain('position: absolute;');
        expect(glowRule).toContain('top: 50%;');
        expect(glowRule).toContain('left: 50%;');
        expect(glowRule).toContain('transform: translate(-50%, -50%);');
        expect(glowRule).toContain('width: 400px;');
        expect(glowRule).toContain('height: 400px;');
        expect(glowRule).toContain(
            'background: radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, transparent 70%);',
        );
        // Composed from the motion tokens (4000ms = slow × 10), so the pulse
        // collapses to 0ms under prefers-reduced-motion like every other
        // animation; the keyframe name is game-namespaced. Whitespace is
        // flattened because prettier wraps long declaration values.
        expect(glowRule.replace(/\s+/g, ' ')).toContain(
            'animation: tactics-menu-pulse calc(var(--ch-duration-slow) * 10) var(--ch-easing-standard) infinite;',
        );
        expect(css).toContain('@keyframes tactics-menu-pulse');
        expect(css).not.toMatch(/\b\d+m?s\b/);
        expect(css).not.toContain('ease-in-out');
    });

    it('renders game title and subtitle on the main-menu overlay', () => {
        render(<TacticsShellBackground />);

        const overlay = screen.getByTestId('tactics-shell-background-main-menu-overlay');
        expect(overlay).toBeTruthy();

        const title = screen.getByTestId('tactics-shell-background-title');
        expect(title).toBeTruthy();
        expect(title.textContent).toBe(tacticsManifest.displayName);
        expect(title.textContent).toBe('Tactics');

        const subtitle = screen.getByTestId('tactics-shell-background-subtitle');
        expect(subtitle).toBeTruthy();
        expect(subtitle.textContent).toBe('Chimera testing stub');
    });

    it('positions the main-menu overlay above the animated background', () => {
        render(<TacticsShellBackground />);

        expect(screen.getByTestId('tactics-shell-background')).toHaveClass(
            styles['menu-bg'] ?? 'menu-bg',
        );
        expect(screen.getByTestId('tactics-shell-background-main-menu-overlay')).toHaveClass(
            styles['main-menu-overlay'] ?? 'main-menu-overlay',
        );

        const overlayRule = /\.main-menu-overlay\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';

        expect(overlayRule).toContain('position: absolute;');
        expect(overlayRule).toContain('inset: 0;');
        expect(overlayRule).toContain('z-index: var(--ch-z-raised);');
    });

    it('renders game title and subtitle when the main-menu route has a trailing slash', () => {
        setPathname('/main-menu/');

        render(<TacticsShellBackground />);

        expect(screen.getByTestId('tactics-shell-background-title').textContent).toBe(
            tacticsManifest.displayName,
        );
        expect(screen.getByTestId('tactics-shell-background-subtitle').textContent).toBe(
            'Chimera testing stub',
        );
    });

    it('renders the subtitle in Czech when the Czech bundle is active', () => {
        baseRender(
            <I18nProvider
                gameOverride={tacticsBundleCs}
                languages={TACTICS_LANGUAGES}
                locale="cs-CZ"
            >
                <TacticsShellBackground />
            </I18nProvider>,
        );

        expect(screen.getByTestId('tactics-shell-background-subtitle').textContent).toBe(
            'Testovací výplň Chimera',
        );
    });

    it('shifts the main-menu overlay content 160px above center', () => {
        const overlayRule = /\.main-menu-overlay\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';

        expect(overlayRule).toContain('transform: translateY(-160px);');
    });

    it('defines the hero title and subtitle rules, drawing the title font from the button token', () => {
        const titleRule = /\.game-title\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';

        // The display font routes through the theme token (Cinzel in tactics)
        // instead of a hardcoded family literal.
        expect(titleRule).toContain('font-family: var(--ch-font-ui-button);');
        expect(css).not.toContain("'Cinzel'");
        expect(titleRule).toContain('font-size: 4rem;');
        expect(titleRule).toContain('font-weight: 900;');
        expect(titleRule).toContain('letter-spacing: 3px;');
        expect(titleRule).toContain(
            'background: linear-gradient(135deg, #f4d03f, #e67e22, #f4d03f);',
        );

        const subtitleRule = /\.subtitle\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(subtitleRule).toContain('font-size: 1.2rem;');
        expect(subtitleRule).toContain('color: #9b8ec4;');
        expect(subtitleRule).toContain('font-style: italic;');
    });
});
