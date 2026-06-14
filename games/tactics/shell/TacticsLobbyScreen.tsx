'use client';

/**
 * games/tactics/shell/TacticsLobbyScreen.tsx
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
 * palette comes from this game's own pure `lobby/lobby-setup.ts`.
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 * Task: #708 (T6, part of #702 — Customizable Lobby)
 */

import React from 'react';
import {
    Badge,
    Button,
    Heading,
    Select,
    ToggleButton,
} from '@chimera/renderer/components/ui/index.js';
import type { GameLobbyScreenProps } from '@chimera/shared/game-lobby-contract.js';
import {
    DEFAULT_BOARD_COLOR,
    DEFAULT_PLAYER_COLOR,
    TACTICS_BOARD_COLORS,
    TACTICS_PLAYER_COLORS,
    TACTICS_PLAYER_COLOR_HEX,
} from '../lobby/lobby-setup.js';
import styles from './TacticsLobbyScreen.module.css';

export function TacticsLobbyScreen({
    lobbyState,
    localPlayerId,
    isHost,
    canStartGame,
    pendingAction,
    setMatchSetting,
    setPlayerAttribute,
    onToggleReady,
    onStartGame,
    onLeave,
}: GameLobbyScreenProps): React.ReactElement {
    const readyCount = lobbyState.players.filter((player) => player.ready).length;
    const boardColor = lobbyState.matchSettings?.['boardColor'] ?? DEFAULT_BOARD_COLOR;

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
                <Select
                    className={styles['board-color-select']}
                    data-testid="tactics-board-color-select"
                    disabled={!isHost}
                    label="Board colour"
                    onValueChange={(value) => {
                        setMatchSetting('boardColor', value);
                    }}
                    options={TACTICS_BOARD_COLORS}
                    value={boardColor}
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
                                    style={{ backgroundColor: TACTICS_PLAYER_COLOR_HEX[color] }}
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
                                    options={TACTICS_PLAYER_COLORS}
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
