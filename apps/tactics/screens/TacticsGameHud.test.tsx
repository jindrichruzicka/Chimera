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
import { EscapeStackProvider } from '@chimera-engine/renderer/components/ui';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import { tacticsGridCoordinate } from '../simulation/actions.js';
import type { BufferedTacticsAction } from '../simulation/commitment/contract.js';
import { tacticsBundleCs } from '../shell/translations/cs.js';
import { tacticsBundleEn } from '../shell/translations/en.js';
import { TacticsGameHud } from './TacticsGameHud';
import { useCommitmentBuffer } from './useCommitmentBuffer';

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
            <EscapeStackProvider>{children}</EscapeStackProvider>
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
        expect(screen.getByTestId('hud-tick').textContent).toBe('12');
        expect(screen.getByTestId('undo')).toBeTruthy();
        expect(screen.getByTestId('redo')).toBeTruthy();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
    });

    it('renders the HUD in Czech when the Czech bundle is active', () => {
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

        expect(screen.getByTestId('end-turn')).toHaveTextContent('Ukončit tah');
        expect(screen.getByTestId('undo')).toHaveTextContent('Zpět');
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

    it('renders engine controls with shared UI button primitives', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        expect(screen.getByTestId('undo')).toHaveAttribute('data-ch-button-variant', 'secondary');
        expect(screen.getByTestId('redo')).toHaveAttribute('data-ch-button-variant', 'secondary');
        expect(screen.getByTestId('end-turn')).toHaveAttribute('data-ch-button-variant', 'primary');
    });

    it('presents turn status through shared panel and badge primitives', () => {
        render(<TacticsGameHud {...makeHudProps()} />);

        expect(screen.getByTestId('tactics-hud-panel')).toHaveAttribute(
            'data-ch-panel-variant',
            'raised',
        );
        expect(screen.getByTestId('tactics-turn-status')).toHaveAttribute(
            'data-ch-badge-variant',
            'success',
        );
        expect(screen.getByTestId('tactics-turn-status')).toHaveTextContent('Your turn');
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

        expect(screen.getByTestId('tactics-turn-status')).toHaveAttribute(
            'data-ch-badge-variant',
            'warning',
        );
        expect(screen.getByTestId('tactics-turn-status')).toHaveTextContent('Waiting');
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
