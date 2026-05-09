'use client';

// renderer/app/lobby/page.tsx
//
// Lobby page with host/join/leave flows.
// Implements the UI for multiplayer lobby management.

import React, { useEffect, useRef, useState } from 'react';
import { type EngineAction, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import { TacticsScreenRegistry } from '@chimera/games/tactics/screens/index.js';
import { PlayerList } from '../../components/shell/PlayerList';
import { SeatSwitcher } from '../../components/shell/SeatSwitcher';
import { MatchShell } from '../../components/shell/MatchShell';
import { Button } from '../../components/ui/Button';
import { useSendAction } from '../../bridge/useSendAction';
import { useGameStore } from '../../state/gameStore';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { bootstrapLobbyStore } from '../../state/lobbyStoreBootstrap';
import { defaultTheme } from '../../theme/default-theme';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { useThemeOverride } from '../../theme/useThemeOverride';
import { getDefaultLobbyConfig, parseLobbyConfig } from './lobbyConfig';
import { getLobbyBridge, useLobbyApi } from './useLobbyApi';

type PendingAction = 'hosting' | 'joining' | 'leaving' | 'starting' | 'updating-ready' | null;
type MatchActionType = 'engine:undo' | 'engine:redo' | 'engine:end_turn';

const sectionCardStyle = {
    padding: 'var(--ch-space-md)',
    border: '1px solid var(--ch-color-border-default)',
    borderRadius: 'var(--ch-radius-sm)',
};

const activeLobbyStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--ch-space-md)',
};

const actionBarStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--ch-space-sm)',
};

