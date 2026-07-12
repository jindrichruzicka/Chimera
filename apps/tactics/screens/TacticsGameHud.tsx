'use client';

import React, { useState } from 'react';
import type { GameHudProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    Badge,
    Button,
    Caption,
    Divider,
    Drawer,
    Panel,
    SaveGameButton,
    type BadgeVariant,
} from '@chimera-engine/renderer/components/ui';
import { ChatPanel } from '@chimera-engine/renderer/components/chat';
import {
    TACTICS_COMMIT_ACTION,
    readTacticsTurnMode,
} from '@chimera-engine/tactics/simulation/constants.js';
import {
    parseTacticsAllSeatsCommitted,
    parseTacticsSeatCommitted,
    parseTacticsViewerStamina,
} from '../scene/tacticsSceneModel.js';
import { applyBuffer } from '../simulation/commitment/buffer.js';
import { readStamina } from '../simulation/stamina.js';
import {
    selectBuffer,
    selectCommittedLatch,
    toOptimisticBase,
    useCommitmentBuffer,
} from './useCommitmentBuffer.js';
import styles from './TacticsGameHud.module.css';

interface TacticsTurnStatus {
    readonly label: string;
    readonly variant: BadgeVariant;
}

type CompactButtonStyle = React.CSSProperties & {
    readonly '--ch-button-font-size': string;
    readonly '--ch-button-line-height': string;
    readonly '--ch-button-min-width': string;
    readonly '--ch-button-padding': string;
};

