'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GameLobbyScreenProps } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { ActiveLobbyPanel } from './ActiveLobbyPanel';
import { LobbyEntryTabs } from './LobbyEntryTabs';
import type { LobbyEntryTabId, PendingAction } from './lobbyTypes';
import { Button } from '../../components/ui/Button';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import { loadRendererGameShell } from '../../game/rendererGameRegistry';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { useGameContent } from '../../state/useGameContent';
import { defaultTheme } from '../../theme/default-theme';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { useThemeOverride } from '../../theme/useThemeOverride';
import { getDefaultLobbyConfig, parseLobbyConfig } from './lobbyConfig';
import { useLobbyApi } from './useLobbyApi';
import styles from './page.module.css';

/**
 * Load the active game's renderer shell so the lobby can render a game-provided
 * `LobbyScreen` when one exists. Loading goes through the renderer game registry
 * only — the lobby page never imports `games/*` directly (Invariant #94).
 *
 * Returns `null` while idle, loading, or on failure; a failed load is a
 * resilient fallback to the engine-default `ActiveLobbyPanel` rather than an
 * error. An `isActive` guard drops stale results from a superseded `gameId`.
 */
function useLobbyGameShell(gameId: string | null): LoadedRendererGameShell | null {
    const [shell, setShell] = useState<LoadedRendererGameShell | null>(null);

    useEffect(() => {
        if (gameId === null) {
            setShell(null);
            return;
        }

        let isActive = true;
        // Clear any previously-loaded shell so a stale screen never lingers
        // across a game change.
        setShell(null);

        loadRendererGameShell(gameId)
            .then((loaded) => {
                if (isActive) {
                    setShell(loaded);
                }
            })
            .catch(() => {
                if (isActive) {
                    setShell(null);
                }
            });

        return () => {
            isActive = false;
        };
    }, [gameId]);

    return shell;
}

export default function LobbyPage() {
    const router = useRouter();
    const [lobbyCode, setLobbyCode] = useState('');
    const [hostPassword, setHostPassword] = useState('');
    const [joinPassword, setJoinPassword] = useState('');
    // A wrong/absent password marks the join password field invalid (red) — no
    // message text; the invalid state alone is the cue (F56).
    const [joinPasswordInvalid, setJoinPasswordInvalid] = useState(false);
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

    // Load the active game's shell so a game-provided LobbyScreen can replace the
    // engine default. Keyed on gameId so it only reloads when the game changes.
    const gameShell = useLobbyGameShell(lobbyState?.info.gameId ?? null);

    // Fetch the active game's content (§4.8) so its LobbyScreen can read the
    // collections it authored (e.g. tactics colours). Generic + game-agnostic.
    const gameContent = useGameContent(lobbyState?.info.gameId ?? null);

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
            // F56: a blank password hosts an open lobby (omit the field entirely).
            const trimmedPassword = hostPassword.trim();
            await lobbyApi.host({
                gameId,
                maxPlayers,
                ...(trimmedPassword ? { password: trimmedPassword } : {}),
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
            setJoinPasswordInvalid(false);
            const trimmedPassword = joinPassword.trim();
            await lobbyApi.join({
                address: lobbyCode.trim(),
                ...(trimmedPassword ? { password: trimmedPassword } : {}),
            });
        } catch (err) {
            if (isMountedRef.current) {
                // The host rejects a wrong/absent password with the structured
                // reason `invalid_password`; that string is the only signal that
                // survives the IPC boundary (the JoinRejectedError class does not),
                // so flag the password field invalid (F56). Any other failure
                // stays in the top-level banner.
                const message = err instanceof Error ? err.message : 'Failed to join lobby';
                if (message.includes('invalid_password')) {
                    setJoinPasswordInvalid(true);
                } else {
                    setError(message);
                }
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

    const handleJoinPasswordChange = (value: string): void => {
        setJoinPassword(value);
        // Clear the invalid state as soon as the user edits the field.
        setJoinPasswordInvalid(false);
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

    const reportSetupError = (err: unknown, fallback: string): void => {
        if (isMountedRef.current) {
            setError(err instanceof Error ? err.message : fallback);
        }
    };

    // A game ships a custom lobby screen when its shell exposes `LobbyScreen`;
    // otherwise the engine-default `ActiveLobbyPanel` renders. The host-authority
    // setters are routed to the lobby IPC via `useLobbyApi` (the contract setters
    // are synchronous, so failures surface through the page's error banner).
    const GameLobbyScreen = gameShell?.LobbyScreen;
    const lobbyScreenProps: GameLobbyScreenProps | null =
        lobbyState !== null && localPlayerId !== null
            ? {
                  lobbyState,
                  localPlayerId,
                  ...(gameContent === undefined ? {} : { content: gameContent }),
                  isHost: localPlayerId === lobbyState.info.hostId,
                  canStartGame,
                  pendingAction,
                  setMatchSetting: (key, value) => {
                      lobbyApi.setMatchSetting(key, value).catch((err: unknown) => {
                          reportSetupError(err, 'Failed to update match setting');
                      });
                  },
                  setPlayerAttribute: (attributePlayerId, key, value) => {
                      // The shared contract's PlayerId is a plain string; brand it
                      // for the preload API at this boundary (cf. useLobbyApi).
                      lobbyApi
                          .setPlayerAttribute(playerId(attributePlayerId), key, value)
                          .catch((err: unknown) => {
                              reportSetupError(err, 'Failed to update player attribute');
                          });
                  },
                  addAiPlayer: () =>
                      lobbyApi.addAiPlayer().catch((err: unknown) => {
                          reportSetupError(err, 'Failed to add AI player');
                      }),
                  removeAiPlayer: (slotIndex) =>
                      lobbyApi.removeAiPlayer(slotIndex).catch((err: unknown) => {
                          reportSetupError(err, 'Failed to remove AI player');
                      }),
                  onToggleReady: handleToggleReady,
                  onStartGame: handleStartGame,
                  onLeave: handleLeave,
              }
            : null;

    return (
        <ThemeProvider theme={lobbyTheme}>
            <main className={styles['page']} role="main" aria-label="Multiplayer Lobby">
                <section
                    aria-label="Multiplayer Lobby"
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
                    {error ? (
                        <div className={styles['error']} data-testid="lobby-error" role="alert">
                            Error: {error}
                        </div>
                    ) : null}

                    {lobbyState ? (
                        GameLobbyScreen && lobbyScreenProps ? (
                            <GameLobbyScreen {...lobbyScreenProps} />
                        ) : (
                            <ActiveLobbyPanel
                                canStartGame={canStartGame}
                                lobbyState={lobbyState}
                                localPlayerId={localPlayerId}
                                onLeave={handleLeave}
                                onStartGame={handleStartGame}
                                onToggleReady={handleToggleReady}
                                pendingAction={pendingAction}
                            />
                        )
                    ) : (
                        <LobbyEntryTabs
                            activeTabId={activeTabId}
                            hostPassword={hostPassword}
                            joinPassword={joinPassword}
                            joinPasswordInvalid={joinPasswordInvalid}
                            lobbyCode={lobbyCode}
                            onHostPasswordChange={setHostPassword}
                            onJoinPasswordChange={handleJoinPasswordChange}
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
                                    size="sm"
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
                                    size="sm"
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
