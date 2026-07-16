'use client';

import React, { useState } from 'react';
import type { GameHudProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    Button,
    Divider,
    Drawer,
    Icon,
    IconButton,
    Panel,
    SaveGameButton,
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

/** The turn lamp's state — drives the dot/label colour via `data-state`. */
type TacticsTurnState = 'yours' | 'waiting';

interface TacticsTurnStatus {
    readonly label: string;
    readonly state: TacticsTurnState;
}

export function TacticsGameHud({
    snapshot,
    sendAction,
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
                {/* A compact, centered command bar rather than a full-width footer:
                    three tight clusters (identity · readouts · actions) divided by
                    rules, so the HUD reads as one small island above the board. */}
                <Panel className={styles['panel']} data-testid="tactics-hud-panel" variant="raised">
                    <div className={styles['body']}>
                        <div className={styles['cluster']}>
                            {/* Game-contributed brand glyph, resolved through the
                                engine <Icon> via the app-wide <IconProvider>
                                (shell.icons seam). Decorative (aria-hidden) — pure
                                branding, so it carries no user-facing string —
                                proving a game's own icon renders with the engine's
                                currentColor + token sizing, exactly like a built-in. */}
                            <Icon
                                data-testid="tactics-hud-emblem"
                                name="game.tactics.banner"
                                {...(styles['emblem'] === undefined
                                    ? {}
                                    : { className: styles['emblem'] })}
                            />
                            {/* Chrome-less turn lamp: a state-coloured dot + label
                                instead of a bordered Badge chip, so the identity
                                cluster reads as a game readout, not a widget. The
                                dot and colour ride ::before + data-state in CSS. */}
                            <span
                                className={styles['turn-status']}
                                data-state={turnStatus.state}
                                data-testid="tactics-turn-status"
                            >
                                {turnStatus.label}
                            </span>
                        </div>

                        {/* The engine tick is deliberately not surfaced: it is
                            simulation plumbing, not player-facing information.
                            (Turn state is conveyed by the identity lamp above.) */}
                        {(stamina !== null || isWaitingForCommitments) && (
                            <>
                                <Divider
                                    className={styles['divider']}
                                    data-testid="tactics-hud-divider"
                                    orientation="vertical"
                                />

                                <div className={styles['cluster']}>
                                    {/* Local player's remaining stamina (current/max). Shown
                                        while it is their turn; dimmed (not hidden) otherwise so
                                        the HUD layout stays stable and the value remains
                                        readable. Absent entirely when the projection carries no
                                        stamina — the whole cluster (and its divider) drops with
                                        it so two rules never sit adjacent. The game-contributed
                                        lightning glyph names the stat (title → role="img"), so
                                        the bare number needs no text label. */}
                                    {stamina !== null && (
                                        <div
                                            className={styles['stamina-group']}
                                            data-dimmed={snapshot.isMyTurn ? undefined : 'true'}
                                            data-testid="hud-stamina-group"
                                        >
                                            <Icon
                                                name="game.tactics.stamina"
                                                title={t(HUD_KEYS.stamina)}
                                                {...(styles['stat-icon'] === undefined
                                                    ? {}
                                                    : { className: styles['stat-icon'] })}
                                            />
                                            <output
                                                className={styles['tick']}
                                                data-testid="hud-stamina"
                                            >
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
                            </>
                        )}

                        <Divider className={styles['divider']} orientation="vertical" />

                        <div
                            aria-label={t(HUD_KEYS.actionsAriaLabel)}
                            className={styles['actions']}
                        >
                            {/* Undo/Redo are borderless (ghost) icon buttons — the
                                game-contributed curved-arrow glyphs, named by
                                aria-label + a hover title, so End Turn stays the only
                                filled control and the strip keeps a game-HUD feel. */}
                            <IconButton
                                aria-label={t(HUD_KEYS.undo)}
                                data-testid="undo"
                                disabled={resolvedUndoDisabled}
                                onClick={resolvedHandleUndo}
                                title={t(HUD_KEYS.undo)}
                                variant="ghost"
                            >
                                <Icon name="game.tactics.undo" />
                            </IconButton>
                            {!isCommitment && (
                                <IconButton
                                    aria-label={t(HUD_KEYS.redo)}
                                    data-testid="redo"
                                    disabled={redoDisabled}
                                    onClick={handleRedo}
                                    title={t(HUD_KEYS.redo)}
                                    variant="ghost"
                                >
                                    <Icon name="game.tactics.redo" />
                                </IconButton>
                            )}
                            <Button
                                className={styles['end-turn']}
                                data-testid="end-turn"
                                disabled={resolvedEndTurnDisabled}
                                onClick={resolvedHandleEndTurn}
                                size="sm"
                                variant="primary"
                            >
                                <Icon name="game.tactics.end-turn" />
                                {t(HUD_KEYS.endTurn)}
                            </Button>
                            {/* Host-only save: the shell withholds saveGame
                                from clients, so presence IS the gate. Disabled while
                                the commitment buffer holds unsent moves — a save
                                captured now would miss them. The icon trigger keeps
                                the strip borderless (ghost save glyph + name dialog). */}
                            {saveGame !== undefined && (
                                <SaveGameButton
                                    data-testid="hud-save-btn"
                                    disabled={buffer.length > 0}
                                    onSave={saveGame}
                                    trigger="icon"
                                />
                            )}
                        </div>
                    </div>
                </Panel>
                {/* In-match chat toggle: docked INSIDE the footer row at its
                    trailing edge, so the bubble sits on the command bar's own
                    centre line instead of free-floating over the board. Chat
                    stays collapsed by default; opening it slides the shared
                    dismissible Drawer in (a sibling of this footer). Closing the
                    Drawer (toggle, close button, Escape, or backdrop) drives the
                    same state, keeping the toggle's expanded affordance in sync. */}
                <div className={styles['chat-dock']} data-testid="tactics-chat-dock">
                    {/* Icon-only toggle: the chat-bubble glyph, named for
                        assistive tech via aria-label (the decorative Icon
                        carries none). Ghost (borderless) chrome to match the
                        strip's icon actions. */}
                    <IconButton
                        aria-controls={chatOpen ? TACTICS_CHAT_DRAWER_ID : undefined}
                        aria-expanded={chatOpen}
                        aria-label={chatOpen ? t(HUD_KEYS.hideChat) : t(HUD_KEYS.chat)}
                        data-testid="tactics-chat-toggle"
                        onClick={() => {
                            setChatOpen((open) => !open);
                        }}
                        title={chatOpen ? t(HUD_KEYS.hideChat) : t(HUD_KEYS.chat)}
                        variant="ghost"
                    >
                        <Icon name="chat-bubble" />
                    </IconButton>
                </div>
            </footer>
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
        return { label: t(HUD_KEYS.turnYours), state: 'yours' };
    }

    return { label: t(HUD_KEYS.turnWaiting), state: 'waiting' };
}

export default TacticsGameHud;