export function TacticsGameHud({
    snapshot,
    sendAction,
    tick,
    undoDisabled,
    redoDisabled,
    endTurnDisabled,
    handleUndo,
    handleRedo,
    handleEndTurn,
    saveGame,
}: GameHudProps): React.ReactElement {
    const turnStatus = resolveTacticsTurnStatus(snapshot.isMyTurn);
    const [chatOpen, setChatOpen] = useState<boolean>(false);

    // ── Commitment battle mode ──────────────────────────────────────────────
    // In commitment mode the HUD owns the local buffer loop: a Commit control,
    // Undo that pops the buffer, optimistic stamina, and an End Turn that is the
    // reveal trigger — enabled only once every seat has committed. All commitment
    // logic lives here so the game-agnostic GameShell stays untouched.
    const isCommitment = readTacticsTurnMode(snapshot.setup?.matchSettings) === 'commitment';
    const buffer = useCommitmentBuffer(selectBuffer);
    const committedLatch = useCommitmentBuffer(selectCommittedLatch);
    const undoBuffer = useCommitmentBuffer((state) => state.undo);
    const markCommitted = useCommitmentBuffer((state) => state.markCommitted);

    const localCommitted =
        isCommitment && parseTacticsSeatCommitted(snapshot.players, snapshot.viewerId);
    const hasCommitted = committedLatch || localCommitted;
    const allCommitted = parseTacticsAllSeatsCommitted(snapshot.players);

    // Owner-only stamina projected on the viewer's player state. In commitment
    // mode the projected value lags the un-committed buffer, so compute
    // the OPTIMISTIC remaining stamina from the buffer instead (decrements per
    // buffered move/attack). Null when the projection carries no stamina.
    const stamina =
        isCommitment && !hasCommitted
            ? readStamina(
                  applyBuffer(toOptimisticBase(snapshot), buffer, snapshot.viewerId),
                  snapshot.viewerId,
              )
            : parseTacticsViewerStamina(snapshot.players, snapshot.viewerId);

    const handleCommit = (): void => {
        // In commitment mode End Turn IS the commit: the buffer rides the
        // commit action's payload out-of-band; the reducer strips it (Invariants
        // #3/#8). markCommitted latches the local UI so the board goes inert and
        // End Turn / Undo disable before the snapshot round-trips. Once EVERY seat
        // has committed the host auto-advances + reveals — no second confirmation.
        sendAction({
            type: TACTICS_COMMIT_ACTION,
            playerId: snapshot.viewerId,
            tick: snapshot.tick,
            payload: { actions: buffer },
        });
        markCommitted();
    };

    const resolvedUndoDisabled = isCommitment ? hasCommitted || buffer.length === 0 : undoDisabled;
    const resolvedHandleUndo = isCommitment ? undoBuffer : handleUndo;
    // End Turn is enabled until the viewer commits (the click commits), then
    // disabled while waiting for the other seat(s).
    const resolvedEndTurnDisabled = isCommitment
        ? hasCommitted || snapshot.gameResult !== null || snapshot.phase === 'ended'
        : endTurnDisabled;
    const resolvedHandleEndTurn = isCommitment ? handleCommit : handleEndTurn;
    // The pulsing "waiting" message shows once the viewer has committed and is
    // waiting for the remaining seat(s); it clears automatically when all commit
    // (the host reveals and starts a fresh turn).
    const isWaitingForCommitments = isCommitment && hasCommitted && !allCommitted;

    return (
        <>
            <footer aria-label="Game HUD" style={tacticsHudStyle}>
                <Panel
                    data-testid="tactics-hud-panel"
                    style={tacticsHudPanelStyle}
                    variant="raised"
                >
                    <div style={tacticsHudBodyStyle}>
                        <div style={tacticsHudStatusStyle}>
                            <Badge
                                data-testid="tactics-turn-status"
                                style={tacticsHudBadgeStyle}
                                variant={turnStatus.variant}
                            >
                                {turnStatus.label}
                            </Badge>
                            <div style={tacticsHudTickGroupStyle}>
                                <Caption style={tacticsHudLabelStyle} tone="muted">
                                    Tactics Tick
                                </Caption>
                                <output data-testid="hud-tick" style={tacticsHudTickStyle}>
                                    {tick}
                                </output>
                            </div>
                            {/* Local player's remaining stamina (current/max). Shown while
                                it is their turn; dimmed (not hidden) otherwise so the HUD
                                layout stays stable and the value remains readable. Absent
                                entirely when the projection carries no stamina. */}
                            {stamina !== null && (
                                <div
                                    data-dimmed={snapshot.isMyTurn ? undefined : 'true'}
                                    data-testid="hud-stamina-group"
                                    style={
                                        snapshot.isMyTurn
                                            ? tacticsHudStaminaGroupStyle
                                            : tacticsHudStaminaGroupDimmedStyle
                                    }
                                >
                                    <Caption style={tacticsHudLabelStyle} tone="muted">
                                        Stamina
                                    </Caption>
                                    <output data-testid="hud-stamina" style={tacticsHudTickStyle}>
                                        {stamina.current}/{stamina.max}
                                    </output>
                                </div>
                            )}
                            {isWaitingForCommitments && (
                                <span
                                    className={styles['waiting-message']}
                                    data-state="waiting"
                                    data-testid="tactics-commit-status"
                                >
                                    Waiting for other player(s)…
                                </span>
                            )}
                        </div>
                        <Divider
                            data-testid="tactics-hud-divider"
                            orientation="vertical"
                            style={tacticsHudDividerStyle}
                        />
                        <div aria-label="Tactics actions" style={tacticsHudActionsStyle}>
                            <Button
                                data-testid="undo"
                                disabled={resolvedUndoDisabled}
                                onClick={resolvedHandleUndo}
                                size="sm"
                                style={tacticsHudButtonStyle}
                                variant="secondary"
                            >
                                Undo
                            </Button>
                            {!isCommitment && (
                                <Button
                                    data-testid="redo"
                                    disabled={redoDisabled}
                                    onClick={handleRedo}
                                    size="sm"
                                    style={tacticsHudButtonStyle}
                                    variant="secondary"
                                >
                                    Redo
                                </Button>
                            )}
                            <Button
                                data-testid="end-turn"
                                disabled={resolvedEndTurnDisabled}
                                onClick={resolvedHandleEndTurn}
                                size="sm"
                                style={tacticsHudButtonStyle}
                                variant="primary"
                            >
                                End Turn
                            </Button>
                            {/* Host-only save: the shell withholds saveGame
                                from clients, so presence IS the gate. Disabled while
                                the commitment buffer holds unsent moves — a save
                                captured now would miss them. */}
                            {saveGame !== undefined && (
                                <SaveGameButton
                                    data-testid="hud-save-btn"
                                    disabled={buffer.length > 0}
                                    onSave={saveGame}
                                    style={tacticsHudButtonStyle}
                                />
                            )}
                        </div>
                    </div>
                </Panel>
            </footer>
            {/* In-match chat: the HUD mounts the shared ChatPanel inside the shared
                Drawer primitive, as a sibling of the footer (not nested inside it).
                Collapsed by default so the board stays fully clickable; only the
                corner toggle occupies space until the player opens chat. The toggle
                pins to the bottom-right; opening it slides the dismissible Drawer in.
                Closing the Drawer (toggle, close button, Escape, or backdrop) drives
                the same state, keeping the toggle's expanded affordance in sync. */}
            <div data-testid="tactics-chat-dock" style={tacticsHudChatDockStyle}>
                <Button
                    aria-controls={chatOpen ? TACTICS_CHAT_DRAWER_ID : undefined}
                    aria-expanded={chatOpen}
                    data-testid="tactics-chat-toggle"
                    onClick={() => {
                        setChatOpen((open) => !open);
                    }}
                    size="sm"
                    style={tacticsHudButtonStyle}
                    variant="secondary"
                >
                    {chatOpen ? 'Hide chat' : 'Chat'}
                </Button>
            </div>
            <Drawer
                data-testid="tactics-chat-drawer"
                id={TACTICS_CHAT_DRAWER_ID}
                onClose={() => {
                    setChatOpen(false);
                }}
                open={chatOpen}
                placement="right"
                title={TACTICS_CHAT_TITLE}
            >
                <ChatPanel title={TACTICS_CHAT_TITLE} />
            </Drawer>
        </>
    );
}

