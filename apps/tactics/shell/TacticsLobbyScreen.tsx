'use client';

/**
 * apps/tactics/shell/TacticsLobbyScreen.tsx
 *
 * Tactics' custom lobby screen (§4.37). Registry-loaded into
 * `LoadedRendererGameShell.LobbyScreen`, it replaces the engine-default
 * `ActiveLobbyPanel` when a Tactics lobby is hosted, so it renders the full
 * panel — roster, ready toggle, and Leave/Start — plus the Tactics-specific
 * board-colour and per-player colour controls.
 *
 * Authority split (F53): the board-colour select is host-authored — editable
 * only for the host (a client sees it `disabled`) and routed through
 * `setMatchSetting`. Each per-player colour select is owner-authored — editable
 * only on the local player's OWN row (every other seat is `disabled`) and routed
 * through `setPlayerAttribute`, which `main` accepts only for the caller's own
 * seat (#706). The screen performs no privileged writes itself.
 *
 * Module boundary (§3 / Invariant #96): game shell components import the shared
 * component library only through the public `components/ui` barrel; the colour
 * palette is interpreted from the generic `content` prop (loaded from the content
 * database) by this game's own `content/tacticsContent.ts`.
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 * Task: #708 (T6, part of #702 — Customizable Lobby)
 */

import React from 'react';
import {
    Badge,
    Button,
    Heading,
    IconButton,
    Select,
    Toggle,
    ToggleButton,
} from '@chimera/renderer/components/ui';
import type { GameLobbyScreenProps } from '@chimera/simulation/foundation/game-lobby-contract.js';
import { readTacticsTurnMode, TACTICS_TURN_MODE_SETTING } from '@chimera/tactics/constants.js';
import {
    DEFAULT_BOARD_COLOR,
    DEFAULT_PLAYER_COLOR,
    TACTICS_MAX_PLAYERS,
} from '../lobby/lobby-setup.js';
import { paletteFromCollections } from '../content/tacticsContent.js';
import styles from './TacticsLobbyScreen.module.css';

/**
 * Copy the joinable lobby address to the clipboard so the host can paste it to
 * the other player. Mirrors `NetworkPanel`'s copy affordance; the optional chain
 * keeps the call a no-op where `navigator.clipboard` is absent (e.g. jsdom).
 */
function copyLobbyAddress(value: string): void {
    void navigator.clipboard?.writeText(value);
}

