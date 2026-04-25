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
    onToggleReady?: (ready: boolean) => void;
}

/**
 * Player list component that displays lobby participants and their ready states.
 * Subscribes only to the players slice of lobbyStore to avoid unnecessary re-renders.
 */
export function PlayerList({ localPlayerId, onToggleReady }: PlayerListProps) {
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
                    />
                ))}
            </ul>
        </div>
    );
}

interface PlayerRowProps {
    player: LobbyPlayerEntry;
    isLocalPlayer: boolean;
    onToggleReady: ((ready: boolean) => void) | undefined;
}

function PlayerRow({ player, isLocalPlayer, onToggleReady }: PlayerRowProps) {
    return (
        <li
            data-testid={`player-row-${player.playerId}`}
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem',
                borderBottom: '1px solid #eee',
            }}
        >
            <span>
                {player.displayName || player.playerId}
                {isLocalPlayer && ' (You)'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                    style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: player.ready ? '#d4edda' : '#f8d7da',
                        color: player.ready ? '#155724' : '#721c24',
                        fontSize: '0.8rem',
                    }}
                >
                    {player.ready ? 'Ready' : 'Not Ready'}
                </span>
                {isLocalPlayer && onToggleReady && (
                    <button
                        onClick={() => onToggleReady(!player.ready)}
                        style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.8rem',
                        }}
                    >
                        Toggle Ready
                    </button>
                )}
            </div>
        </li>
    );
}
