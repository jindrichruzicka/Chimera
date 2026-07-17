'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GameLobbyScreenProps } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { ActiveLobbyPanel } from './ActiveLobbyPanel';
import { LobbyEntryTabs } from './LobbyEntryTabs';
import type { LobbyEntryTabId, PendingAction } from './lobbyTypes';
import { useOptionalFade } from '../../components/shell/FadeContext';
import { screenFadeMs } from '../../components/shell/screenFadeDuration';
import { Modal, type ModalAction } from '../../components/ui/Modal';
import { LOBBY_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
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
    const t = useTranslate();
    const router = useRouter();
    const fade = useOptionalFade();
    const fadeRef = useRef(fade);
    fadeRef.current = fade;
    const [lobbyCode, setLobbyCode] = useState('');
    const [hostPassword, setHostPassword] = useState('');
    const [joinPassword, setJoinPassword] = useState('');
    // A wrong/absent password marks the join password field invalid (red) — no
    // message text; the invalid state alone is the cue.
    const [joinPasswordInvalid, setJoinPasswordInvalid] = useState(false);
    const [activeTabId, setActiveTabId] = useState<LobbyEntryTabId>('host');
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const [error, setError] = useState<string | null>(null);
    const [lobbyConfig, setLobbyConfig] = useState(getDefaultLobbyConfig);
    // Explicit shell game context from `?gameId=` — unlike lobbyConfig.gameId it
    // has NO registry-default fallback, mirroring the main menu's rule.
    const [shellGameId, setShellGameId] = useState<string | null>(null);
    const isMountedRef = useRef(true);

    const gameId = lobbyConfig.gameId;
    const maxPlayers = lobbyConfig.maxPlayers;
    const lobbyTheme = useThemeOverride(lobbyConfig.themeId ?? defaultTheme.id);
    const lobbyApi = useLobbyApi();

    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const previousLobbyStateRef = useRef(lobbyState);
    const localPlayerId = useLobbyUiStore((state) => state.localPlayerId);

    // A game-branded lobby (LobbyScreen + its content) renders only in that
    // game's explicit shell context: the URL's `?gameId=` must name the game the
    // active lobby actually hosts. A bare URL is the engine-default shell — the
    // hosted game's registry-default id alone must NOT pull in its branding
    // (shell overrides resolve ONLY from `?gameId=`, no default-game fallback).
    const activeShellGameId =
        lobbyState !== null && shellGameId !== null && lobbyState.info.gameId === shellGameId
            ? shellGameId
            : null;

    // Load the active game's shell so a game-provided LobbyScreen can replace the
    // engine default. Keyed on gameId so it only reloads when the game changes.
    const gameShell = useLobbyGameShell(activeShellGameId);

    // Fetch the active game's content (§4.8) so its LobbyScreen can read the
    // collections it authored (e.g. tactics colours). Generic + game-agnostic.
    const gameContent = useGameContent(activeShellGameId);

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
        const searchParams = new URLSearchParams(window.location.search);
        setLobbyConfig(parseLobbyConfig(searchParams));
        setShellGameId(resolveShellGameId(searchParams));

        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // App-level screen fade: ease the lobby in on mount. Visible only when
    // arriving from a fade-out — i.e. game→lobby (end match / leave). menu→lobby
    // leaves the overlay transparent, so this is a no-op there (no fade).
    useEffect(() => {
        void fadeRef.current?.fadeIn(screenFadeMs());
    }, []);

    const handleHost = async () => {
        try {
            setPendingAction('hosting');
            setError(null);
            // A blank password hosts an open lobby (omit the field entirely).
            const trimmedPassword = hostPassword.trim();
            await lobbyApi.host({
                gameId,
                maxPlayers,
                ...(trimmedPassword ? { password: trimmedPassword } : {}),
            });
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : t(LOBBY_KEYS.hostFailed));
            }
        } finally {
            if (isMountedRef.current) {
                setPendingAction(null);
            }
        }
    };

    const handleJoin = async () => {
        if (!lobbyCode.trim()) {
            setError(t(LOBBY_KEYS.enterCode));
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
                // so flag the password field invalid. Any other failure stays in
                // the top-level banner.
                const message = err instanceof Error ? err.message : t(LOBBY_KEYS.joinFailed);
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
                setError(err instanceof Error ? err.message : t(LOBBY_KEYS.leaveFailed));
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
        // menu ↔ lobby are both UI screens — no fade between them (the fade marks
        // entering/leaving the game scene, not this hop).
        const explicitGameId = resolveShellGameId(new URLSearchParams(window.location.search));
        router.push(withShellGameId('/main-menu', explicitGameId));
    };

    const handleModalClose = (): void => {
        // Escape/Close semantics per mode: in an ACTIVE session, leaving is an
        // explicit Leave action rendered by the lobby screen — Escape must not
        // dump the player to the main menu, so consume it as a no-op. In entry
        // mode it navigates back like the Close button.
        if (lobbyState !== null) return;
        handleClose();
    };

    const handleToggleReady = async (ready: boolean): Promise<void> => {
        try {
            setPendingAction('updating-ready');
            setError(null);
            await lobbyApi.updatePlayerReadyState(ready);
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : t(LOBBY_KEYS.readyFailed));
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
            // Only start the match — GameStoreBootstrap owns the lobby→game
            // navigation (and its fade to black) when the first snapshot lands, for
            // both host and client. Navigating here too would race that fade and
            // cancel it (the lobby→game fade then never shows). It also preserves
            // the `?gameId=` URL context via currentBrowserGameId().
            await lobbyApi.startGame();
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : t(LOBBY_KEYS.startFailed));
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
                          reportSetupError(err, t(LOBBY_KEYS.matchSettingFailed));
                      });
                  },
                  setPlayerAttribute: (attributePlayerId, key, value) => {
                      // The shared contract's PlayerId is a plain string; brand it
                      // for the preload API at this boundary (cf. useLobbyApi).
                      lobbyApi
                          .setPlayerAttribute(playerId(attributePlayerId), key, value)
                          .catch((err: unknown) => {
                              reportSetupError(err, t(LOBBY_KEYS.playerAttrFailed));
                          });
                  },
                  addAiPlayer: () =>
                      lobbyApi.addAiPlayer().catch((err: unknown) => {
                          reportSetupError(err, t(LOBBY_KEYS.addAiFailed));
                      }),
                  removeAiPlayer: (slotIndex) =>
                      lobbyApi.removeAiPlayer(slotIndex).catch((err: unknown) => {
                          reportSetupError(err, t(LOBBY_KEYS.removeAiFailed));
                      }),
                  onToggleReady: handleToggleReady,
                  onStartGame: handleStartGame,
                  onLeave: handleLeave,
              }
            : null;

    // Active-session footer: Leave/Start are Modal actions so they align with
    // every other modal's button row. Both operate in place (dismiss: false) —
    // navigation on leave/start is owned by the stores, never by dismissal.
    const activeActions: readonly ModalAction[] = [
        {
            label: pendingAction === 'leaving' ? t(LOBBY_KEYS.leaving) : t(LOBBY_KEYS.leaveLobby),
            variant: 'danger',
            testId: 'lobby-leave-btn',
            dismiss: false,
            disabled: pendingAction !== null,
            ariaDescribedBy: 'leave-warning',
            onClick: () => {
                void handleLeave();
            },
        },
        {
            label: pendingAction === 'starting' ? t(LOBBY_KEYS.starting) : t(LOBBY_KEYS.startGame),
            variant: 'primary',
            testId: 'start-game',
            dismiss: false,
            disabled: !canStartGame || pendingAction !== null,
            onClick: () => {
                void handleStartGame();
            },
        },
    ];

    // Entry-mode footer: Close dismisses; Host/Join operate in place
    // (dismiss: false) so a failure keeps the form open with its error banner.
    const entryActions: readonly ModalAction[] = [
        { label: t(LOBBY_KEYS.close), variant: 'secondary', testId: 'lobby-close' },
        activeTabId === 'host'
            ? {
                  label:
                      pendingAction === 'hosting' ? t(LOBBY_KEYS.hosting) : t(LOBBY_KEYS.hostLobby),
                  variant: 'primary',
                  testId: 'host-lobby',
                  dismiss: false,
                  disabled: pendingAction !== null,
                  onClick: () => {
                      void handleHost();
                  },
              }
            : {
                  label:
                      pendingAction === 'joining' ? t(LOBBY_KEYS.joining) : t(LOBBY_KEYS.joinLobby),
                  variant: 'primary',
                  testId: 'confirm-join',
                  dismiss: false,
                  disabled: pendingAction !== null,
                  onClick: () => {
                      void handleJoin();
                  },
              },
    ];

    return (
        <ThemeProvider theme={lobbyTheme}>
            <main aria-label={t(LOBBY_KEYS.title)} role="main">
                <Modal
                    open
                    actions={lobbyState === null ? entryActions : activeActions}
                    actionsTestId="lobby-action-bar"
                    data-testid="lobby-dialog"
                    onClose={handleModalClose}
                    size="xl"
                    title={t(LOBBY_KEYS.title)}
                >
                    {error ? (
                        <div className={styles['error']} data-testid="lobby-error" role="alert">
                            {t(LOBBY_KEYS.errorPrefix, { error })}
                        </div>
                    ) : null}

                    {/* Referenced by the footer Leave action's aria-describedby;
                        rendered at page level so it exists for the engine-default
                        panel and game-provided screens alike. */}
                    {lobbyState ? (
                        <span className={styles['sr-only']} id="leave-warning">
                            {t(LOBBY_KEYS.leaveWarning)}
                        </span>
                    ) : null}

                    {lobbyState ? (
                        GameLobbyScreen && lobbyScreenProps ? (
                            <GameLobbyScreen {...lobbyScreenProps} />
                        ) : (
                            <ActiveLobbyPanel
                                lobbyState={lobbyState}
                                localPlayerId={localPlayerId}
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
                </Modal>
            </main>
        </ThemeProvider>
    );
}
