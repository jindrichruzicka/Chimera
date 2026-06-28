'use client';

import React from 'react';
import type { LobbyState, PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { PlayerList } from '../../components/shell/PlayerList';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import type { PendingAction } from './lobbyTypes';
import styles from './page.module.css';

export interface ActiveLobbyPanelProps {
    readonly canStartGame: boolean;
    readonly lobbyState: LobbyState;
    readonly localPlayerId: PlayerId | null;
    readonly pendingAction: PendingAction;
    readonly onLeave: () => Promise<void>;
    readonly onStartGame: () => Promise<void>;
    readonly onToggleReady: (ready: boolean) => Promise<void>;
}

export function ActiveLobbyPanel({
    canStartGame,
    lobbyState,
    localPlayerId,
    pendingAction,
    onLeave,
    onStartGame,
    onToggleReady,
}: ActiveLobbyPanelProps): React.ReactElement {
    const isHost = localPlayerId !== null && localPlayerId === lobbyState.info.hostId;
    const readyCount = lobbyState.players.filter((player) => player.ready).length;

    return (
        <div className={styles['active-lobby']} data-testid="active-lobby-panel">
            <section className={styles['session-panel']}>
                <div className={styles['section-heading-row']}>
                    <Heading level={2} size="lg">
                        Session
                    </Heading>
                    <Badge variant={isHost ? 'success' : 'neutral'}>
                        {isHost ? 'Host' : 'Player'}
                    </Badge>
                </div>
                <dl className={styles['session-details']}>
                    <div className={styles['detail-row']}>
                        <dt>Session ID:</dt>
                        <dd>
                            <span data-testid="lobby-session-id">{lobbyState.info.sessionId}</span>
                        </dd>
                    </div>
                    <div className={styles['detail-row']}>
                        <dt>Host ID:</dt>
                        <dd>{lobbyState.info.hostId}</dd>
                    </div>
                    <div className={styles['detail-row']}>
                        <dt>Game:</dt>
                        <dd>{lobbyState.info.gameId}</dd>
                    </div>
                    <div className={styles['detail-row']}>
                        <dt>Ready:</dt>
                        <dd>
                            {readyCount}/{lobbyState.players.length}
                        </dd>
                    </div>
                </dl>
            </section>

            <section className={styles['session-panel']}>
                <PlayerList
                    isTogglePending={pendingAction === 'updating-ready'}
                    localPlayerId={localPlayerId}
                    onToggleReady={onToggleReady}
                />
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