export function TacticsLobbyScreen({
    lobbyState,
    localPlayerId,
    content,
    isHost,
    canStartGame,
    pendingAction,
    setMatchSetting,
    setPlayerAttribute,
    addAiPlayer,
    removeAiPlayer,
    onToggleReady,
    onStartGame,
    onLeave,
}: GameLobbyScreenProps): React.ReactElement {
    // The selectable colours come from the content database (delivered as the
    // generic `content` prop); interpret them into this game's palette. Empty
    // until content loads, so the Selects fall back to the seeded default names.
    const palette = paletteFromCollections(content ?? {});
    const readyCount = lobbyState.players.filter((player) => player.ready).length;
    const boardColor = lobbyState.matchSettings?.['boardColor'] ?? DEFAULT_BOARD_COLOR;
    // Commitment battle mode is a host-authored synced match setting (T7, #727):
    // the toggle writes the shared `turnMode` key, off (`sequential`) by default,
    // and rides `snapshot.setup` into the match for T8 to read.
    const commitmentEnabled = readTacticsTurnMode(lobbyState.matchSettings) === 'commitment';
    // AI agent slots come synced in the lobby state (F54 T4). The lobby is "full"
    // on total occupancy — humans + AI together against maxPlayers — matching the
    // host's auto-remove-on-overflow rule (#724). The AI section renders for the
    // host (to add/remove) or whenever any AI slot exists (read-only for clients).
    const agentSlots = lobbyState.agentSlots ?? [];
    const isFull = lobbyState.players.length + agentSlots.length >= TACTICS_MAX_PLAYERS;
    const showAiSection = isHost || agentSlots.length > 0;

    // Gate the host AI controls while an add/remove round-trip is in flight so a
    // rapid double-click cannot fire two `addAi`/`removeAi` invocations from one
    // gesture. The synced state arrives via the lobby update, so we clear the
    // flag when the round-trip settles (#724, review WARN-2).
    const [aiActionPending, setAiActionPending] = React.useState(false);
    const runAiAction = (action: () => Promise<void>): void => {
        setAiActionPending(true);
        void action().finally(() => {
            setAiActionPending(false);
        });
    };

    return (
        <div className={styles['lobby']} data-testid="tactics-lobby-screen">
            <section className={styles['panel']}>
                <div className={styles['heading-row']}>
                    <Heading level={2} size="lg">
                        Battle Setup
                    </Heading>
                    <Badge variant={isHost ? 'success' : 'neutral'}>
                        {isHost ? 'Host' : 'Player'}
                    </Badge>
                </div>
                {isHost ? (
                    <div className={styles['address']}>
                        <span className={styles['address-label']}>Lobby address</span>
                        <div className={styles['address-row']}>
                            <code className={styles['address-code']} data-testid="lobby-address">
                                {lobbyState.info.sessionId}
                            </code>
                            <IconButton
                                aria-label="Copy lobby address"
                                data-testid="lobby-address-copy"
                                onClick={() => {
                                    copyLobbyAddress(lobbyState.info.sessionId);
                                }}
                            >
                                ⧉
                            </IconButton>
                        </div>
                    </div>
                ) : null}
                <Select
                    className={styles['board-color-select']}
                    data-testid="tactics-board-color-select"
                    disabled={!isHost}
                    label="Board colour"
                    onValueChange={(value) => {
                        setMatchSetting('boardColor', value);
                    }}
                    options={palette.boardColors}
                    value={boardColor}
                />
                <Toggle
                    checked={commitmentEnabled}
                    data-testid="tactics-commitment-scheme-toggle"
                    disabled={!isHost}
                    label="Simultaneous turns"
                    onCheckedChange={(next) => {
                        setMatchSetting(
                            TACTICS_TURN_MODE_SETTING,
                            next ? 'commitment' : 'sequential',
                        );
                    }}
                />
                <p className={styles['ready-summary']}>
                    Ready: {readyCount}/{lobbyState.players.length}
                </p>
            </section>

            <section className={styles['panel']}>
                <Heading level={3} size="md">
                    Players
                </Heading>
                <ul className={styles['roster']}>
                    {lobbyState.players.map((player) => {
                        const color = player.attributes?.['color'] ?? DEFAULT_PLAYER_COLOR;
                        const isLocal = player.playerId === localPlayerId;
                        return (
                            <li
                                className={styles['roster-row']}
                                data-player-id={player.playerId}
                                data-ready={String(player.ready)}
                                data-testid="tactics-lobby-player"
                                key={player.playerId}
                            >
                                <span
                                    aria-hidden="true"
                                    className={styles['swatch']}
                                    data-testid={`tactics-player-swatch-${player.playerId}`}
                                    style={{ backgroundColor: palette.playerColorHex[color] }}
                                />
                                <span className={styles['player-name']}>
                                    {player.displayName}
                                    {isLocal ? <span className={styles['you']}> (You)</span> : null}
                                </span>
                                <Badge variant={player.ready ? 'success' : 'warning'}>
                                    {player.ready ? 'Ready' : 'Not Ready'}
                                </Badge>
                                <Select
                                    data-testid={`tactics-player-color-select-${player.playerId}`}
                                    disabled={!isLocal}
                                    hideLabel
                                    label={`${player.displayName} colour`}
                                    onValueChange={(value) => {
                                        setPlayerAttribute(player.playerId, 'color', value);
                                    }}
                                    options={palette.playerColors}
                                    value={color}
                                />
                                {isLocal ? (
                                    <ToggleButton
                                        data-testid="tactics-ready-toggle"
                                        disabled={pendingAction === 'updating-ready'}
                                        onPressedChange={(next) => {
                                            void onToggleReady(next);
                                        }}
                                        pressed={player.ready}
                                    >
                                        Ready
                                    </ToggleButton>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            </section>

            {showAiSection ? (
                <section className={styles['panel']}>
                    <div className={styles['heading-row']}>
                        <Heading level={3} size="md">
                            AI Players
                        </Heading>
                        {isHost ? (
                            <IconButton
                                aria-label="Add AI player"
                                data-testid="tactics-add-ai"
                                disabled={isFull || aiActionPending}
                                onClick={() => {
                                    runAiAction(addAiPlayer);
                                }}
                                type="button"
                                variant="secondary"
                            >
                                +
                            </IconButton>
                        ) : null}
                    </div>
                    {agentSlots.length === 0 ? (
                        <p className={styles['ready-summary']}>No AI players added.</p>
                    ) : (
                        <ul className={styles['roster']}>
                            {agentSlots.map((slot) => (
                                <li
                                    className={styles['roster-row']}
                                    data-slot-index={slot.slotIndex}
                                    data-testid="tactics-lobby-ai-player"
                                    key={`ai-${slot.slotIndex}`}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={styles['ai-badge']}
                                        data-testid={`tactics-ai-badge-${slot.slotIndex}`}
                                    >
                                        AI
                                    </span>
                                    <span className={styles['player-name']}>
                                        AI Player {slot.slotIndex}
                                    </span>
                                    {isHost ? (
                                        <IconButton
                                            aria-label={`Remove AI Player ${slot.slotIndex}`}
                                            data-testid={`tactics-remove-ai-${slot.slotIndex}`}
                                            disabled={aiActionPending}
                                            onClick={() => {
                                                runAiAction(() => removeAiPlayer(slot.slotIndex));
                                            }}
                                            type="button"
                                            variant="danger"
                                        >
                                            −
                                        </IconButton>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            ) : null}

            <div className={styles['action-bar']} data-testid="lobby-action-bar">
                <Button
                    aria-describedby="leave-warning"
                    data-testid="lobby-leave-btn"
                    disabled={pendingAction !== null}
                    onClick={() => {
                        void onLeave();
                    }}
                    variant="danger"
                >
                    {pendingAction === 'leaving' ? 'Leaving...' : 'Leave Lobby'}
                </Button>
                <span className={styles['sr-only']} id="leave-warning">
                    This will disconnect you from the current lobby
                </span>
                <Button
                    data-testid="start-game"
                    disabled={!canStartGame || pendingAction !== null}
                    onClick={() => {
                        void onStartGame();
                    }}
                    type="button"
                    variant="primary"
                >
                    {pendingAction === 'starting' ? 'Starting...' : 'Start Game'}
                </Button>
            </div>
        </div>
    );
}
