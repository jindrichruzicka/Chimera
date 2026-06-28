// @vitest-environment jsdom
// renderer/shell/renderMainMenuDefinition.test.tsx
//
// Unit tests for RenderMainMenuDefinition — the declarative engine menu renderer.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
// Task: #618 — renderMainMenuDefinition.tsx
//
// Invariants upheld:
//   #91 — no hardcoded colour/spacing/radius literals; all layout values use var(--ch-*)
//   #92 — all interactive actions use <Button> from renderer/components/ui/
//   #94 — no games/* import from shell page components
//
// Tests written first (TDD — red confirmed before implementation existed).

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    GameMainMenuDefinition,
    GameMenuCommandId,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import { RenderMainMenuDefinition } from './renderMainMenuDefinition';

// ── Router mock ───────────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

// ── System bridge mock ────────────────────────────────────────────────────────

beforeEach(() => {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: {
                quit: vi.fn(),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
    mockPush.mockReset();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderMenu(
    definition?: GameMainMenuDefinition,
    menuCommands?: Partial<Record<GameMenuCommandId, () => void>>,
    gameId?: string,
): void {
    render(
        <RenderMainMenuDefinition
            definition={definition}
            menuCommands={menuCommands}
            gameId={gameId}
        />,
    );
}

// ─── Engine default (undefined input) ────────────────────────────────────────

describe('engine default (definition = undefined)', () => {
    it('renders three buttons when no definition is provided', () => {
        renderMenu(undefined);

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(3);
    });

    it('renders Play button with primary variant', () => {
        renderMenu(undefined);

        const play = screen.getByRole('button', { name: 'Play' });
        expect(play).toBeInTheDocument();
        expect(play).toHaveAttribute('data-ch-button-variant', 'primary');
    });

    it('renders Settings button with secondary variant', () => {
        renderMenu(undefined);

        const settings = screen.getByRole('button', { name: 'Settings' });
        expect(settings).toBeInTheDocument();
        expect(settings).toHaveAttribute('data-ch-button-variant', 'secondary');
    });

    it('renders Quit button with danger variant', () => {
        renderMenu(undefined);

        const quit = screen.getByRole('button', { name: 'Quit' });
        expect(quit).toBeInTheDocument();
        expect(quit).toHaveAttribute('data-ch-button-variant', 'danger');
    });

    it('Play button navigates to /lobby on click', () => {
        renderMenu(undefined);

        fireEvent.click(screen.getByRole('button', { name: 'Play' }));
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('Settings button navigates to /settings on click', () => {
        renderMenu(undefined);

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(mockPush).toHaveBeenCalledWith('/settings');
    });

    it('Quit button calls window.__chimera.system.quit() on click', () => {
        renderMenu(undefined);

        fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
        expect(window.__chimera.system.quit).toHaveBeenCalledOnce();
    });

    it('all default buttons render as <Button> (data-ch-button-variant attribute present)', () => {
        renderMenu(undefined);

        const buttons = screen.getAllByRole('button');
        for (const btn of buttons) {
            expect(btn).toHaveAttribute('data-ch-button-variant');
        }
    });
});

// ─── Layout: orientation ──────────────────────────────────────────────────────

describe('layout orientation', () => {
    it('vertical orientation produces flexDirection column on container', () => {
        const def: GameMainMenuDefinition = {
            layout: { orientation: 'vertical' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const container = screen.getByTestId('menu-container');
        expect(container).toHaveStyle({ flexDirection: 'column' });
    });

    it('horizontal orientation produces flexDirection row on container', () => {
        const def: GameMainMenuDefinition = {
            layout: { orientation: 'horizontal' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const container = screen.getByTestId('menu-container');
        expect(container).toHaveStyle({ flexDirection: 'row' });
    });

    it('undefined orientation defaults to vertical (flexDirection column)', () => {
        const def: GameMainMenuDefinition = {
            layout: {},
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const container = screen.getByTestId('menu-container');
        expect(container).toHaveStyle({ flexDirection: 'column' });
    });
});

// ─── Layout: align ────────────────────────────────────────────────────────────

describe('layout align', () => {
    it('align=center maps to alignItems center', () => {
        const def: GameMainMenuDefinition = {
            layout: { align: 'center' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        expect(screen.getByTestId('menu-container')).toHaveStyle({ alignItems: 'center' });
    });

    it('align=start maps to alignItems flex-start', () => {
        const def: GameMainMenuDefinition = {
            layout: { align: 'start' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        expect(screen.getByTestId('menu-container')).toHaveStyle({ alignItems: 'flex-start' });
    });

    it('align=end maps to alignItems flex-end', () => {
        const def: GameMainMenuDefinition = {
            layout: { align: 'end' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        expect(screen.getByTestId('menu-container')).toHaveStyle({ alignItems: 'flex-end' });
    });

    it('undefined align defaults to center', () => {
        const def: GameMainMenuDefinition = {
            layout: {},
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        expect(screen.getByTestId('menu-container')).toHaveStyle({ alignItems: 'center' });
    });
});

// ─── Layout: gap — must use var(--ch-*) tokens, no bare pixel literals ────────

describe('layout gap (token-only CSS — Invariant #91)', () => {
    it('gap value is applied via a CSS custom property, not a bare pixel literal', () => {
        const def: GameMainMenuDefinition = {
            layout: { gap: 8 },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const container = screen.getByTestId('menu-container');
        // The inline style must NOT contain a raw "8px" literal; it must use var(--ch-space-sm).
        // jsdom represents inline custom properties via getPropertyValue.
        const inlineStyle = container.getAttribute('style') ?? '';
        expect(inlineStyle).not.toMatch(/gap:\s*8px/);
        // Positive assertion: gap=8 maps to the --ch-space-sm design token (Invariant #91).
        expect(inlineStyle).toContain('var(--ch-space-sm)');
    });

    it('undefined gap falls back to var(--ch-space-sm)', () => {
        const def: GameMainMenuDefinition = {
            layout: {},
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const container = screen.getByTestId('menu-container');
        const inlineStyle = container.getAttribute('style') ?? '';
        expect(inlineStyle).toContain('--ch-space-sm');
    });

    it('gap value outside the token map throws at render time', () => {
        // gap=7 is not in GAP_TOKEN_MAP — the renderer must reject it before producing any JSX.
        // Suppress React's console.error output for this expected throw so CI output stays clean.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const def: GameMainMenuDefinition = {
            layout: { gap: 7 },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        expect(() => renderMenu(def)).toThrow(
            '[RenderMainMenuDefinition] gap=7 does not map to a --ch-space-* token',
        );
        consoleError.mockRestore();
    });
});

// ─── Layout: anchor ───────────────────────────────────────────────────────────

describe('layout anchor', () => {
    it('anchor=center renders with no absolute positioning offset', () => {
        const def: GameMainMenuDefinition = {
            layout: { anchor: 'center' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const wrapper = screen.getByTestId('menu-wrapper');
        expect(wrapper).toHaveStyle({ position: 'relative' });
    });

    it('anchor=top-left renders with absolute position top-left', () => {
        const def: GameMainMenuDefinition = {
            layout: { anchor: 'top-left' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const wrapper = screen.getByTestId('menu-wrapper');
        expect(wrapper).toHaveStyle({ position: 'absolute' });
        // Anchored corners use var(--ch-space-none), not 0px
        const style = wrapper.getAttribute('style') ?? '';
        expect(style).not.toMatch(/top:\s*0px/);
        expect(style).not.toMatch(/left:\s*0px/);
    });

    it('anchor=bottom-right renders with absolute position bottom-right', () => {
        const def: GameMainMenuDefinition = {
            layout: { anchor: 'bottom-right' },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const wrapper = screen.getByTestId('menu-wrapper');
        expect(wrapper).toHaveStyle({ position: 'absolute' });
    });
});

// ─── Layout: offsetX / offsetY — must use var(--ch-*) tokens ─────────────────

describe('layout offsetX / offsetY (token-only — Invariant #91)', () => {
    it('offsetX=0 does not produce a bare 0px transform literal', () => {
        const def: GameMainMenuDefinition = {
            layout: { offsetX: 0 },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const container = screen.getByTestId('menu-container');
        const style = container.getAttribute('style') ?? '';
        expect(style).not.toMatch(/translateX\(0px\)/);
    });

    it('non-zero offsetX is expressed via a CSS custom property, not an inline pixel value', () => {
        const def: GameMainMenuDefinition = {
            layout: { offsetX: 16 },
            buttons: [{ label: 'Go', action: { type: 'quit' } }],
        };
        renderMenu(def);

        const container = screen.getByTestId('menu-container');
        const style = container.getAttribute('style') ?? '';
        // Must not be translateX(16px) — must use var(--ch-space-*) or --menu-offset-x
        expect(style).not.toMatch(/translateX\(16px\)/);
    });
});

// ─── Custom definition buttons ────────────────────────────────────────────────

describe('custom definition buttons', () => {
    it('renders the number of buttons declared in the definition', () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                { label: 'Alpha', action: { type: 'quit' } },
                { label: 'Beta', action: { type: 'quit' } },
                { label: 'Gamma', action: { type: 'quit' } },
            ],
        };
        renderMenu(def);

        expect(screen.getAllByRole('button')).toHaveLength(3);
    });

    it('all custom buttons render with data-ch-button-variant attribute (Invariant #92)', () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                { label: 'One', action: { type: 'quit' } },
                { label: 'Two', action: { type: 'quit' }, variant: 'secondary' },
            ],
        };
        renderMenu(def);

        const buttons = screen.getAllByRole('button');
        for (const btn of buttons) {
            expect(btn).toHaveAttribute('data-ch-button-variant');
        }
    });

    it('empty buttons array renders no buttons', () => {
        const def: GameMainMenuDefinition = { buttons: [] };
        renderMenu(def);

        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('navigate action calls router.push with the target route', () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Leaderboard',
                    action: { type: 'navigate', target: '/leaderboard' },
                },
            ],
        };
        renderMenu(def);

        fireEvent.click(screen.getByRole('button', { name: 'Leaderboard' }));
        expect(mockPush).toHaveBeenCalledWith('/leaderboard');
    });

    it('open-lobby action navigates to /lobby', () => {
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Multiplayer', action: { type: 'open-lobby' } }],
        };
        renderMenu(def);

        fireEvent.click(screen.getByRole('button', { name: 'Multiplayer' }));
        expect(mockPush).toHaveBeenCalledWith('/lobby');
    });

    it('open-lobby action preserves ?gameId= when game context is active (§4.37.6)', () => {
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Play', action: { type: 'open-lobby' } }],
        };
        renderMenu(def, undefined, 'tactics');

        fireEvent.click(screen.getByRole('button', { name: 'Play' }));
        expect(mockPush).toHaveBeenCalledWith('/lobby?gameId=tactics');
    });

    it('navigate action preserves ?gameId= when game context is active (§4.37.6)', () => {
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Settings', action: { type: 'navigate', target: '/settings' } }],
        };
        renderMenu(def, undefined, 'tactics');

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(mockPush).toHaveBeenCalledWith('/settings?gameId=tactics');
    });

    it('quit action calls window.__chimera.system.quit()', () => {
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Exit', action: { type: 'quit' }, variant: 'danger' }],
        };
        renderMenu(def);

        fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
        expect(window.__chimera.system.quit).toHaveBeenCalledOnce();
    });

    it('button variant is forwarded to <Button>', () => {
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Go', action: { type: 'quit' }, variant: 'ghost' }],
        };
        renderMenu(def);

        expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute(
            'data-ch-button-variant',
            'ghost',
        );
    });
});

// ─── Command dispatch ─────────────────────────────────────────────────────────

describe('command action dispatch', () => {
    it('known commandId invokes the registered handler on click', () => {
        const handler = vi.fn();
        const commandId = 'game:start-tutorial' as GameMenuCommandId;

        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Tutorial', action: { type: 'command', commandId } }],
        };
        renderMenu(def, { [commandId]: handler });

        fireEvent.click(screen.getByRole('button', { name: 'Tutorial' }));
        expect(handler).toHaveBeenCalledOnce();
    });

    it('unknown commandId throws before rendering (fail-fast)', () => {
        const commandId = 'game:missing' as GameMenuCommandId;

        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Unknown', action: { type: 'command', commandId } }],
        };

        // The component is expected to throw because commandId is not in menuCommands
        expect(() => renderMenu(def, {})).toThrow();
    });

    it('command action with no menuCommands registry throws', () => {
        const commandId = 'game:credits' as GameMenuCommandId;

        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Credits', action: { type: 'command', commandId } }],
        };

        expect(() => renderMenu(def)).toThrow();
    });
});

// ─── Disabled buttons (F44 T7 — #661) ─────────────────────────────────────────

describe('disabled buttons', () => {
    it('boolean disabled=true renders the button as disabled', () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Replays',
                    action: { type: 'navigate', target: '/replays' },
                    disabled: true,
                },
            ],
        };
        renderMenu(def);

        expect(screen.getByRole('button', { name: 'Replays' })).toBeDisabled();
    });

    it('boolean disabled=false renders the button as enabled', () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Replays',
                    action: { type: 'navigate', target: '/replays' },
                    disabled: false,
                },
            ],
        };
        renderMenu(def);

        expect(screen.getByRole('button', { name: 'Replays' })).not.toBeDisabled();
    });

    it('button with no disabled field renders as enabled', () => {
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Replays', action: { type: 'navigate', target: '/replays' } }],
        };
        renderMenu(def);

        expect(screen.getByRole('button', { name: 'Replays' })).not.toBeDisabled();
    });

    it('async disabled() resolving false ends up enabled', async () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Replays',
                    action: { type: 'navigate', target: '/replays' },
                    disabled: async (): Promise<boolean> => false,
                },
            ],
        };
        renderMenu(def);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Replays' })).not.toBeDisabled(),
        );
    });

    it('async disabled() resolving true ends up disabled (e.g. empty replay list)', async () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Replays',
                    action: { type: 'navigate', target: '/replays' },
                    disabled: async (): Promise<boolean> => true,
                },
            ],
        };
        renderMenu(def);

        await waitFor(() => expect(screen.getByRole('button', { name: 'Replays' })).toBeDisabled());
    });

    it('renders disabled while an async disabled() check is pending (fail-safe), then resolves', async () => {
        let resolvePending!: (value: boolean) => void;
        const pending = new Promise<boolean>((resolve) => {
            resolvePending = resolve;
        });
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Replays',
                    action: { type: 'navigate', target: '/replays' },
                    disabled: (): Promise<boolean> => pending,
                },
            ],
        };
        renderMenu(def);

        // Pending → disabled (fail-safe, avoids a flash of enabled then disabled).
        expect(screen.getByRole('button', { name: 'Replays' })).toBeDisabled();

        await act(async () => {
            resolvePending(false);
        });
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Replays' })).not.toBeDisabled(),
        );
    });

    it('treats a rejected async disabled() check as disabled and logs at warn level', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Replays',
                    action: { type: 'navigate', target: '/replays' },
                    disabled: async (): Promise<boolean> => {
                        throw new Error('IPC unavailable');
                    },
                },
            ],
        };
        renderMenu(def);

        await waitFor(() => expect(screen.getByRole('button', { name: 'Replays' })).toBeDisabled());
        expect(warnSpy).toHaveBeenCalled();
    });

    it('an enabled async button still navigates on click', async () => {
        const def: GameMainMenuDefinition = {
            buttons: [
                {
                    label: 'Replays',
                    action: { type: 'navigate', target: '/replays' },
                    disabled: async (): Promise<boolean> => false,
                },
            ],
        };
        renderMenu(def, undefined, 'tactics');

        const button = await screen.findByRole('button', { name: 'Replays' });
        await waitFor(() => expect(button).not.toBeDisabled());

        fireEvent.click(button);
        expect(mockPush).toHaveBeenCalledWith('/replays?gameId=tactics');
    });
});

