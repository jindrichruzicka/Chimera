'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActiveLobbyPanel } from './ActiveLobbyPanel';
import { LobbyEntryTabs } from './LobbyEntryTabs';
import type { LobbyEntryTabId, PendingAction } from './lobbyTypes';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { defaultTheme } from '../../theme/default-theme';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { useThemeOverride } from '../../theme/useThemeOverride';
import { getDefaultLobbyConfig, parseLobbyConfig } from './lobbyConfig';
import { useLobbyApi } from './useLobbyApi';
import styles from './page.module.css';

export default function LobbyPage() {
    const router = useRouter();
    const [lobbyCode, setLobbyCode] = useState('');
    const [activeTabId, setActiveTabId] = useState<LobbyEntryTabId>('host');
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const [error, setError] = useState<string | null>(null);
    const [lobbyConfig, setLobbyConfig] = useState(getDefaultLobbyConfig);
    const isMountedRef = useRef(true);

    const gameId = lobbyConfig.gameId;
    const maxPlayers = lobbyConfig.maxPlayers;
    const lobbyTheme = useThemeOverride(lobbyConfig.themeId ?? defaultTheme.id);
    const lobbyApi = useLobbyApi();

    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const previousLobbyStateRef = useRef(lobbyState);
    const localPlayerId = useLobbyUiStore((state) => state.localPlayerId);

    useEffect(() => {
        if (previousLobbyStateRef.current !== null && lobbyState === null) {
            setActiveTabId('host');
        }
        previousLobbyStateRef.current = lobbyState;
    }, [lobbyState]);

    const canStartGame =
        localPlayerId !== null &&
        lobbyState !== null &&
        localPlayerId === lobbyState.info.hostId &&
        lobbyState.players.length > 0 &&
        lobbyState.players.every((p) => p.ready);

    // Read URL-driven lobby options after mount to avoid hydration drift.
    useEffect(() => {
        isMountedRef.current = true;
        setLobbyConfig(parseLobbyConfig(new URLSearchParams(window.location.search)));

        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const handleHost = async () => {
        try {
            setPendingAction('hosting');
            setError(null);
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

    const handleJoin = async () => {
        if (!lobbyCode.trim()) {
            setError('Please enter a lobby code');
            return;
        }

        try {
            setPendingAction('joining');
            setError(null);
            await lobbyApi.join({
                address: lobbyCode.trim(),
            });
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

    const handleLeave = async () => {
        try {
            setPendingAction('leaving');
            setError(null);
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

    const handleClose = (): void => {
        const explicitGameId = resolveShellGameId(new URLSearchParams(window.location.search));
        router.push(withShellGameId('/main-menu', explicitGameId));
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

    const handleStartGame = async (): Promise<void> => {
        try {
            setPendingAction('starting');
            setError(null);
            await lobbyApi.startGame();
            router.push('/game');
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to start game');
            }
        } finally {
            if (isMountedRef.current) {
                setPendingAction(null);
            }
        }
    };

    return (
        <ThemeProvider theme={lobbyTheme}>
            <main className={styles['page']} role="main" aria-labelledby="lobby-heading">
                <section
                    aria-labelledby="lobby-heading"
                    // No aria-modal: this is a full-page route — the dialog IS
                    // the entire viewport content. Setting aria-modal without a
                    // focus trap would tell AT to restrict virtual browsing to
                    // the section while keyboard focus can still leave it, which
                    // is inconsistent. role="dialog" + aria-labelledby is
                    // sufficient to announce the surface correctly.
                    className={styles['dialog']}
                    data-testid="lobby-dialog"
                    role="dialog"
                >
                    <header className={styles['dialog-header']}>
                        <div className={styles['title-stack']}>
                            <Heading id="lobby-heading" level={1} size="xl">
                                Multiplayer Lobby
                            </Heading>
                        </div>
                    </header>

                    {error ? (
                        <div className={styles['error']} role="alert">
                            Error: {error}
                        </div>
                    ) : null}

                    {lobbyState ? (
                        <ActiveLobbyPanel
                            canStartGame={canStartGame}
                            lobbyState={lobbyState}
                            localPlayerId={localPlayerId}
                            onLeave={handleLeave}
                            onStartGame={handleStartGame}
                            onToggleReady={handleToggleReady}
                            pendingAction={pendingAction}
                        />
                    ) : (
                        <LobbyEntryTabs
                            activeTabId={activeTabId}
                            config={lobbyConfig}
                            lobbyCode={lobbyCode}
                            onLobbyCodeChange={setLobbyCode}
                            onTabChange={setActiveTabId}
                        />
                    )}

                    {!lobbyState ? (
                        <div className={styles['action-bar']} data-testid="lobby-action-bar">
                            <Button
                                data-testid="lobby-close"
                                onClick={handleClose}
                                size="sm"
                                variant="secondary"
                            >
                                Close
                            </Button>
                            {activeTabId === 'host' ? (
                                <Button
                                    data-testid="host-lobby"
                                    disabled={pendingAction !== null}
                                    onClick={() => {
                                        void handleHost();
                                    }}
                                    variant="primary"
                                >
                                    {pendingAction === 'hosting' ? 'Hosting...' : 'Host Lobby'}
                                </Button>
                            ) : (
                                <Button
                                    data-testid="confirm-join"
                                    disabled={pendingAction !== null}
                                    onClick={() => {
                                        void handleJoin();
                                    }}
                                    variant="primary"
                                >
                                    {pendingAction === 'joining' ? 'Joining...' : 'Join Lobby'}
                                </Button>
                            )}
                        </div>
                    ) : null}
                </section>
            </main>
        </ThemeProvider>
    );
}