const TACTICS_CHAT_DRAWER_ID = 'tactics-chat-drawer';

/** Caption for the in-match chat: the visible Drawer title and the ChatPanel's
 *  accessible label, kept in sync from a single source. */
const TACTICS_CHAT_TITLE = 'Match chat';

function resolveTacticsTurnStatus(isMyTurn: boolean): TacticsTurnStatus {
    if (isMyTurn) {
        return { label: 'Your turn', variant: 'success' };
    }

    return { label: 'Waiting', variant: 'warning' };
}

const tacticsHudStyle: React.CSSProperties = {
    fontFamily: 'var(--ch-font-ui)',
};

const tacticsHudPanelStyle: React.CSSProperties = {
    padding: '0 var(--ch-space-sm)',
};

const tacticsHudBodyStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--ch-space-md)',
};

const tacticsHudStatusStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--ch-space-sm)',
    minWidth: 'max-content',
};

const tacticsHudBadgeStyle: React.CSSProperties = {
    padding: '0 var(--ch-space-sm)',
};

const tacticsHudTickGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--ch-space-xs)',
};

const tacticsHudStaminaGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--ch-space-xs)',
};

const tacticsHudStaminaGroupDimmedStyle: React.CSSProperties = {
    ...tacticsHudStaminaGroupStyle,
    opacity: 'var(--ch-opacity-disabled)',
};

const tacticsHudLabelStyle: React.CSSProperties = {
    lineHeight: 'var(--ch-line-height-tight)',
};

const tacticsHudTickStyle: React.CSSProperties = {
    color: 'var(--ch-color-text-primary)',
    fontSize: 'var(--ch-font-size-md)',
    fontWeight: 700,
};

const tacticsHudDividerStyle: React.CSSProperties = {
    alignSelf: 'center',
    minHeight: 'var(--ch-space-lg)',
};

const tacticsHudActionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--ch-space-xs)',
};

const tacticsHudButtonStyle: CompactButtonStyle = {
    '--ch-button-font-size': 'var(--ch-font-size-sm)',
    '--ch-button-line-height': 'var(--ch-line-height-tight)',
    '--ch-button-min-width': 'auto',
    '--ch-button-padding': 'var(--ch-space-xs) var(--ch-space-sm)',
    marginBlock: 'var(--ch-space-xs)',
};

// A fixed dock on the trailing edge, kept clear of the HUD footer. The toggle
// owns its own placement so the engine shell stays agnostic and the board stays
// fully clickable while chat is collapsed. The shared Drawer owns the expanded
// chat surface's sizing and overlay, so the dock only anchors the corner toggle.
const tacticsHudChatDockStyle: React.CSSProperties = {
    position: 'fixed',
    insetInlineEnd: 'var(--ch-space-md)',
    insetBlockEnd: 'calc(var(--ch-space-xl) * 2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 'var(--ch-space-xs)',
    zIndex: 1,
};

export default TacticsGameHud;
