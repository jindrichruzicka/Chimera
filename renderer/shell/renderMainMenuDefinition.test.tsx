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
//   #94 — no apps/* import from shell page components
//
// Tests written first (TDD — red confirmed before implementation existed).

import '@testing-library/jest-dom/vitest';
import {
    act,
    cleanup,
    fireEvent,
    render as baseRender,
    screen,
    waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    GameMainMenuDefinition,
    GameMenuCommandId,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type { SaveSlotMeta, SlotId } from '@chimera-engine/simulation/bridge/api-types.js';
import type { LobbyState } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { QuickStartConfig } from '@chimera-engine/simulation/foundation/quick-start-contract.js';
import { autosaveSlotId } from '@chimera-engine/simulation/foundation/save-slots.js';
import { ConfirmDialogHost } from '../components/shell/ConfirmDialogHost';
import { FadeProvider } from '../components/shell/FadeContext';
import { EscapeStackProvider } from '../components/shell/EscapeStack';
import { I18nProvider } from '../i18n/I18nProvider';
import type { TranslationBundle } from '../i18n/translation-bundle';
import { useConfirmDialogStore } from '../state/confirmDialogStore';
import { useLobbyStore } from '../state/lobbyStore';
import { useSaveStore } from '../state/saveStore';
import { _resetShellStateForTest, getShellState } from './shellStateStore';
import { RenderMainMenuDefinition } from './renderMainMenuDefinition';

// The renderer translates the three engine-default button labels through
// useTranslate() (which throws outside a provider), so every render mounts an
// inert I18nProvider (engine English) to keep the default-label assertions
// identical to the ship strings. A `gameOverride` bundle can prove those three
// labels are token-driven (a game re-keying `engine.menu.*` relabels them).
let currentOverride: TranslationBundle | undefined;

function render(ui: React.ReactElement): ReturnType<typeof baseRender> {
    // Spread `gameOverride` only when set: the prop is optional and the tree
    // compiles with exactOptionalPropertyTypes, so an explicit `undefined` is
    // rejected.
    const providerProps = currentOverride !== undefined ? { gameOverride: currentOverride } : {};
    return baseRender(<I18nProvider {...providerProps}>{ui}</I18nProvider>);
}

// ── Router mock ───────────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

// ── System bridge mock ────────────────────────────────────────────────────────

const mockQuit = vi.fn();
const mockSavesLoad = vi.fn(async (): Promise<void> => undefined);
const mockQuickStart = vi.fn(async (): Promise<void> => undefined);

beforeEach(() => {
    _resetShellStateForTest();
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: { quit: mockQuit },
            saves: { load: mockSavesLoad },
            lobby: { quickStart: mockQuickStart },
        },
    });
    // The two engine verbs read the live save slot list and lobby state off the
    // singleton stores, so each test starts from a hydrated, session-less shell.
    useSaveStore.setState({ slots: [], isLoading: false });
    useLobbyStore.getState().applyLobbyState(null);
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
    mockPush.mockReset();
    mockQuit.mockReset();
    mockSavesLoad.mockReset();
    mockQuickStart.mockReset();
    // Drain anything a test left queued so the confirm singleton stays clean.
    for (const entry of useConfirmDialogStore.getState().queue) {
        useConfirmDialogStore.getState().settle(entry.id, false);
    }
    useLobbyStore.getState().applyLobbyState(null);
    currentOverride = undefined;
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

    it('resolves the three engine-default labels through engine.menu.* tokens (game override wins)', () => {
        currentOverride = {
            'engine.menu.play': 'Start',
            'engine.menu.settings': 'Options',
            'engine.menu.quit': 'Exit',
        };
        renderMenu(undefined);

        expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
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

    it('resolves a game-provided button label through the active translator (token → override)', () => {
        // A game may store a translation-token key as its button label; the
        // renderer resolves it through `t()`, so the game's own bundle (or an
        // override) drives the visible text.
        currentOverride = { 'game.example.menu.start': 'Nová hra' };
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'game.example.menu.start', action: { type: 'open-lobby' } }],
        };
        renderMenu(def);

        expect(screen.getByRole('button', { name: 'Nová hra' })).toBeInTheDocument();
    });

    it('renders a plain (non-token) game button label verbatim (backward compatible)', () => {
        // A label with no matching token falls back to itself, so games that
        // still pass literal display strings keep working unchanged.
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Leaderboard', action: { type: 'navigate', target: '/board' } }],
        };
        renderMenu(def);

        expect(screen.getByRole('button', { name: 'Leaderboard' })).toBeInTheDocument();
    });

    it('renders a literal label containing ICU-significant characters verbatim', () => {
        // A literal that happens to contain `{`/`#` must not be parsed as an ICU
        // template — an unresolved (non-token) label is returned as written.
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Buy {gold} #1', action: { type: 'quit' } }],
        };
        renderMenu(def);

        expect(screen.getByRole('button', { name: 'Buy {gold} #1' })).toBeInTheDocument();
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

// ─── Engine verbs: continue / start-game, and the confirm primitive ───────────
//
// These two verbs are engine-implemented, so the renderer — not the game — owns
// their availability and their IPC call. `continue` is the first button whose
// disabled state is REACTIVE: it follows the save slot list rather than being
// resolved once at render, so a `saves:slot-update` push flips it live.

const GAME_ID = 'tactics';

function autosaveSlot(gameId: string): SaveSlotMeta {
    return {
        slotId: autosaveSlotId(gameId) as SlotId,
        gameId,
        savedAt: 1,
        label: 'Autosave',
    } as SaveSlotMeta;
}

function makeLobbyState(gameId: string): LobbyState {
    return {
        info: { sessionId: 'session-1', hostId: 'p1', gameId },
        players: [{ playerId: 'p1', displayName: 'Player One', ready: true }],
    };
}

/**
 * Renders the menu with the single confirm surface mounted above it, which is
 * the composition AppShell provides on every route. Without the host a
 * confirmed button's promise never settles, so a confirm test that omits it
 * would prove nothing about the action ever running.
 */
function renderMenuWithConfirmSurface(
    definition: GameMainMenuDefinition,
    gameId: string | null = GAME_ID,
): void {
    // Same gameOverride plumbing as render() above, so a confirm test can prove
    // its declared tokens resolve through the active translator.
    const providerProps = currentOverride !== undefined ? { gameOverride: currentOverride } : {};
    baseRender(
        <I18nProvider {...providerProps}>
            <EscapeStackProvider>
                <RenderMainMenuDefinition definition={definition} gameId={gameId} />
                <ConfirmDialogHost />
            </EscapeStackProvider>
        </I18nProvider>,
    );
}

function continueMenu(): GameMainMenuDefinition {
    return { buttons: [{ label: 'Continue', action: { type: 'continue' } }] };
}

describe('continue action', () => {
    it('renders disabled when the active game has no autosave', () => {
        renderMenuWithConfirmSurface(continueMenu());

        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('renders enabled when the slot list already carries the game autosave', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });

        renderMenuWithConfirmSurface(continueMenu());

        expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
    });

    it('flips enabled the moment a slot-update push lands', () => {
        renderMenuWithConfirmSurface(continueMenu());
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

        act(() => {
            useSaveStore.getState().applySaveSlots([autosaveSlot(GAME_ID)]);
        });

        expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
    });

    it('flips back to disabled when the autosave is deleted', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(continueMenu());
        expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();

        act(() => {
            useSaveStore.getState().applySaveSlots([]);
        });

        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('ignores another game autosave — the slot id is fully qualified', () => {
        useSaveStore.setState({ slots: [autosaveSlot('other-game')], isLoading: false });

        renderMenuWithConfirmSurface(continueMenu());

        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('renders disabled while joined to a session, autosave or not', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        useLobbyStore.getState().applyLobbyState(makeLobbyState(GAME_ID));

        renderMenuWithConfirmSurface(continueMenu());

        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('re-enables when the session ends while the menu is on screen', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        useLobbyStore.getState().applyLobbyState(makeLobbyState(GAME_ID));
        renderMenuWithConfirmSurface(continueMenu());
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

        act(() => {
            useLobbyStore.getState().applyLobbyState(null);
        });

        expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
    });

    it('loads the game autosave slot through the ordinary restore funnel', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(continueMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(mockSavesLoad).toHaveBeenCalledTimes(1);
        expect(mockSavesLoad).toHaveBeenCalledWith(autosaveSlotId(GAME_ID));
    });

    it('issues the load and nothing else — the handler never routes', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(continueMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('reports a rejected load rather than leaving an unhandled rejection', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockSavesLoad.mockRejectedValueOnce(new Error('no such slot'));
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(continueMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('continue'),
            expect.any(Error),
        );
    });

    it('refuses to render without a game context — the slot cannot be named', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => {
            renderMenuWithConfirmSurface(continueMenu(), null);
        }).toThrow(/continue/u);

        errorSpy.mockRestore();
    });
});

// ─── start-game ───────────────────────────────────────────────────────────────

function startMenu(config?: QuickStartConfig): GameMainMenuDefinition {
    return {
        buttons: [
            {
                label: 'Quick Match',
                action:
                    config === undefined ? { type: 'start-game' } : { type: 'start-game', config },
            },
        ],
    };
}

describe('start-game action', () => {
    it('invokes the quick-start verb for the active game exactly once', () => {
        renderMenuWithConfirmSurface(startMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(mockQuickStart).toHaveBeenCalledTimes(1);
        expect(mockQuickStart).toHaveBeenCalledWith({ gameId: GAME_ID });
    });

    it('passes the declared config alongside the game id', () => {
        renderMenuWithConfirmSurface(startMenu({ aiSeats: [{ attributes: { team: 'green' } }] }));

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(mockQuickStart).toHaveBeenCalledWith({
            gameId: GAME_ID,
            aiSeats: [{ attributes: { team: 'green' } }],
        });
    });

    it('issues the verb and nothing else — the handler never routes', () => {
        renderMenuWithConfirmSurface(startMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(mockPush).not.toHaveBeenCalled();
    });

    it('reports a rejected quick start rather than leaving an unhandled rejection', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockQuickStart.mockRejectedValueOnce(new Error('a session is already active'));
        renderMenuWithConfirmSurface(startMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('start-game'),
            expect.any(Error),
        );
    });

    it('refuses to render without a game context — there is no game to start', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => {
            renderMenuWithConfirmSurface(startMenu(), null);
        }).toThrow(/start-game/u);

        errorSpy.mockRestore();
    });
});

describe('the engine verbs arm the shell transition', () => {
    it('arms a to-match transition when start-game is invoked', () => {
        renderMenuWithConfirmSurface(startMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(getShellState().transition).toMatchObject({ kind: 'to-match' });
    });

    it('clears the transition when the quick start is refused', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockQuickStart.mockRejectedValueOnce(new Error('a session is already active'));
        renderMenuWithConfirmSurface(startMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(getShellState().transition).toBeNull();
        errorSpy.mockRestore();
    });

    it('arms a to-match transition when continue is invoked', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(continueMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(getShellState().transition).toMatchObject({ kind: 'to-match' });
    });

    it('clears the transition when the autosave load is refused', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockSavesLoad.mockRejectedValueOnce(new Error('no such slot'));
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(continueMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(getShellState().transition).toBeNull();
        errorSpy.mockRestore();
    });

    it('arms nothing for a plain navigate button', () => {
        renderMenuWithConfirmSurface({
            buttons: [{ label: 'Settings', action: { type: 'navigate', target: '/settings' } }],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(getShellState().transition).toBeNull();
    });
});

// ─── confirm ──────────────────────────────────────────────────────────────────

function confirmedStartMenu(
    confirm: NonNullable<GameMainMenuDefinition['buttons'][number]['confirm']>,
): GameMainMenuDefinition {
    return {
        buttons: [{ label: 'Quick Match', action: { type: 'start-game' }, confirm }],
    };
}

describe('button confirmation', () => {
    it('asks before running the action and holds the verb until the answer', () => {
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'always', title: 'Start a new match?' }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Start a new match?')).toBeInTheDocument();
        expect(mockQuickStart).not.toHaveBeenCalled();
    });

    it('runs the action exactly once when the player accepts', async () => {
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'always', title: 'Start a new match?' }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        });

        expect(mockQuickStart).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    it('keeps the menu and never runs the action when the player declines', async () => {
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'always', title: 'Start a new match?' }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
        });

        expect(mockQuickStart).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Quick Match' })).toBeInTheDocument();
    });

    it('treats Escape as a decline', async () => {
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'always', title: 'Start a new match?' }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        await act(async () => {
            fireEvent.keyDown(window, { key: 'Escape' });
        });

        expect(mockQuickStart).not.toHaveBeenCalled();
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    it('resolves the declared title, body and labels through the active translator', () => {
        currentOverride = {
            'game.tactics.confirm.title': 'Overwrite your save?',
            'game.tactics.confirm.body': 'The autosave will be replaced.',
            'game.tactics.confirm.ok': 'Overwrite',
            'game.tactics.confirm.no': 'Keep it',
        };
        renderMenuWithConfirmSurface(
            confirmedStartMenu({
                when: 'always',
                title: 'game.tactics.confirm.title',
                body: 'game.tactics.confirm.body',
                confirmLabel: 'game.tactics.confirm.ok',
                cancelLabel: 'game.tactics.confirm.no',
            }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(screen.getByText('Overwrite your save?')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-dialog-body')).toHaveTextContent(
            'The autosave will be replaced.',
        );
        expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Overwrite');
        expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Keep it');
    });

    it('asks under when: autosave-exists while the game has an autosave', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'autosave-exists', title: 'Overwrite your save?' }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(mockQuickStart).not.toHaveBeenCalled();
    });

    it('skips the question under when: autosave-exists when there is no autosave', () => {
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'autosave-exists', title: 'Overwrite your save?' }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
        expect(mockQuickStart).toHaveBeenCalledTimes(1);
    });

    it('holds the button disabled until the slot list hydrates, so a first-run player is never asked', () => {
        useSaveStore.setState({ slots: [], isLoading: true });
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'autosave-exists', title: 'Overwrite your save?' }),
        );

        const button = screen.getByRole('button', { name: 'Quick Match' });
        expect(button).toBeDisabled();

        fireEvent.click(button);
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
        expect(mockQuickStart).not.toHaveBeenCalled();

        act(() => {
            useSaveStore.getState().applySaveSlots([]);
        });

        expect(screen.getByRole('button', { name: 'Quick Match' })).not.toBeDisabled();
    });

    it('does not hold a when: always button while the slot list is loading', () => {
        useSaveStore.setState({ slots: [], isLoading: true });
        renderMenuWithConfirmSurface(
            confirmedStartMenu({ when: 'always', title: 'Start a new match?' }),
        );

        expect(screen.getByRole('button', { name: 'Quick Match' })).not.toBeDisabled();
    });

    it('does not hold a when: autosave-exists button with no game context — no game, no autosave', () => {
        useSaveStore.setState({ slots: [], isLoading: true });
        renderMenuWithConfirmSurface(
            {
                buttons: [
                    {
                        label: 'Quit',
                        action: { type: 'quit' },
                        confirm: { when: 'autosave-exists', title: 'Overwrite your save?' },
                    },
                ],
            },
            null,
        );

        expect(screen.getByRole('button', { name: 'Quit' })).not.toBeDisabled();
    });

    it('gates any action type, not just the engine verbs', async () => {
        renderMenuWithConfirmSurface({
            buttons: [
                {
                    label: 'Quit',
                    action: { type: 'quit' },
                    confirm: { when: 'always', title: 'Really quit?' },
                },
            ],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
        expect(mockQuit).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        });

        expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('runs a button with no confirm declaration immediately', () => {
        renderMenuWithConfirmSurface(startMenu());

        fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
        expect(mockQuickStart).toHaveBeenCalledTimes(1);
    });
});

