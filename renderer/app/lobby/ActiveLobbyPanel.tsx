'use client';

import React from 'react';
import type { LobbyState, PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { PlayerList } from '../../components/shell/PlayerList';
import { Heading } from '../../components/ui/Heading';
import { LOBBY_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import type { PendingAction } from './lobbyTypes';
import styles from './page.module.css';

// Leave/Start are NOT rendered here — they are the lobby page Modal's footer
// actions, so they align with every other modal's button row.
export interface ActiveLobbyPanelProps {
    readonly lobbyState: LobbyState;
    readonly localPlayerId: PlayerId | null;
    readonly pendingAction: PendingAction;
    readonly onToggleReady: (ready: boolean) => Promise<void>;
}

export function ActiveLobbyPanel({
    lobbyState,
    localPlayerId,
    pendingAction,
    onToggleReady,
}: ActiveLobbyPanelProps): React.ReactElement {
    const t = useTranslate();
    const readyCount = lobbyState.players.filter((player) => player.ready).length;

    return (
        <div className={styles['active-lobby']} data-testid="active-lobby-panel">
            <section className={styles['session-panel']}>
                <div className={styles['section-heading-row']}>
                    <Heading level={2} size="lg">
                        {t(LOBBY_KEYS.sessionHeading)}
                    </Heading>
                </div>
                <dl className={styles['session-details']}>
                    <div className={styles['detail-row']}>
                        <dt>{t(LOBBY_KEYS.sessionIdLabel)}</dt>
                        <dd>
                            <span data-testid="lobby-session-id">{lobbyState.info.sessionId}</span>
                        </dd>
                    </div>
                    <div className={styles['detail-row']}>
                        <dt>{t(LOBBY_KEYS.hostIdLabel)}</dt>
                        <dd>{lobbyState.info.hostId}</dd>
                    </div>
                    <div className={styles['detail-row']}>
                        <dt>{t(LOBBY_KEYS.gameLabel)}</dt>
                        <dd>{lobbyState.info.gameId}</dd>
                    </div>
                    <div className={styles['detail-row']}>
                        <dt>{t(LOBBY_KEYS.readyLabel)}</dt>
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
        </div>
    );
}
