'use client';

// renderer/app/lobby/page.tsx
//
// Lobby page with host/join/leave flows.
// Implements the UI for multiplayer lobby management.

import React, { useEffect, useRef, useState } from 'react';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { bootstrapLobbyStore } from '../../state/lobbyStoreBootstrap';
import { getDefaultLobbyConfig, parseLobbyConfig } from './lobbyConfig';
import { getLobbyBridge, useLobbyApi } from './useLobbyApi';
import { PlayerList } from '../../components/shell/PlayerList';
import { SeatSwitcher } from '../../components/shell/SeatSwitcher';

type PendingAction = 'hosting' | 'joining' | 'leaving' | 'updating-ready' | null;

export default function LobbyPage() {
    const [lobbyCode, setLobbyCode] = useState('');
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const [error, setError] = useState<string | null>(null);
    const [lobbyConfig, setLobbyConfig] = useState(getDefaultLobbyConfig);
    const isMountedRef = useRef(true);

    const gameId = lobbyConfig.gameId;
    const maxPlayers = lobbyConfig.maxPlayers;
    const lobbyApi = useLobbyApi();

    // Get lobby state and local player ID from the store
    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const localPlayerId = useLobbyUiStore((state) => state.localPlayerId);

    const canStartMatch =
        localPlayerId !== null &&
        lobbyState !== null &&
        localPlayerId === lobbyState.info.hostId &&
        lobbyState.players.length > 0 &&
        lobbyState.players.every((p) => p.ready);

    // Bootstrap the lobby store with the chimera API
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        isMountedRef.current = true;

        setLobbyConfig(parseLobbyConfig(new URLSearchParams(window.location.search)));

        const bridge = getLobbyBridge();
        if (bridge) {
            unsubscribe = bootstrapLobbyStore(bridge.lobby, bridge.system);
        }

        return () => {
            isMountedRef.current = false;
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    // Host a new lobby
    const handleHost = async () => {
        try {
            setPendingAction('hosting');
            setError(null);
            // Call the host function with configurable parameters
            await lobbyApi.host({
                gameId,
                maxPlayers,
            });
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to host lobby');
            }
        } finally {
            if (isMountedRef.current) {
                setPendingAction(null);
            }
        }
    };

    // No additional focus management needed at this time

    // Join an existing lobby
    const handleJoin = async () => {
        if (!lobbyCode.trim()) {
            setError('Please enter a lobby code');
            return;
        }

        try {
            setPendingAction('joining');
            setError(null);
            // Call the join function with the entered lobby code
            await lobbyApi.join({
                address: lobbyCode.trim(),
            });
            // useLobbyApi.join() populates renderer-local identity context from
            // the authoritative main-process bridge before returning.
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to join lobby');
            }
        } finally {
            if (isMountedRef.current) {
                setPendingAction(null);
            }
        }
    };

    // Leave the current lobby
    const handleLeave = async () => {
        try {
            setPendingAction('leaving');
            setError(null);
            // Call the leave function
            await lobbyApi.leave();
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to leave lobby');
            }
        } finally {
            if (isMountedRef.current) {
                setPendingAction(null);
            }
        }
    };

    const handleToggleReady = async (ready: boolean): Promise<void> => {
        try {
            setPendingAction('updating-ready');
            setError(null);
            await lobbyApi.updatePlayerReadyState(ready);
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to update ready state');
            }
        } finally {
            if (isMountedRef.current) {
                setPendingAction(null);
            }
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
                    <strong>Session ID:</strong>{' '}
                    <span data-testid="lobby-session-id">{lobbyState.info.sessionId}</span>
                </p>
                <p>
                    <strong>Host ID:</strong> {lobbyState.info.hostId}
                </p>
                <p>
                    <strong>Game:</strong> {lobbyState.info.gameId}
                </p>
                <PlayerList
                    localPlayerId={localPlayerId}
                    onToggleReady={handleToggleReady}
                    isTogglePending={pendingAction === 'updating-ready'}
                />
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

            {lobbyState !== null && <SeatSwitcher />}

            {!lobbyState ? (
                <div>
                    <div style={{ marginBottom: '2rem' }}>
                        <h2>Host a Lobby</h2>
                        <p>
                            Hosting game "{gameId}" with up to {maxPlayers} players
                        </p>
                        <button
                            data-testid="host-lobby"
                            onClick={() => {
                                void handleHost();
                            }}
                            disabled={pendingAction !== null}
                            style={{ padding: '0.5rem 1rem', marginRight: '1rem' }}
                            aria-describedby="host-config-info"
                        >
                            {pendingAction === 'hosting' ? 'Hosting...' : 'Host Lobby'}
                        </button>
                        <div
                            id="host-config-info"
                            style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}
                        >
                            Will host game "{gameId}" with up to {maxPlayers} players
                        </div>
                    </div>

                    <div data-testid="join-lobby">
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
                                data-testid="address-input"
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
                                data-testid="confirm-join"
                                onClick={() => {
                                    void handleJoin();
                                }}
                                disabled={pendingAction !== null}
                                style={{ padding: '0.5rem 1rem', marginTop: '0.5rem' }}
                            >
                                {pendingAction === 'joining' ? 'Joining...' : 'Join Lobby'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div>
                    <h2>Current Lobby</h2>
                    <button
                        data-testid="start-match"
                        type="button"
                        disabled={!canStartMatch || pendingAction !== null}
                        style={{ padding: '0.5rem 1rem', marginBottom: '1rem' }}
                    >
                        Start Match
                    </button>
                    {renderLobbyInfo()}
                    <div style={{ marginTop: '1rem' }}>
                        <button
                            data-testid="lobby-leave-btn"
                            onClick={() => {
                                void handleLeave();
                            }}
                            disabled={pendingAction !== null}
                            style={{ padding: '0.5rem 1rem' }}
                            aria-describedby="leave-warning"
                        >
                            {pendingAction === 'leaving' ? 'Leaving...' : 'Leave Lobby'}
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
