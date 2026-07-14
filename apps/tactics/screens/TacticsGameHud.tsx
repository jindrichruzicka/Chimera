'use client';

import React, { useState } from 'react';
import type { GameHudProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    Badge,
    Button,
    Caption,
    Divider,
    Drawer,
    Icon,
    IconButton,
    Panel,
    SaveGameButton,
    type BadgeVariant,
} from '@chimera-engine/renderer/components/ui';
import { ChatPanel } from '@chimera-engine/renderer/components/chat';
import { CHAT_KEYS, useTranslate, type TranslateFn } from '@chimera-engine/renderer/i18n';
import {
    TACTICS_COMMIT_ACTION,
    readTacticsTurnMode,
} from '@chimera-engine/tactics/simulation/constants.js';
import { HUD_KEYS } from '../shell/translations/keys.js';
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
    const t = useTranslate();
    const turnStatus = resolveTacticsTurnStatus(snapshot.isMyTurn, t);
    const chatTitle = t(CHAT_KEYS.title);
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
            <footer aria-label={t(HUD_KEYS.hudAriaLabel)} className={styles['hud']}>
                <Panel className={styles['panel']} data-testid="tactics-hud-panel" variant="raised">
                    <div className={styles['body']}>
                        <div className={styles['status']}>
                            <Badge
                                className={styles['badge']}
                                data-testid="tactics-turn-status"
                                variant={turnStatus.variant}
                            >
                                {turnStatus.label}
                            </Badge>
                            <div className={styles['tick-group']}>
                                <Caption className={styles['label']} tone="muted">
                                    {t(HUD_KEYS.tick)}
                                </Caption>
                                <output className={styles['tick']} data-testid="hud-tick">
                                    {tick}
                                </output>
                            </div>
                            {/* Local player's remaining stamina (current/max). Shown while
                                it is their turn; dimmed (not hidden) otherwise so the HUD
                                layout stays stable and the value remains readable. Absent
                                entirely when the projection carries no stamina. */}
                            {stamina !== null && (
                                <div
                                    className={styles['stamina-group']}
                                    data-dimmed={snapshot.isMyTurn ? undefined : 'true'}
                                    data-testid="hud-stamina-group"
                                >
                                    <Caption className={styles['label']} tone="muted">
                                        {t(HUD_KEYS.stamina)}
                                    </Caption>
                                    <output className={styles['tick']} data-testid="hud-stamina">
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
                                    {t(HUD_KEYS.waitingForCommitments)}
                                </span>
                            )}
                        </div>
                        <Divider
                            className={styles['divider']}
                            data-testid="tactics-hud-divider"
                            orientation="vertical"
                        />
                        <div
                            aria-label={t(HUD_KEYS.actionsAriaLabel)}
                            className={styles['actions']}
                        >
                            <Button
                                className={styles['action-button']}
                                data-testid="undo"
                                disabled={resolvedUndoDisabled}
                                onClick={resolvedHandleUndo}
                                size="sm"
                                variant="secondary"
                            >
                                {t(HUD_KEYS.undo)}
                            </Button>
                            {!isCommitment && (
                                <Button
                                    className={styles['action-button']}
                                    data-testid="redo"
                                    disabled={redoDisabled}
                                    onClick={handleRedo}
                                    size="sm"
                                    variant="secondary"
                                >
                                    {t(HUD_KEYS.redo)}
                                </Button>
                            )}
                            <Button
                                className={styles['action-button']}
                                data-testid="end-turn"
                                disabled={resolvedEndTurnDisabled}
                                onClick={resolvedHandleEndTurn}
                                size="sm"
                                variant="primary"
                            >
                                {t(HUD_KEYS.endTurn)}
                            </Button>
                            {/* Host-only save: the shell withholds saveGame
                                from clients, so presence IS the gate. Disabled while
                                the commitment buffer holds unsent moves — a save
                                captured now would miss them. SaveGameButton styles
                                its trigger only through the `style` prop, so the
                                compact values ride an inline constant here. */}
                            {saveGame !== undefined && (
                                <SaveGameButton
                                    data-testid="hud-save-btn"
                                    disabled={buffer.length > 0}
                                    onSave={saveGame}
                                    style={compactSaveButtonStyle}
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
            <div className={styles['chat-dock']} data-testid="tactics-chat-dock">
                {/* Icon-only toggle: the chat-bubble glyph replaces the former
                    "Chat"/"Hide chat" label, which now supplies the accessible
                    name via aria-label (the decorative Icon carries none). Ghost
                    (borderless) chrome so the glyph floats over the board. */}
                <IconButton
                    aria-controls={chatOpen ? TACTICS_CHAT_DRAWER_ID : undefined}
                    aria-expanded={chatOpen}
                    aria-label={chatOpen ? t(HUD_KEYS.hideChat) : t(HUD_KEYS.chat)}
                    data-testid="tactics-chat-toggle"
                    onClick={() => {
                        setChatOpen((open) => !open);
                    }}
                    variant="ghost"
                >
                    <Icon name="chat-bubble" />
                </IconButton>
            </div>
            <Drawer
                data-testid="tactics-chat-drawer"
                hideTitle
                id={TACTICS_CHAT_DRAWER_ID}
                onClose={() => {
                    setChatOpen(false);
                }}
                open={chatOpen}
                placement="right"
                title={chatTitle}
            >
                {/* hideTitle: no visible caption bar, but chatTitle still names
                    the dialog for assistive tech (via aria-labelledby). It falls
                    back to t(engine.chat.title), which the Tactics bundle re-keys
                    ('Match chat' / 'Zápasový chat'); the panel's own accessible
                    name reads the same token, keeping the two in sync. */}
                <ChatPanel />
            </Drawer>
        </>
    );
}

const TACTICS_CHAT_DRAWER_ID = 'tactics-chat-drawer';

function resolveTacticsTurnStatus(isMyTurn: boolean, t: TranslateFn): TacticsTurnStatus {
    if (isMyTurn) {
        return { label: t(HUD_KEYS.turnYours), variant: 'success' };
    }

    return { label: t(HUD_KEYS.turnWaiting), variant: 'warning' };
}

// Mirrors the module's `.action-button` compact values for the one control
// whose only styling seam is the `style` prop.
const compactSaveButtonStyle: CompactButtonStyle = {
    '--ch-button-font-size': 'var(--ch-font-size-sm)',
    '--ch-button-line-height': 'var(--ch-line-height-tight)',
    '--ch-button-min-width': 'auto',
    '--ch-button-padding': 'var(--ch-space-xs) var(--ch-space-sm)',
    marginBlock: 'var(--ch-space-xs)',
};

export default TacticsGameHud;
