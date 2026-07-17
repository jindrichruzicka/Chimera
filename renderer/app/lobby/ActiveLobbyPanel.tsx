'use client';

import React from 'react';
import type { LobbyState, PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { PlayerList } from '../../components/shell/PlayerList';
import { Heading } from '../../components/ui/Heading';
import { IconButton } from '../../components/ui/IconButton';
import { Icon } from '../../components/ui/icons/Icon';
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

/**
 * Copy the session ID to the clipboard so the host can paste it to the other
 * players. The optional chain keeps the call a no-op where
 * `navigator.clipboard` is absent (e.g. jsdom).
 */
function copySessionId(value: string): void {
    void navigator.clipboard?.writeText(value);
}

export function ActiveLobbyPanel({
    lobbyState,
    localPlayerId,
    pendingAction,
    onToggleReady,
}: ActiveLobbyPanelProps): React.ReactElement {
    const t = useTranslate();

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
                            <span className={styles['session-code-row']}>
                                <code
                                    className={styles['session-code']}
                                    data-testid="lobby-session-id"
                                >
                                    {lobbyState.info.sessionId}
                                </code>
                                <IconButton
                                    aria-label={t(LOBBY_KEYS.copySessionAriaLabel)}
                                    data-testid="lobby-session-copy"
                                    onClick={() => {
                                        copySessionId(lobbyState.info.sessionId);
                                    }}
                                    variant="ghost"
                                >
                                    <Icon name="copy" />
                                </IconButton>
                            </span>
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
