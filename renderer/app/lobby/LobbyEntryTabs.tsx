'use client';

import React from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { TextInput } from '../../components/ui/TextInput';
import type { LobbyConfig } from './lobbyConfig';
import type { LobbyEntryTabId } from './lobbyTypes';
import styles from './page.module.css';

export interface LobbyEntryTabsProps {
    readonly activeTabId: LobbyEntryTabId;
    readonly config: LobbyConfig;
    readonly lobbyCode: string;
    readonly onLobbyCodeChange: (value: string) => void;
    readonly onTabChange: (tabId: LobbyEntryTabId) => void;
}

export function LobbyEntryTabs({
    activeTabId,
    config,
    lobbyCode,
    onLobbyCodeChange,
    onTabChange,
}: LobbyEntryTabsProps): React.ReactElement {
    return (
        <Tabs
            activeTabId={activeTabId}
            ariaLabel="Lobby entry mode"
            data-testid="lobby-entry-tabs"
            onActiveTabChange={(tabId) => {
                if (tabId === 'host' || tabId === 'join') {
                    onTabChange(tabId);
                }
            }}
            tabs={[
                {
                    id: 'host',
                    label: 'Host',
                    panel: (
                        <div className={styles['entry-panel']}>
                            <dl className={styles['compact-details']}>
                                <div className={styles['detail-row']}>
                                    <dt>Game</dt>
                                    <dd>{config.gameId}</dd>
                                </div>
                                <div className={styles['detail-row']}>
                                    <dt>Seats</dt>
                                    <dd>{config.maxPlayers}</dd>
                                </div>
                            </dl>
                        </div>
                    ),
                },
                {
                    id: 'join',
                    label: 'Join',
                    panel: (
                        <div className={styles['entry-panel']}>
                            <TextInput
                                autoComplete="off"
                                data-testid="address-input"
                                id="lobby-code-input"
                                label="Lobby Code:"
                                onValueChange={onLobbyCodeChange}
                                placeholder="127.0.0.1:7777"
                                value={lobbyCode}
                            />
                        </div>
                    ),
                    testId: 'join-lobby',
                },
            ]}
        />
    );
}
