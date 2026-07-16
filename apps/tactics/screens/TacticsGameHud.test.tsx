// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerId,
    type PlayerSnapshot,
} from '@chimera-engine/electron/preload/api-types.js';
import {
    TACTICS_COMMIT_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
} from '@chimera-engine/tactics/simulation/constants.js';
import type { GameHudProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { entityId } from '@chimera-engine/electron/preload/api-types.js';
import { EscapeStackProvider, IconProvider } from '@chimera-engine/renderer/components/ui';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import { tacticsGridCoordinate } from '../simulation/actions.js';
import type { BufferedTacticsAction } from '../simulation/commitment/contract.js';
import { tacticsIcons } from '../shell/icons.js';
import { tacticsBundleCs } from '../shell/translations/cs.js';
import { tacticsBundleEn } from '../shell/translations/en.js';
import { TacticsGameHud } from './TacticsGameHud';
import { useCommitmentBuffer } from './useCommitmentBuffer';
import styles from './TacticsGameHud.module.css';
import css from './TacticsGameHud.module.css?raw';

const TACTICS_LANGUAGES = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
] as const;

// The HUD mounts the shared ChatPanel + SaveGameButton and renders its own
// `game.tactics.*` tokens through useTranslate() (which throws outside a
// provider), inside the shared Drawer (Escape-to-close routes through the overlay
// stack). Wrap every render in both providers with the English Tactics bundle so
// `game.tactics.*` resolve to English (an inert provider would render raw keys).
function HudProviders({ children }: { readonly children: React.ReactNode }): React.ReactElement {
    return (
        <I18nProvider gameOverride={tacticsBundleEn}>
            <IconProvider gameIcons={tacticsIcons}>
                <EscapeStackProvider>{children}</EscapeStackProvider>
            </IconProvider>
        </I18nProvider>
    );
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: HudProviders });