export default function LobbyPage() {
    const [lobbyCode, setLobbyCode] = useState('');
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const [error, setError] = useState<string | null>(null);
    const [lobbyConfig, setLobbyConfig] = useState(getDefaultLobbyConfig);
    const isMountedRef = useRef(true);

    const gameId = lobbyConfig.gameId;
    const maxPlayers = lobbyConfig.maxPlayers;
    const lobbyTheme = useThemeOverride(lobbyConfig.themeId ?? defaultTheme.id);
    const lobbyApi = useLobbyApi();
    const sendAction = useSendAction();

    // Get lobby state and local player ID from the store
    const snapshot = useGameStore((state) => state.snapshot);
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

    const handleStartMatch = async (): Promise<void> => {
        try {
            setPendingAction('starting');
            setError(null);
            await lobbyApi.startMatch();
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to start match');
            }
        } finally {
            if (isMountedRef.current) {
                setPendingAction(null);
            }
        }
    };

    const dispatchMatchAction = (
        snapshotForAction: PlayerSnapshot,
        type: MatchActionType,
        payload: Record<string, unknown>,
    ): void => {
        if (localPlayerId === null) {
            return;
        }
        const action: EngineAction = {
            type,
            playerId: localPlayerId,
            tick: snapshotForAction.tick,
            payload,
        };
        sendAction(action);
    };

    // Display lobby information when in a lobby
    const renderLobbyInfo = () => {
        if (!lobbyState) return null;

        return (
            <div style={sectionCardStyle}>
                <p>
                    <strong>Session ID:</strong>{' '}
                    <span data-testid="lobby-session-id">{lobbyState.info.sessionId}</span>
                </p>
                <p>
                    <strong>Host ID:</strong> {lobbyState.info.hostId}
                </p>
            </div>
        );
    };

    const renderPlayerSection = () => {
        if (!lobbyState) return null;

        return (
            <div style={sectionCardStyle}>
                <PlayerList
                    localPlayerId={localPlayerId}
                    onToggleReady={handleToggleReady}
                    isTogglePending={pendingAction === 'updating-ready'}
                />
            </div>
        );
    };

    if (snapshot !== null) {
        return (
            <ThemeProvider theme={lobbyTheme}>
                <MatchShell
                    tick={snapshot.tick}
                    canUndo={snapshot.undoMeta.canUndo}
                    canRedo={snapshot.undoMeta.canRedo}
                    canEndTurn={snapshot.isMyTurn}
                    isGameOver={snapshot.phase === 'ended'}
                    {...(localPlayerId === null
                        ? {}
                        : {
                              onUndo: () =>
                                  dispatchMatchAction(snapshot, 'engine:undo', { steps: 1 }),
                              onRedo: () =>
                                  dispatchMatchAction(snapshot, 'engine:redo', { steps: 1 }),
                              onEndTurn: () => dispatchMatchAction(snapshot, 'engine:end_turn', {}),
                          })}
                >
                    <TacticsScreenRegistry.board
                        snapshot={snapshot}
                        sendAction={sendAction}
                        {...(localPlayerId === null ? {} : { localPlayerId })}
                    />
                </MatchShell>
            </ThemeProvider>
        );
    }

    return (
        <ThemeProvider theme={lobbyTheme}>
            <main
                style={{ fontFamily: 'var(--ch-font-ui)', padding: 'var(--ch-space-lg)' }}
                role="main"
                aria-labelledby="lobby-heading"
            >
                <h1 id="lobby-heading">Multiplayer Lobby</h1>
                {/* Display current configuration */}
                <div
                    style={{
                        backgroundColor: 'var(--ch-color-surface-subtle)',
                        padding: 'var(--ch-space-xs)',
                        borderRadius: 'var(--ch-radius-sm)',
                        marginBottom: 'var(--ch-space-md)',
                        fontSize: 'var(--ch-font-size-sm)',
                    }}
                >
                    <strong>Configuration:</strong> Game ID: {gameId}, Max Players: {maxPlayers}
                    <br />
                    <small>To change: Add ?gameId=yourgame&maxPlayers=6 to URL</small>
                </div>

                {error && (
                    <div
                        style={{
                            color: 'var(--ch-color-feedback-error)',
                            marginBottom: 'var(--ch-space-md)',
                        }}
                        role="alert"
                    >
                        Error: {error}
                    </div>
                )}

                {lobbyState !== null && <SeatSwitcher />}

                {!lobbyState ? (
                    <div>
                        <div style={{ marginBottom: 'var(--ch-space-lg)' }}>
                            <h2>Host a Lobby</h2>
                            <p>
                                Hosting game "{gameId}" with up to {maxPlayers} players
                            </p>
                            <Button
                                data-testid="host-lobby"
                                onClick={() => {
                                    void handleHost();
                                }}
                                disabled={pendingAction !== null}
                                aria-describedby="host-config-info"
                                variant="primary"
                            >
                                {pendingAction === 'hosting' ? 'Hosting...' : 'Host Lobby'}
                            </Button>
                            <div
                                id="host-config-info"
                                style={{
                                    fontSize: 'var(--ch-font-size-xs)',
                                    color: 'var(--ch-color-text-muted)',
                                    marginTop: 'var(--ch-space-xs)',
                                }}
                            >
                                Will host game "{gameId}" with up to {maxPlayers} players
                            </div>
                        </div>

                        <div data-testid="join-lobby">
                            <h2>Join a Lobby</h2>
                            <div style={{ marginBottom: 'var(--ch-space-md)' }}>
                                <label
                                    htmlFor="lobby-code-input"
                                    style={{ display: 'block', marginBottom: 'var(--ch-space-xs)' }}
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
                                    style={{
                                        padding: 'var(--ch-space-xs)',
                                        marginRight: 'var(--ch-space-md)',
                                    }}
                                    aria-describedby="lobby-code-help"
                                />
                                <div
                                    id="lobby-code-help"
                                    style={{
                                        fontSize: 'var(--ch-font-size-xs)',
                                        color: 'var(--ch-color-text-muted)',
                                        marginTop: 'var(--ch-space-xxs)',
                                    }}
                                >
                                    Enter the code provided by the lobby host
                                </div>
                                <Button
                                    data-testid="confirm-join"
                                    onClick={() => {
                                        void handleJoin();
                                    }}
                                    disabled={pendingAction !== null}
                                    variant="primary"
                                >
                                    {pendingAction === 'joining' ? 'Joining...' : 'Join Lobby'}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={activeLobbyStyle}>
                        {renderLobbyInfo()}
                        {renderPlayerSection()}
                        <div style={actionBarStyle}>
                            <Button
                                data-testid="lobby-leave-btn"
                                onClick={() => {
                                    void handleLeave();
                                }}
                                disabled={pendingAction !== null}
                                aria-describedby="leave-warning"
                                variant="danger"
                            >
                                {pendingAction === 'leaving' ? 'Leaving...' : 'Leave Lobby'}
                            </Button>
                            <span
                                id="leave-warning"
                                style={{
                                    position: 'absolute',
                                    width: '1px',
                                    height: '1px',
                                    padding: 0,
                                    margin: '-1px',
                                    overflow: 'hidden',
                                    clip: 'rect(0, 0, 0, 0)',
                                    whiteSpace: 'nowrap',
                                    border: 0,
                                }}
                            >
                                This will disconnect you from the current lobby
                            </span>
                            <Button
                                data-testid="start-match"
                                type="button"
                                onClick={() => {
                                    void handleStartMatch();
                                }}
                                disabled={!canStartMatch || pendingAction !== null}
                                variant="primary"
                            >
                                {pendingAction === 'starting' ? 'Starting...' : 'Start Match'}
                            </Button>
                        </div>
                    </div>
                )}
            </main>
        </ThemeProvider>
    );
}
