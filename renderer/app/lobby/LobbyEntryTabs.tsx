'use client';

import React from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { TextInput } from '../../components/ui/TextInput';
import { LOBBY_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import type { LobbyEntryTabId } from './lobbyTypes';
import styles from './page.module.css';

export interface LobbyEntryTabsProps {
    readonly activeTabId: LobbyEntryTabId;
    readonly lobbyCode: string;
    readonly onLobbyCodeChange: (value: string) => void;
    /** Host-set lobby password. Blank hosts an open lobby. */
    readonly hostPassword: string;
    readonly onHostPasswordChange: (value: string) => void;
    /** Password the joining client presents to the host. */
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
    const t = useTranslate();
    return (
        <Tabs
            activeTabId={activeTabId}
            ariaLabel={t(LOBBY_KEYS.entryTabsAriaLabel)}
            data-testid="lobby-entry-tabs"
            onActiveTabChange={(tabId) => {
                if (tabId === 'host' || tabId === 'join') {
                    onTabChange(tabId);
                }
            }}
            tabs={[
                {
                    id: 'host',
                    label: t(LOBBY_KEYS.tabHost),
                    panel: (
                        <div className={styles['entry-panel']}>
                            <TextInput
                                autoComplete="off"
                                className={styles['entry-field']}
                                data-testid="host-password-input"
                                id="lobby-host-password-input"
                                label={t(LOBBY_KEYS.hostPasswordLabel)}
                                onValueChange={onHostPasswordChange}
                                placeholder={t(LOBBY_KEYS.hostPasswordPlaceholder)}
                                value={hostPassword}
                            />
                        </div>
                    ),
                },
                {
                    id: 'join',
                    label: t(LOBBY_KEYS.tabJoin),
                    panel: (
                        <div className={styles['entry-panel']}>
                            <TextInput
                                autoComplete="off"
                                className={styles['entry-field']}
                                data-testid="address-input"
                                id="lobby-code-input"
                                label={t(LOBBY_KEYS.codeLabel)}
                                onValueChange={onLobbyCodeChange}
                                placeholder={t(LOBBY_KEYS.codePlaceholder)}
                                value={lobbyCode}
                            />
                            <TextInput
                                autoComplete="off"
                                className={styles['entry-field']}
                                data-testid="join-password-input"
                                id="lobby-join-password-input"
                                invalid={joinPasswordInvalid}
                                label={t(LOBBY_KEYS.joinPasswordLabel)}
                                onValueChange={onJoinPasswordChange}
                                placeholder={t(LOBBY_KEYS.joinPasswordPlaceholder)}
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
