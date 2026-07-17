import React from 'react';
import { Badge } from '../ui/Badge';
import { Heading } from '../ui/Heading';
import { ToggleButton } from '../ui/ToggleButton';
import { Icon } from '../ui/icons/Icon';
import { LOBBY_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import type { TranslateFn } from '../../i18n/i18n-context';
import { useLobbyStore } from '../../state/lobbyStore';
import type {
    LobbyPlayerEntry,
    PlayerId,
} from '@chimera-engine/simulation/foundation/messages-schemas.js';
import styles from './PlayerList.module.css';

export interface PlayerListProps {
    /** The ID of the local player; used to show (You) label and toggle button. */
    localPlayerId?: PlayerId | null;
    /** Callback when the local player wants to toggle their ready state. */
    onToggleReady?: (ready: boolean) => void | Promise<void>;
    /** Disables the local player's toggle while an update is in flight. */
    isTogglePending?: boolean;
}

/**
 * Player list component that displays lobby participants and their ready states.
 * Subscribes only to the players slice of lobbyStore to avoid unnecessary re-renders.
 *
 * The local player's ready state is a single icon toggle (the pressed check IS
 * the indicator); a separate ready badge renders only for the seats the local
 * player cannot control.
 */
export function PlayerList({
    localPlayerId,
    onToggleReady,
    isTogglePending = false,
}: PlayerListProps) {
    const t = useTranslate();
    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const players = lobbyState?.players ?? [];
    const readyCount = players.filter((player) => player.ready).length;
    const allReady = players.length > 0 && readyCount === players.length;

    return (
        <div className={styles['root']} data-testid="player-list">
            <div className={styles['heading-row']}>
                <Heading level={3} size="md">
                    {t(LOBBY_KEYS.playersHeading, { n: players.length })}
                </Heading>
                <Badge data-testid="lobby-ready-summary" variant={allReady ? 'success' : 'neutral'}>
                    {t(LOBBY_KEYS.readySummary, { ready: readyCount, total: players.length })}
                </Badge>
            </div>
            <ul className={styles['list']}>
                {players.map((player) => (
                    <PlayerRow
                        key={player.playerId}
                        player={player}
                        isLocalPlayer={player.playerId === localPlayerId}
                        onToggleReady={onToggleReady}
                        isTogglePending={isTogglePending}
                        t={t}
                    />
                ))}
            </ul>
        </div>
    );
}

interface PlayerRowProps {
    player: LobbyPlayerEntry;
    isLocalPlayer: boolean;
    onToggleReady: ((ready: boolean) => void | Promise<void>) | undefined;
    isTogglePending: boolean;
    t: TranslateFn;
}

function PlayerRow({ player, isLocalPlayer, onToggleReady, isTogglePending, t }: PlayerRowProps) {
    const displayName = player.displayName || player.playerId;
    // The local player's control doubles as their status indicator, so the
    // badge renders only where no toggle does.
    const showToggle = isLocalPlayer && onToggleReady !== undefined;

    return (
        <li
            className={styles['row']}
            data-testid="player-list-item"
            data-player-id={player.playerId}
            data-ready={player.ready ? 'true' : 'false'}
        >
            <span className={styles['identity']}>
                <span aria-hidden="true" className={styles['avatar']} data-testid="player-avatar">
                    {displayName.trim().charAt(0).toUpperCase()}
                </span>
                <span className={styles['name']}>{displayName}</span>
                {isLocalPlayer ? <Badge variant="neutral">{t(LOBBY_KEYS.you)}</Badge> : null}
            </span>
            <div className={styles['controls']}>
                {showToggle ? (
                    <ToggleButton
                        aria-label={t(LOBBY_KEYS.toggleReady)}
                        className={styles['ready-toggle']}
                        data-testid="ready-toggle"
                        disabled={isTogglePending}
                        onPressedChange={(next) => {
                            void onToggleReady?.(next);
                        }}
                        pressed={player.ready}
                    >
                        <Icon name="check" />
                    </ToggleButton>
                ) : (
                    /* 'warning' (orange) is intentional over 'error' (red): not-ready
                       is a pending/neutral state, not a fault condition. */
                    <Badge
                        className={styles['status-badge']}
                        variant={player.ready ? 'success' : 'warning'}
                    >
                        {player.ready ? <Icon name="check" /> : null}
                        {player.ready ? t(LOBBY_KEYS.ready) : t(LOBBY_KEYS.notReady)}
                    </Badge>
                )}
            </div>
        </li>
    );
}