// ─── No raw <button> elements (Invariant #92) ─────────────────────────────────

describe('Invariant #92 — no raw <button> bypassing <Button>', () => {
    it('every rendered button carries data-ch-button-variant (proves <Button> used)', () => {
        renderMenu(undefined);

        const buttons = document.querySelectorAll('button');
        expect(buttons.length).toBeGreaterThan(0);
        for (const btn of buttons) {
            expect(btn.hasAttribute('data-ch-button-variant')).toBe(true);
        }
    });
});

// ─── Quit — bridge unavailable ────────────────────────────────────────────────

describe('quit action — bridge unavailable', () => {
    it('fires a bridge-unavailable error when Quit is clicked without a bridge', () => {
        // Remove the bridge populated by beforeEach.
        Reflect.deleteProperty(window, '__chimera');

        // React 18 routes uncaught event-handler errors through window.reportError
        // (→ ErrorEvent on window) rather than rethrowing synchronously.
        // Capture the event so we can assert on the error without the test crashing.
        let firedError: Error | null = null;
        const errorListener = (e: ErrorEvent): void => {
            firedError = e.error as Error;
            e.preventDefault();
        };
        window.addEventListener('error', errorListener);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        renderMenu(undefined);
        fireEvent.click(screen.getByRole('button', { name: 'Quit' }));

        window.removeEventListener('error', errorListener);
        consoleSpy.mockRestore();

        expect(firedError).not.toBeNull();
        expect(firedError!.message).toBe('Chimera system API not available');
    });
});
