'use client';

// renderer/app/lobby/page.tsx
//
// Lobby page with host/join/leave flows.
// Implements the UI for multiplayer lobby management.

import React, { useState, useEffect } from 'react';
import { useLobbyStore } from '../../state/lobbyStore';
import { bootstrapLobbyStore } from '../../state/lobbyStoreBootstrap';

export default function LobbyPage() {
    const [lobbyCode, setLobbyCode] = useState('');
    const [isHosting, setIsHosting] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Configurable parameters with sensible defaults
    const gameId =
        typeof window !== 'undefined'
            ? (new URLSearchParams(window.location.search).get('gameId') ?? 'tactics')
            : 'tactics';

    const maxPlayers =
        typeof window !== 'undefined'
            ? Math.min(
                  Math.max(
                      parseInt(
                          new URLSearchParams(window.location.search).get('maxPlayers') ?? '4',
                          10,
                      ),
                      2,
                  ),
                  16,
              )
            : 4;

    // Get lobby state from the store
    const lobbyState = useLobbyStore((state) => state.lobbyState);

    // Bootstrap the lobby store with the chimera API
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;

        if (typeof window !== 'undefined' && window.__chimera) {
            unsubscribe = bootstrapLobbyStore(window.__chimera.lobby, window.__chimera.system);
        }

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    // Host a new lobby
    const handleHost = async () => {
        if (!window.__chimera) {
            setError('Chimera API not available');
            return;
        }

        try {
            setIsHosting(true);
            setError(null);
            // Call the host function with configurable parameters
            await window.__chimera.lobby.host({
                gameId,
                maxPlayers,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to host lobby');
        } finally {
            setIsHosting(false);
        }
    };

    // No additional focus management needed at this time

    // Join an existing lobby
    const handleJoin = async () => {
        if (!window.__chimera) {
            setError('Chimera API not available');
            return;
        }

        if (!lobbyCode.trim()) {
            setError('Please enter a lobby code');
            return;
        }

        try {
            setIsJoining(true);
            setError(null);
            // Call the join function with the entered lobby code
            await window.__chimera.lobby.join({
                address: lobbyCode.trim(),
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to join lobby');
        } finally {
            setIsJoining(false);
        }
    };

    // Leave the current lobby
    const handleLeave = async () => {
        if (!window.__chimera) {
            setError('Chimera API not available');
            return;
        }

        try {
            setIsLeaving(true);
            setError(null);
            // Call the leave function
            await window.__chimera.lobby.leave();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to leave lobby');
        } finally {
            setIsLeaving(false);
        }
    };

    // Display lobby information when in a lobby
    const renderLobbyInfo = () => {
        if (!lobbyState) return null;

        return (
            <div
                style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                }}
            >
                <h3>Lobby Information</h3>
                <p>
                    <strong>Session ID:</strong> {lobbyState.info.sessionId}
                </p>
                <p>
                    <strong>Host ID:</strong> {lobbyState.info.hostId}
                </p>
                <p>
                    <strong>Game:</strong> {lobbyState.info.gameId}
                </p>
                <h4>Players ({lobbyState.players.length})</h4>
                <ul>
                    {lobbyState.players.map((player) => (
                        <li key={player.playerId}>
                            {player.displayName} {player.ready ? '(Ready)' : '(Not Ready)'}
                        </li>
                    ))}
                </ul>
            </div>
        );
    };

    return (
        <main
            style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}
            role="main"
            aria-labelledby="lobby-heading"
        >
            <h1 id="lobby-heading">Multiplayer Lobby</h1>

            {/* Display current configuration */}
            <div
                style={{
                    backgroundColor: '#f0f0f0',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    marginBottom: '1rem',
                    fontSize: '0.9rem',
                }}
            >
                <strong>Configuration:</strong> Game ID: {gameId}, Max Players: {maxPlayers}
                <br />
                <small>To change: Add ?gameId=yourgame&maxPlayers=6 to URL</small>
            </div>

            {error && (
                <div style={{ color: 'red', marginBottom: '1rem' }} role="alert">
                    Error: {error}
                </div>
            )}

            {!lobbyState ? (
                <div>
                    <div style={{ marginBottom: '2rem' }}>
                        <h2>Host a Lobby</h2>
                        <p>
                            Hosting game "{gameId}" with up to {maxPlayers} players
                        </p>
                        <button
                            data-testid="lobby-host-btn"
                            onClick={() => {
                                void handleHost();
                            }}
                            disabled={isHosting}
                            style={{ padding: '0.5rem 1rem', marginRight: '1rem' }}
                            aria-describedby="host-config-info"
                        >
                            {isHosting ? 'Hosting...' : 'Host Lobby'}
                        </button>
                        <div
                            id="host-config-info"
                            style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}
                        >
                            Will host game "{gameId}" with up to {maxPlayers} players
                        </div>
                    </div>

                    <div>
                        <h2>Join a Lobby</h2>
                        <div style={{ marginBottom: '1rem' }}>
                            <label
                                htmlFor="lobby-code-input"
                                style={{ display: 'block', marginBottom: '0.5rem' }}
                            >
                                Lobby Code:
                            </label>
                            <input
                                id="lobby-code-input"
                                data-testid="lobby-code-input"
                                type="text"
                                value={lobbyCode}
                                onChange={(e) => setLobbyCode(e.target.value)}
                                placeholder="Enter lobby code"
                                style={{ padding: '0.5rem', marginRight: '1rem' }}
                                aria-describedby="lobby-code-help"
                            />
                            <div
                                id="lobby-code-help"
                                style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}
                            >
                                Enter the code provided by the lobby host
                            </div>
                            <button
                                data-testid="lobby-join-btn"
                                onClick={() => {
                                    void handleJoin();
                                }}
                                disabled={isJoining}
                                style={{ padding: '0.5rem 1rem', marginTop: '0.5rem' }}
                            >
                                {isJoining ? 'Joining...' : 'Join Lobby'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div>
                    <h2>Current Lobby</h2>
                    {renderLobbyInfo()}
                    <div style={{ marginTop: '1rem' }}>
                        <button
                            data-testid="lobby-leave-btn"
                            onClick={() => {
                                void handleLeave();
                            }}
                            disabled={isLeaving}
                            style={{ padding: '0.5rem 1rem' }}
                            aria-describedby="leave-warning"
                        >
                            {isLeaving ? 'Leaving...' : 'Leave Lobby'}
                        </button>
                        <div
                            id="leave-warning"
                            style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}
                        >
                            This will disconnect you from the current lobby
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
