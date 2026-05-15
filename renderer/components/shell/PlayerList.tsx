// renderer/components/shell/PlayerList.tsx
//
// Player list component for the lobby screen.
// Displays a list of players with their ready states.

import React from 'react';
import { useLobbyStore } from '../../state/lobbyStore';
import type { LobbyPlayerEntry, PlayerId } from '@chimera/shared/messages-schemas.js';

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
    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const players = lobbyState?.players ?? [];

    return (
        <div data-testid="player-list">
            <h3>Players ({players.length})</h3>
            <ul style={{ listStyle: 'none', padding: 0 }}>
                {players.map((player) => (
                    <PlayerRow
                        key={player.playerId}
                        player={player}
                        isLocalPlayer={player.playerId === localPlayerId}
                        onToggleReady={onToggleReady}
                        isTogglePending={isTogglePending}
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
}

function PlayerRow({ player, isLocalPlayer, onToggleReady, isTogglePending }: PlayerRowProps) {
    return (
        <li
            data-testid="player-list-item"
            data-player-id={player.playerId}
            data-ready={player.ready ? 'true' : 'false'}
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--ch-space-sm)',
                borderBottom: 'var(--ch-border-width-sm) solid var(--ch-color-border-muted)',
            }}
        >
            <span>
                {player.displayName || player.playerId}
                {isLocalPlayer && ' (You)'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}>
                <span
                    style={{
                        padding: 'var(--ch-space-xs) var(--ch-space-sm)',
                        borderRadius: 'var(--ch-radius-sm)',
                        backgroundColor: player.ready
                            ? 'var(--ch-color-success-surface-muted)'
                            : 'var(--ch-color-error-surface-soft)',
                        color: player.ready
                            ? 'var(--ch-color-success-text-strong)'
                            : 'var(--ch-color-error-text-deep)',
                        fontSize: 'var(--ch-font-size-sm)',
                    }}
                >
                    {player.ready ? 'Ready' : 'Not Ready'}
                </span>
                {isLocalPlayer && onToggleReady && (
                    <button
                        data-testid="ready-toggle"
                        onClick={() => {
                            void onToggleReady(!player.ready);
                        }}
                        disabled={isTogglePending}
                        style={{
                            padding: 'var(--ch-space-xs) var(--ch-space-sm)',
                            fontSize: 'var(--ch-font-size-sm)',
                        }}
                    >
                        {isTogglePending ? 'Updating...' : 'Toggle Ready'}
                    </button>
                )}
            </div>
        </li>
    );
}
