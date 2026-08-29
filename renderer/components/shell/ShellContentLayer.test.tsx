// @vitest-environment jsdom

/**
 * renderer/components/shell/ShellContentLayer.test.tsx
 *
 * The app-level frame that holds page content above the shell background
 * (§4.37.9), and stands aside when that background is interactive.
 *
 * jsdom performs no layout and ships no `document.elementFromPoint`, so nothing
 * here is a coordinate hit-test. What it CAN do — measured, not assumed — is
 * resolve the real cascade: `getComputedStyle` honours a `<style>` element's
 * rules, descendant combinators and the inheritance of `pointer-events`. So the
 * tests below inject the component's OWN stylesheet, with the CSS-module class
 * names substituted in from the module itself, and read back the property the
 * browser hit-tests with. A typo in the selector, a wrong property, or a class
 * that never reaches the element each fail here.
 *
 * Tests written first (TDD — red confirmed: the module did not exist, so the
 * import failed to resolve).
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import { _resetShellStateForTest, setShellRoute } from '../../shell/shellStateStore';
import { ShellContentLayer } from './ShellContentLayer';
import layerStyles from './ShellContentLayer.module.css';
import layerCss from './ShellContentLayer.module.css?raw';

const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

function GameBackground(): React.ReactElement {
    return <div data-testid="game-background" />;
}

/**
 * Put the component's own rules into the document under the class names the
 * component actually renders. Vitest hashes CSS-module class names, so the raw
 * text's `.click-through` matches nothing until it is rewritten through the
 * module's own map — which is what keeps this from hardcoding a hash.
 */
function installLayerStylesheet(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = layerCss.replaceAll(
        '.click-through',
        `.${layerStyles['click-through'] ?? 'click-through'}`,
    );
    document.head.appendChild(style);
    return style;
}

let styleEl: HTMLStyleElement;

function layerEl(): HTMLElement {
    return screen.getByTestId('shell-content-layer');
}

function effectivePointerEvents(element: Element): string {
    return getComputedStyle(element).pointerEvents;
}

beforeEach(() => {
    _resetShellStateForTest();
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
    styleEl = installLayerStylesheet();
});

afterEach(() => {
    cleanup();
    styleEl.remove();
    _resetShellStateForTest();
});

function renderLayer(): void {
    render(
        <ShellContentLayer>
            <main data-testid="page">
                <button data-testid="control">Play</button>
            </main>
        </ShellContentLayer>,
    );
}

describe('ShellContentLayer', () => {
    it('is the raised, relatively positioned frame the page content sits in', () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: null });
        renderLayer();

        // The two declarations this element exists for. Read off `style` rather
        // than `getComputedStyle`: jsdom refuses a `var()` value for `z-index`
        // when computing, but keeps it verbatim in the inline declaration.
        expect(layerEl().style.position).toBe('relative');
        expect(layerEl().style.zIndex).toBe('var(--ch-z-raised)');
        expect(screen.getByTestId('page')).toBeInTheDocument();
    });

    it('resolves pointer-events auto with no interactive background — the default path', () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: null });
        renderLayer();

        expect(layerEl()).not.toHaveClass(layerStyles['click-through'] ?? 'click-through');
        expect(effectivePointerEvents(layerEl())).toBe('auto');
        expect(effectivePointerEvents(screen.getByTestId('control'))).toBe('auto');
    });

    it('refuses pointer input once the active game declares an interactive background', async () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'fake' });
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        renderLayer();

        await waitFor(() => {
            expect(effectivePointerEvents(layerEl())).toBe('none');
        });
        // Inherited all the way down: the layer is what stops the click, and the
        // surfaces below it restore `auto` for themselves.
        expect(effectivePointerEvents(screen.getByTestId('control'))).toBe('none');
    });

    it('keeps pointer-events auto for a game with a background but no opt-in', async () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'fake' });
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
        } satisfies LoadedRendererGameShell);

        renderLayer();

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('fake');
        });
        expect(effectivePointerEvents(layerEl())).toBe('auto');
    });

    // The match is not a background surface, so the layer must never stand
    // aside there — the HUD and the in-game menu live in it.
    it('keeps pointer-events auto on the match surface', async () => {
        setShellRoute({ surface: 'match', pathname: '/game', gameId: 'fake' });
        mockLoadRendererGameShell.mockResolvedValue({
            shellBackground: GameBackground,
            shellBackgroundInteractive: true,
        } satisfies LoadedRendererGameShell);

        renderLayer();

        await waitFor(() => {
            expect(effectivePointerEvents(layerEl())).toBe('auto');
        });
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
    });
});