// ─── Engine verbs — bridge unavailable ───────────────────────────────────────
//
// Both verbs reach the preload bridge at CALL time, so each carries its own
// missing-bridge guard. Without a positive control the guard is a branch no
// fixture trips, and dropping it would surface as a bare TypeError instead.

describe('engine verbs — bridge unavailable', () => {
    function captureUncaughtError(run: () => void): Error | null {
        let fired: Error | null = null;
        const listener = (event: ErrorEvent): void => {
            fired = event.error as Error;
            event.preventDefault();
        };
        window.addEventListener('error', listener);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        run();

        window.removeEventListener('error', listener);
        consoleSpy.mockRestore();
        return fired;
    }

    it('fires a bridge-unavailable error when continue is clicked without a saves bridge', () => {
        // The slot list lives in renderer state, so the button stays enabled
        // after the bridge itself is gone — which is what reaches the guard.
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        renderMenuWithConfirmSurface(continueMenu());
        Reflect.deleteProperty(window, '__chimera');

        const fired = captureUncaughtError(() => {
            fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        });

        expect(fired).not.toBeNull();
        expect(fired?.message).toBe('Chimera saves API not available');
    });

    it('fires a bridge-unavailable error when start-game is clicked without a lobby bridge', () => {
        renderMenuWithConfirmSurface(startMenu());
        Reflect.deleteProperty(window, '__chimera');

        const fired = captureUncaughtError(() => {
            fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));
        });

        expect(fired).not.toBeNull();
        expect(fired?.message).toBe('Chimera lobby API not available');
    });

    it('fires a bridge-unavailable error when the lobby bridge carries no quick-start verb', () => {
        renderMenuWithConfirmSurface(startMenu());
        Object.defineProperty(window, '__chimera', {
            configurable: true,
            value: { system: { quit: mockQuit }, lobby: {} },
        });

        const fired = captureUncaughtError(() => {
            fireEvent.click(screen.getByRole('button', { name: 'Quick Match' }));
        });

        expect(fired).not.toBeNull();
        expect(fired?.message).toBe('Chimera lobby API not available');
    });
});