beforeEach(() => {
    // The HUD now mounts the shared ChatPanel, which resolves past its
    // loading/unavailable states via the host chat IPC bridge; stub it.
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            chat: {
                send: vi.fn().mockResolvedValue({ ok: true }),
                onMessage: vi.fn().mockReturnValue(vi.fn()),
                history: vi.fn().mockResolvedValue([]),
                mute: vi.fn(),
                unmute: vi.fn(),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    delete (window as unknown as { __chimera?: unknown }).__chimera;
    useCommitmentBuffer.getState().reset();
});

// A commitment-mode snapshot: turnMode='commitment', a viewer-owned unit so the
// optimistic view can apply a buffered move, and per-seat `committed` markers.
function makeCommitmentSnapshot(
    committed: { readonly p1?: boolean; readonly p2?: boolean } = {},
): PlayerSnapshot {
    const p1 = playerId('p1');
    const p2 = playerId('p2');
    return makeSnapshot({
        players: {
            [p1]: {
                id: p1,
                stamina: { current: 3, max: 3 },
                ...(committed.p1 ? { committed: true } : {}),
            },
            [p2]: { id: p2, ...(committed.p2 ? { committed: true } : {}) },
        } as unknown as PlayerSnapshot['players'],
        entities: {
            'unit-1': { id: entityId('unit-1'), kind: 'unit', ownerId: p1, x: 0, y: 0, hp: 1 },
        } as unknown as PlayerSnapshot['entities'],
        setup: { matchSettings: { turnMode: 'commitment' }, playerAttributes: {} },
    });
}

const BUFFERED_MOVE: BufferedTacticsAction = {
    type: TACTICS_MOVE_UNIT_ACTION,
    payload: {
        unitId: entityId('unit-1'),
        x: tacticsGridCoordinate(0),
        y: tacticsGridCoordinate(1),
    },
};

// The viewer's own stamina rides along on the projected player state at runtime
// (#721). The generic `ObservedPlayerState` type is just `{ id }`, so tests cast
// the richer projected shape into `players`, mirroring the board test's
// `ProjectedUnitFixture` approach. `'absent'` models a pre-#721 snapshot with no
// stamina field; `null` models a masked (non-owner) entry.
interface ProjectedPlayerFixture {
    readonly id: PlayerId;
    readonly stamina?: { readonly current: number; readonly max: number } | null;
}

function makeSnapshot(
    overrides: Partial<PlayerSnapshot> = {},
    viewerStamina: { readonly current: number; readonly max: number } | null | 'absent' = {
        current: 2,
        max: 3,
    },
): PlayerSnapshot {
    const id = playerId('p1');
    const player: ProjectedPlayerFixture =
        viewerStamina === 'absent' ? { id } : { id, stamina: viewerStamina };
    const players: Record<string, ProjectedPlayerFixture> = { [id]: player };
    return {
        tick: 7,
        viewerId: id,
        players,
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}

function makeHudProps(overrides: Partial<GameHudProps> = {}): GameHudProps {
    return {
        snapshot: makeSnapshot(),
        localPlayerId: playerId('p1'),
        sendAction: vi.fn(),
        tick: 7,
        undoDisabled: false,
        redoDisabled: true,
        endTurnDisabled: false,
        handleUndo: vi.fn(),
        handleRedo: vi.fn(),
        handleEndTurn: vi.fn(),
        ...overrides,
    };
}

describe('TacticsGameHud', () => {
    it('renders the stable game HUD locator surface', () => {
        render(<TacticsGameHud {...makeHudProps({ tick: 12 })} />);

        expect(screen.getByLabelText('Game HUD')).toBeTruthy();
        expect(screen.getByTestId('undo')).toBeTruthy();
        expect(screen.getByTestId('redo')).toBeTruthy();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
    });

    it('does not surface the engine tick — it is simulation plumbing, not player info', () => {
        render(<TacticsGameHud {...makeHudProps({ tick: 12 })} />);

        // The tick readout was removed entirely: no DOM node, no visible number.
        expect(screen.queryByTestId('hud-tick')).toBeNull();
        expect(screen.queryByText('12')).toBeNull();
    });

    it('renders the game-contributed banner glyph through the engine <Icon> (#113)', () => {
        // The game supplies its own glyph via the shell.icons seam; the engine
        // <Icon> resolves `game.tactics.banner` from the IconProvider set and
        // renders it as a tokenized currentColor SVG, exactly like a built-in.
        render(<TacticsGameHud {...makeHudProps()} />);

        const emblem = screen.getByTestId('tactics-hud-emblem');
        expect(emblem.tagName.toLowerCase()).toBe('svg');
        expect(emblem).toHaveAttribute('data-ch-icon', 'game.tactics.banner');
    });

    it('renders the HUD in Czech when the Czech bundle is active', () => {
        baseRender(
            <I18nProvider
                gameOverride={tacticsBundleCs}
                languages={TACTICS_LANGUAGES}
                locale="cs-CZ"
            >
                <IconProvider gameIcons={tacticsIcons}>
                    <EscapeStackProvider>
                        <TacticsGameHud {...makeHudProps()} />
                    </EscapeStackProvider>
                </IconProvider>
            </I18nProvider>,
        );

        // End Turn keeps its visible label (the hero action); Undo/Redo are now
        // icon-only, so their translated string names them via the accessible name.
        expect(screen.getByTestId('end-turn')).toHaveTextContent('Ukončit tah');
        expect(screen.getByTestId('undo')).toHaveAccessibleName('Zpět');
        expect(screen.getByTestId('redo')).toHaveAccessibleName('Znovu');
        expect(screen.getByTestId('tactics-turn-status')).toHaveTextContent('Tvůj tah');
    });

    it('keeps the in-match chat collapsed by default so it cannot cover the board', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        // Collapsed by default: only the toggle is mounted; the ChatPanel is not
        // in the tree, so it cannot occlude board interaction behind it.
        const toggle = screen.getByTestId('tactics-chat-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(screen.queryByTestId('chat-unavailable')).toBeNull();
    });

    it('opens the chat inside the shared Drawer dialog when toggled, as a sibling of the HUD footer', async () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        fireEvent.click(screen.getByTestId('tactics-chat-toggle'));

        // Tactics mounts the shared ChatPanel inside the shared Drawer primitive,
        // so in-match chat is a proper accessible dialog rather than an ad-hoc div.
        const dialog = await screen.findByRole('dialog', { name: 'Match chat' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');

        const chatPanel = screen.getByTestId('chat-panel');
        expect(dialog.contains(chatPanel)).toBe(true);
        expect(screen.getByTestId('tactics-chat-toggle')).toHaveAttribute('aria-expanded', 'true');

        // The drawer is a sibling of the HUD footer, not nested inside the landmark.
        expect(screen.getByLabelText('Game HUD').contains(chatPanel)).toBe(false);
    });

    it('hides the chat drawer title visually while keeping the dialog named', async () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        fireEvent.click(screen.getByTestId('tactics-chat-toggle'));

        // The dialog keeps its accessible name, but the visible caption is gone.
        expect(await screen.findByRole('dialog', { name: 'Match chat' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Match chat' }).className).toContain(
            'titleHidden',
        );
    });

    it('collapses the chat drawer again when toggled off', async () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        const toggle = screen.getByTestId('tactics-chat-toggle');
        fireEvent.click(toggle);
        expect(await screen.findByRole('dialog', { name: 'Match chat' })).toBeTruthy();

        fireEvent.click(toggle);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes the chat drawer through the shared Drawer dismissal affordances, keeping the toggle in sync', async () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        const toggle = screen.getByTestId('tactics-chat-toggle');
        fireEvent.click(toggle);
        expect(await screen.findByRole('dialog', { name: 'Match chat' })).toBeTruthy();

        // The Drawer owns Escape-to-dismiss; closing it drives the toggle state so
        // the corner button reflects the collapsed chat afterwards.
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('chat-panel')).toBeNull();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    describe('in-match chat toggle (icon button)', () => {
        it('is a borderless icon-only button showing the chat-bubble glyph, with no visible text', () => {
            render(<TacticsGameHud {...makeHudProps()} />);

            const toggle = screen.getByTestId('tactics-chat-toggle');
            expect(toggle.querySelector('svg[data-ch-icon="chat-bubble"]')).not.toBeNull();
            expect(toggle).not.toHaveTextContent('Chat');
            // Chrome-less ghost variant: no border, just the glyph over the board.
            expect(toggle).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        });

        it('takes its accessible name from aria-label and keeps the disclosure wiring', () => {
            render(<TacticsGameHud {...makeHudProps()} />);

            const toggle = screen.getByRole('button', { name: 'Chat' });
            expect(toggle).toHaveAttribute('data-testid', 'tactics-chat-toggle');
            expect(toggle).toHaveAttribute('aria-expanded', 'false');
        });

        it('switches its accessible name to "Hide chat" when opened, staying icon-only', async () => {
            render(<TacticsGameHud {...makeHudProps()} />);

            fireEvent.click(screen.getByTestId('tactics-chat-toggle'));

            const toggle = await screen.findByRole('button', { name: 'Hide chat' });
            expect(toggle).toHaveAttribute('aria-expanded', 'true');
            expect(toggle.querySelector('svg[data-ch-icon="chat-bubble"]')).not.toBeNull();
            expect(toggle).not.toHaveTextContent('Hide chat');
        });

        it('labels the toggle from the active Czech bundle', () => {
            baseRender(
                <I18nProvider
                    gameOverride={tacticsBundleCs}
                    languages={TACTICS_LANGUAGES}
                    locale="cs-CZ"
                >
                    <EscapeStackProvider>
                        <TacticsGameHud {...makeHudProps()} />
                    </EscapeStackProvider>
                </I18nProvider>,
            );

            expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute(
                'data-testid',
                'tactics-chat-toggle',
            );
            fireEvent.click(screen.getByTestId('tactics-chat-toggle'));
            expect(screen.getByRole('button', { name: 'Skrýt chat' })).toBeTruthy();
        });

        it('docks the toggle inside the HUD footer row, vertically centred on the command bar', () => {
            render(<TacticsGameHud {...makeHudProps()} />);

            const dock = screen.getByTestId('tactics-chat-dock');
            expect(dock).toHaveClass(styles['chat-dock'] ?? 'chat-dock');
            // The dock lives INSIDE the footer landmark so it shares the command
            // bar's row (and vertical centre) instead of free-floating over the board.
            expect(screen.getByLabelText('Game HUD').contains(dock)).toBe(true);

            const dockRule = /\.chat-dock\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
            // The dock is an IN-FLOW grid item in the footer's trailing column —
            // not an absolute/fixed overlay — so it can never paint over (or
            // steal clicks from) the centered island at narrow window widths.
            expect(dockRule).toContain('justify-self: end');
            expect(dockRule).not.toContain('position: fixed');
            expect(dockRule).not.toContain('position: absolute');

            // The footer row reserves symmetric 1fr gutters around the island,
            // so the island stays truly centered while the dock owns the
            // trailing gutter (grid columns cannot overlap).
            const hudRule = /\.hud\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
            expect(hudRule).toContain('grid-template-columns: 1fr auto 1fr');
            expect(hudRule).toContain('align-items: center');
        });
    });

    it('styles the HUD through tokenized module classes instead of inline constants', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        // The numeric readout weight and the dimmed stamina state live in the
        // module, tokenized, rather than in inline style objects.
        const tickRule = /\.tick\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(tickRule).toContain('font-weight: var(--ch-font-weight-bold)');

        expect(css).toContain(".stamina-group[data-dimmed='true']");

        const troughMatch = /to\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(troughMatch).toContain('opacity: var(--ch-opacity-soft)');

        // The `.tick` numeric style now rides the stamina readout (the tick
        // readout itself is gone).
        expect(screen.getByTestId('hud-stamina')).toHaveClass(styles['tick'] ?? 'tick');
    });

    it('renders engine controls with shared UI button primitives', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        // Undo/Redo are borderless (ghost) icon buttons — End Turn is the single
        // filled hero action, so the strip reads as a game command bar, not a
        // bordered widget toolbar.
        expect(screen.getByTestId('undo')).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        expect(screen.getByTestId('redo')).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        expect(screen.getByTestId('end-turn')).toHaveAttribute('data-ch-button-variant', 'primary');
    });

    it('keeps the cluster rules short so the engine divider default cannot inflate the bar', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        // Cascade guard: the engine Divider's `.vertical` rule carries a large
        // standalone min-height (--ch-divider-length-sm). A bare `.divider`
        // override ties with it on specificity and loses on bundle order, which
        // is exactly the regression that once inflated the HUD island to 172px.
        // The compound `.hud .divider` selector (0,2,0) outranks it regardless
        // of CSS order, pinning the rules to a short token length.
        const dividerRule = /\.hud\s+\.divider\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(dividerRule).toContain('min-height: var(--ch-space-lg)');
        expect(screen.getByTestId('tactics-hud-divider')).toHaveClass(
            styles['divider'] ?? 'divider',
        );
    });

    it('order-proofs every engine-primitive override with a .hud compound selector', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        // The same (0,1,0) specificity tie that inflated the divider exists for
        // every tactics class that lands on an element which also carries an
        // engine-module class. Each override rides a `.hud`-compound selector
        // (0,2,0) so per-chunk bundle order can never decide the island's shape:
        // the slim Panel padding (vs engine .panel's --ch-space-lg) and the
        // compact End Turn custom props (vs engine Button's .sm min-width).
        const panelRule = /\.hud\s+\.panel\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(panelRule).toContain('padding: var(--ch-space-xs) var(--ch-space-md)');

        const endTurnRule = /\.hud\s+\.end-turn\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(endTurnRule).toContain('--ch-button-min-width: auto');

        // No bare (compound-less) top-level override of those engine classes
        // may sneak back in.
        expect(/(^|\})\s*\.panel\s*\{/m.test(css)).toBe(false);
        expect(/(^|\})\s*\.end-turn\s*\{/m.test(css)).toBe(false);
    });

    it('renders Undo/Redo as icon-only buttons carrying the game-contributed glyphs (#113)', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        const undo = screen.getByTestId('undo');
        expect(undo.querySelector('svg[data-ch-icon="game.tactics.undo"]')).not.toBeNull();
        expect(undo).toHaveAccessibleName('Undo');
        // Icon-only: the accessible name lives on aria-label, not visible text.
        expect(undo).not.toHaveTextContent('Undo');

        const redo = screen.getByTestId('redo');
        expect(redo.querySelector('svg[data-ch-icon="game.tactics.redo"]')).not.toBeNull();
        expect(redo).toHaveAccessibleName('Redo');
        expect(redo).not.toHaveTextContent('Redo');
    });

    it('renders End Turn as an icon + label primary button (glyph plus its translated text)', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        const endTurn = screen.getByTestId('end-turn');
        expect(endTurn.querySelector('svg[data-ch-icon="game.tactics.end-turn"]')).not.toBeNull();
        expect(endTurn).toHaveTextContent('End Turn');
    });

    it('labels the stamina readout with the game-contributed lightning glyph', () => {
        render(
            <TacticsGameHud {...makeHudProps({ snapshot: makeSnapshot({ isMyTurn: true }) })} />,
        );

        const group = screen.getByTestId('hud-stamina-group');
        expect(group.querySelector('svg[data-ch-icon="game.tactics.stamina"]')).not.toBeNull();
        // The numeric readout still exposes the raw current/max text e2e reads.
        expect(screen.getByTestId('hud-stamina')).toHaveTextContent('2/3');
    });

    it('presents turn status as a chrome-less state lamp on the raised panel', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        expect(screen.getByTestId('tactics-hud-panel')).toHaveAttribute(
            'data-ch-panel-variant',
            'raised',
        );
        // The bordered Badge chip is gone: turn status is a dot + label readout
        // driven by data-state, so the identity cluster carries no widget chrome.
        const status = screen.getByTestId('tactics-turn-status');
        expect(status).toHaveAttribute('data-state', 'yours');
        expect(status).not.toHaveAttribute('data-ch-badge-variant');
        expect(status).toHaveTextContent('Your turn');

        // The state lamp maps its colours from the shared state quartets.
        const statusRule = /\.turn-status\[data-state='yours'\]\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(statusRule).toContain('var(--ch-color-success-text)');

        // e2e contract: GamePage.turnStatusText() reads Playwright innerText(),
        // which returns RENDERED text — a `text-transform` here would silently
        // break every exact-match 'Your turn'/'Waiting' poll in the e2e suite.
        // The small-caps look comes from the display face, never the transform.
        const lampRule = /\.turn-status\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(lampRule).not.toContain('text-transform');
    });

    it("shows the local player's stamina as current/max while it is their turn", () => {
        render(
            <TacticsGameHud {...makeHudProps({ snapshot: makeSnapshot({ isMyTurn: true }) })} />,
        );

        expect(screen.getByTestId('hud-stamina')).toHaveTextContent('2/3');
        // Active on the viewer's turn — not dimmed.
        expect(screen.getByTestId('hud-stamina-group')).not.toHaveAttribute('data-dimmed');
    });

    it('keeps the stamina readout but dims it when it is not the local turn', () => {
        render(
            <TacticsGameHud
                {...makeHudProps({
                    snapshot: makeSnapshot({ isMyTurn: false }),
                    endTurnDisabled: true,
                })}
            />,
        );

        expect(screen.getByTestId('hud-stamina')).toHaveTextContent('2/3');
        expect(screen.getByTestId('hud-stamina-group')).toHaveAttribute('data-dimmed', 'true');
    });

    it('omits the stamina readout when the projected snapshot carries no viewer stamina', () => {
        const { rerender } = render(
            <TacticsGameHud {...makeHudProps({ snapshot: makeSnapshot({}, null) })} />,
        );

        // Masked (non-owner) → null stamina: nothing to show.
        expect(screen.queryByTestId('hud-stamina')).toBeNull();
        expect(screen.queryByTestId('hud-stamina-group')).toBeNull();

        // Pre-#721 snapshot with no stamina field at all → still nothing to show.
        rerender(<TacticsGameHud {...makeHudProps({ snapshot: makeSnapshot({}, 'absent') })} />);
        expect(screen.queryByTestId('hud-stamina')).toBeNull();
    });

    it('marks the HUD as waiting when it is not the local turn', () => {
        render(
            <TacticsGameHud
                {...makeHudProps({
                    snapshot: makeSnapshot({ isMyTurn: false }),
                    endTurnDisabled: true,
                })}
            />,
        );

        const status = screen.getByTestId('tactics-turn-status');
        expect(status).toHaveAttribute('data-state', 'waiting');
        expect(status).toHaveTextContent('Waiting');

        // The waiting lamp maps to the warning quartet — as strong a pin as the
        // Badge variant='warning' assertion this readout replaced.
        const waitingRule =
            /\.turn-status\[data-state='waiting'\]\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
        expect(waitingRule).toContain('var(--ch-color-warning-text)');
    });

    it('uses the engine-owned callbacks and disabled states', () => {
        const handleUndo = vi.fn();
        const handleRedo = vi.fn();
        const handleEndTurn = vi.fn();

        render(
            <TacticsGameHud
                {...makeHudProps({
                    undoDisabled: false,
                    redoDisabled: true,
                    endTurnDisabled: false,
                    handleUndo,
                    handleRedo,
                    handleEndTurn,
                })}
            />,
        );

        expect(screen.getByTestId('undo')).not.toBeDisabled();
        expect(screen.getByTestId('redo')).toBeDisabled();
        expect(screen.getByTestId('end-turn')).not.toBeDisabled();

        fireEvent.click(screen.getByTestId('undo'));
        fireEvent.click(screen.getByTestId('redo'));
        fireEvent.click(screen.getByTestId('end-turn'));

        expect(handleUndo).toHaveBeenCalledOnce();
        expect(handleRedo).not.toHaveBeenCalled();
        expect(handleEndTurn).toHaveBeenCalledOnce();
    });

    describe('commitment battle mode', () => {
        it('End Turn dispatches tactics:commit carrying the buffer (no separate Commit button)', () => {
            useCommitmentBuffer.setState({ buffer: [BUFFERED_MOVE] });
            const sendAction = vi.fn();
            render(
                <TacticsGameHud
                    {...makeHudProps({ snapshot: makeCommitmentSnapshot(), sendAction })}
                />,
            );

            // The Commit button and Redo are gone in commitment mode.
            expect(screen.queryByTestId('tactics-commit')).toBeNull();
            expect(screen.queryByTestId('redo')).toBeNull();

            fireEvent.click(screen.getByTestId('end-turn'));

            expect(sendAction).toHaveBeenCalledWith({
                type: TACTICS_COMMIT_ACTION,
                playerId: playerId('p1'),
                tick: 7,
                payload: { actions: [BUFFERED_MOVE] },
            });
        });

        it('Undo pops the local buffer instead of dispatching engine undo', () => {
            useCommitmentBuffer.setState({ buffer: [BUFFERED_MOVE] });
            const handleUndo = vi.fn();
            render(
                <TacticsGameHud
                    {...makeHudProps({ snapshot: makeCommitmentSnapshot(), handleUndo })}
                />,
            );

            fireEvent.click(screen.getByTestId('undo'));

            expect(handleUndo).not.toHaveBeenCalled(); // engine undo NOT used
            expect(useCommitmentBuffer.getState().buffer).toHaveLength(0); // buffer popped
        });

        it('End Turn is enabled until the viewer commits, then disabled while waiting', () => {
            const { rerender } = render(
                <TacticsGameHud
                    {...makeHudProps({
                        snapshot: makeCommitmentSnapshot({ p1: false, p2: false }),
                    })}
                />,
            );
            // Not yet committed → End Turn is the commit affordance (enabled).
            expect(screen.getByTestId('end-turn')).not.toBeDisabled();

            rerender(
                <TacticsGameHud
                    {...makeHudProps({ snapshot: makeCommitmentSnapshot({ p1: true, p2: false }) })}
                />,
            );
            // The viewer has committed → End Turn disabled while waiting for others.
            expect(screen.getByTestId('end-turn')).toBeDisabled();
        });

        it('shows the pulsing waiting message only after the viewer commits and before all commit', () => {
            const { rerender } = render(
                <TacticsGameHud {...makeHudProps({ snapshot: makeCommitmentSnapshot() })} />,
            );
            // Not committed → no waiting message.
            expect(screen.queryByTestId('tactics-commit-status')).toBeNull();

            rerender(
                <TacticsGameHud
                    {...makeHudProps({ snapshot: makeCommitmentSnapshot({ p1: true, p2: false }) })}
                />,
            );
            const waiting = screen.getByTestId('tactics-commit-status');
            expect(waiting).toHaveAttribute('data-state', 'waiting');
            expect(waiting).toHaveTextContent('Waiting for other player(s)');

            rerender(
                <TacticsGameHud
                    {...makeHudProps({ snapshot: makeCommitmentSnapshot({ p1: true, p2: true }) })}
                />,
            );
            // All committed → the message clears (the host auto-reveals and starts a fresh turn).
            expect(screen.queryByTestId('tactics-commit-status')).toBeNull();
        });

        it('shows OPTIMISTIC stamina that decrements per buffered action', () => {
            const { rerender } = render(
                <TacticsGameHud {...makeHudProps({ snapshot: makeCommitmentSnapshot() })} />,
            );
            // Empty buffer → full stamina.
            expect(screen.getByTestId('hud-stamina')).toHaveTextContent('3/3');

            useCommitmentBuffer.setState({ buffer: [BUFFERED_MOVE] });
            rerender(<TacticsGameHud {...makeHudProps({ snapshot: makeCommitmentSnapshot() })} />);
            // One buffered move spent → 2/3.
            expect(screen.getByTestId('hud-stamina')).toHaveTextContent('2/3');
        });
    });
});

