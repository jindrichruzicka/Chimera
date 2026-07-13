import React from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Heading } from '../ui/Heading';
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
 */
export function PlayerList({
    localPlayerId,
    onToggleReady,
    isTogglePending = false,
}: PlayerListProps) {
    const t = useTranslate();
    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const players = lobbyState?.players ?? [];

    return (
        <div className={styles['root']} data-testid="player-list">
            <Heading level={3} size="md">
                {t(LOBBY_KEYS.playersHeading, { n: players.length })}
            </Heading>
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
    return (
        <li
            className={styles['row']}
            data-testid="player-list-item"
            data-player-id={player.playerId}
            data-ready={player.ready ? 'true' : 'false'}
        >
            <span className={styles['identity']}>
                <span className={styles['name']}>{player.displayName || player.playerId}</span>
                {isLocalPlayer ? <Badge variant="neutral">{t(LOBBY_KEYS.you)}</Badge> : null}
            </span>
            <div className={styles['controls']}>
                {/* 'warning' (amber) is intentional over 'error' (red): not-ready is a
                    pending/neutral state, not a fault condition. */}
                <Badge variant={player.ready ? 'success' : 'warning'}>
                    {player.ready ? t(LOBBY_KEYS.ready) : t(LOBBY_KEYS.notReady)}
                </Badge>
                {isLocalPlayer && onToggleReady && (
                    <Button
                        data-testid="ready-toggle"
                        onClick={() => {
                            void onToggleReady(!player.ready);
                        }}
                        disabled={isTogglePending}
                        size="sm"
                        variant="secondary"
                    >
                        {isTogglePending ? t(LOBBY_KEYS.updating) : t(LOBBY_KEYS.toggleReady)}
                    </Button>
                )}
            </div>
        </li>
    );
}