// ─── Engine gates vs a game's own `disabled` ─────────────────────────────────
//
// The two engine gates answer conditions the game cannot see, so they are
// resolved BEFORE a declared `disabled` and win over it. Without a fixture that
// declares `disabled: false` on a gated button, demoting the gates below the
// declaration changes nothing any test can see.

describe('engine gates outrank a declared disabled', () => {
    it('keeps continue disabled with no autosave even when the game declares disabled: false', () => {
        renderMenuWithConfirmSurface({
            buttons: [{ label: 'Continue', action: { type: 'continue' }, disabled: false }],
        });

        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('keeps continue disabled during a session even when the game declares disabled: false', () => {
        useSaveStore.setState({ slots: [autosaveSlot(GAME_ID)], isLoading: false });
        useLobbyStore.getState().applyLobbyState(makeLobbyState(GAME_ID));

        renderMenuWithConfirmSurface({
            buttons: [{ label: 'Continue', action: { type: 'continue' }, disabled: false }],
        });

        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('keeps start-game disabled during a session even when the game declares disabled: false', () => {
        useLobbyStore.getState().applyLobbyState(makeLobbyState(GAME_ID));

        renderMenuWithConfirmSurface({
            buttons: [{ label: 'Quick Match', action: { type: 'start-game' }, disabled: false }],
        });

        expect(screen.getByRole('button', { name: 'Quick Match' })).toBeDisabled();
    });

    it('holds an unhydrated autosave-exists confirm even when the game declares disabled: false', () => {
        useSaveStore.setState({ slots: [], isLoading: true });

        renderMenuWithConfirmSurface({
            buttons: [
                {
                    label: 'Quit',
                    action: { type: 'quit' },
                    disabled: false,
                    confirm: { when: 'autosave-exists', title: 'Overwrite your save?' },
                },
            ],
        });

        expect(screen.getByRole('button', { name: 'Quit' })).toBeDisabled();
    });
});

// ─── start-game while a session is live ──────────────────────────────────────
//
// `QuickStartCoordinator` refuses a quick start while any lobby session exists,
// so an enabled Quick Match there could only produce a rejected invoke with no
// visible feedback. The same live-session condition therefore gates both engine
// verbs.

describe('start-game during a live session', () => {
    it('renders disabled while a session is live', () => {
        useLobbyStore.getState().applyLobbyState(makeLobbyState(GAME_ID));

        renderMenuWithConfirmSurface(startMenu());

        expect(screen.getByRole('button', { name: 'Quick Match' })).toBeDisabled();
    });

    it('re-enables when the session ends while the menu is on screen', () => {
        useLobbyStore.getState().applyLobbyState(makeLobbyState(GAME_ID));
        renderMenuWithConfirmSurface(startMenu());
        expect(screen.getByRole('button', { name: 'Quick Match' })).toBeDisabled();

        act(() => {
            useLobbyStore.getState().applyLobbyState(null);
        });

        expect(screen.getByRole('button', { name: 'Quick Match' })).not.toBeDisabled();
    });

    it('leaves a navigate button untouched during a session', () => {
        useLobbyStore.getState().applyLobbyState(makeLobbyState(GAME_ID));

        renderMenuWithConfirmSurface({
            buttons: [{ label: 'Settings', action: { type: 'navigate', target: '/settings' } }],
        });

        expect(screen.getByRole('button', { name: 'Settings' })).not.toBeDisabled();
    });
});

// ─── navigate reaches a game shell page (§4.37.17) ───────────────────────────

describe('navigate → a game-declared shell page', () => {
    // Mounted under a real <FadeProvider>, so the two branches of the
    // `target === '/game'` fork are distinguishable: an instant hop pushes
    // during the click, a faded one only after the overlay reaches black.
    function renderFaded(definition: GameMainMenuDefinition, gameId: string): void {
        render(
            <FadeProvider>
                <RenderMainMenuDefinition definition={definition} gameId={gameId} />
            </FadeProvider>,
        );
    }

    it('pushes a declared game page during the click, with ?gameId= preserved', () => {
        renderFaded(
            { buttons: [{ label: 'Credits', action: { type: 'navigate', target: '/credits' } }] },
            'tactics',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Credits' }));

        expect(mockPush).toHaveBeenCalledWith('/credits?gameId=tactics');
    });

    it('holds the /game hop behind the match-entry fade instead', () => {
        renderFaded(
            { buttons: [{ label: 'Enter', action: { type: 'navigate', target: '/game' } }] },
            'tactics',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

        expect(mockPush).not.toHaveBeenCalled();
    });
});