describe('save button (#825)', () => {
    it('renders no save affordance when the saveGame capability is absent', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        expect(screen.queryByTestId('hud-save-btn')).not.toBeInTheDocument();
    });

    it('renders the save trigger in the actions row after End Turn when saveGame is present', () => {
        render(<TacticsGameHud {...makeHudProps({ saveGame: vi.fn() })} />);

        const trigger = screen.getByTestId('hud-save-btn');
        expect(screen.getByLabelText('Tactics actions')).toContainElement(trigger);

        const endTurn = screen.getByTestId('end-turn');
        expect(
            endTurn.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('renders the save trigger as a borderless icon button carrying the engine save glyph', () => {
        render(<TacticsGameHud {...makeHudProps({ saveGame: vi.fn() })} />);

        // Icon-trigger SaveGameButton: same name dialog, but the strip shows a
        // ghost glyph instead of a bordered text button.
        const trigger = screen.getByTestId('hud-save-btn');
        expect(trigger).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
        expect(trigger.querySelector('svg[data-ch-icon="save"]')).not.toBeNull();
        expect(trigger).toHaveAccessibleName('Save');
        expect(trigger).not.toHaveTextContent('Save');
    });

    it('invokes saveGame with the confirmed name exactly once and closes the dialog', () => {
        const saveGame = vi.fn();
        render(<TacticsGameHud {...makeHudProps({ saveGame })} />);

        fireEvent.click(screen.getByTestId('hud-save-btn'));
        fireEvent.change(screen.getByTestId('save-name-input'), { target: { value: 'name' } });
        fireEvent.click(screen.getByTestId('save-name-confirm'));

        expect(saveGame).toHaveBeenCalledTimes(1);
        expect(saveGame).toHaveBeenCalledWith('name');
        expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
    });

    it('disables the save trigger while the commitment buffer holds unsent moves', () => {
        // A save captured now would miss the buffered-but-uncommitted moves.
        useCommitmentBuffer.setState({ buffer: [BUFFERED_MOVE] });

        render(
            <TacticsGameHud
                {...makeHudProps({ saveGame: vi.fn(), snapshot: makeCommitmentSnapshot() })}
            />,
        );

        expect(screen.getByTestId('hud-save-btn')).toBeDisabled();
    });

    it('keeps the save trigger enabled once the buffer is empty', () => {
        render(
            <TacticsGameHud
                {...makeHudProps({ saveGame: vi.fn(), snapshot: makeCommitmentSnapshot() })}
            />,
        );

        expect(screen.getByTestId('hud-save-btn')).toBeEnabled();
    });
});
