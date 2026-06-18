'use client';

import React from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { TextInput } from '../../components/ui/TextInput';
import type { LobbyEntryTabId } from './lobbyTypes';
import styles from './page.module.css';

export interface LobbyEntryTabsProps {
    readonly activeTabId: LobbyEntryTabId;
    readonly lobbyCode: string;
    readonly onLobbyCodeChange: (value: string) => void;
    /** Host-set lobby password (F56). Blank hosts an open lobby. */
    readonly hostPassword: string;
    readonly onHostPasswordChange: (value: string) => void;
    /** Password the joining client presents to the host (F56). */
    readonly joinPassword: string;
    readonly onJoinPasswordChange: (value: string) => void;
    /** Marks the join password field invalid (red) after a wrong-password rejection. */
    readonly joinPasswordInvalid: boolean;
    readonly onTabChange: (tabId: LobbyEntryTabId) => void;
}

export function LobbyEntryTabs({
    activeTabId,
    lobbyCode,
    onLobbyCodeChange,
    hostPassword,
    onHostPasswordChange,
    joinPassword,
    onJoinPasswordChange,
    joinPasswordInvalid,
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
                            <TextInput
                                autoComplete="off"
                                className={styles['entry-field']}
                                data-testid="host-password-input"
                                id="lobby-host-password-input"
                                label="Password (optional):"
                                onValueChange={onHostPasswordChange}
                                placeholder="Leave blank for an open lobby"
                                value={hostPassword}
                            />
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
                                className={styles['entry-field']}
                                data-testid="address-input"
                                id="lobby-code-input"
                                label="Lobby Code:"
                                onValueChange={onLobbyCodeChange}
                                placeholder="127.0.0.1:7777"
                                value={lobbyCode}
                            />
                            <TextInput
                                autoComplete="off"
                                className={styles['entry-field']}
                                data-testid="join-password-input"
                                id="lobby-join-password-input"
                                invalid={joinPasswordInvalid}
                                label="Password:"
                                onValueChange={onJoinPasswordChange}
                                placeholder="Required only if the host set one"
                                value={joinPassword}
                            />
                        </div>
                    ),
                    testId: 'join-lobby',
                },
            ]}
        />
    );
}
