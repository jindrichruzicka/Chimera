'use client';

// renderer/app/game/page.tsx
//
// Game route — thin shell that mounts GameShell with the active snapshot.
// Redirects to /lobby when snapshot is null after lobby-state hydration shows
// that no session is active. Direct-game boot can load this route before the
// first snapshot arrives and wait here while the hidden lobby auto-starts.
//
// Architecture reference: §4.33–§4.34 — GameScreenRegistry, GameShell
// Module boundary tree: renderer/app/game/page.tsx # Thin shell: mounts GameShell
//
// Invariants upheld:
//   #1  — Only PlayerSnapshot (never GameSnapshot) is consumed here.
//   #48 — GameShell is game-agnostic; this route delegates game-specific
//          registry resolution to renderer/game/rendererGameRegistry.
//   #80 — GameShell never imports from games/*; the registry is passed as data.
//   #88 — GameShell wraps every screen in React.Suspense (see GameShell.tsx).

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    type EngineAction,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { createAssetManager, type AssetManager } from '../../assets/AssetManager';
import { createRendererGameAssetResolver } from '../../assets/AssetResolver';
import { useOptionalFade } from '../../components/shell/FadeContext';
import { screenFadeMs } from '../../components/shell/screenFadeDuration';
import { GameShell } from '../../components/shell/GameShell';
import { useSendAction } from '../../bridge/useSendAction';
import { loadRendererGame, type LoadedRendererGame } from '../../game/rendererGameRegistry';
import { useSavesApi } from '../../hooks/useSavesApi';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';
import { useGameStore } from '../../state/gameStore';
import { useLobbyStore } from '../../state/lobbyStore';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { useSaveStore } from '../../state/saveStore';
import { useToastStore } from '../../state/toastStore';
import { useUiStore } from '../../state/uiStore';
import { useGameContent } from '../../state/useGameContent';
import { useInputAction } from '../../input/useInputAction.js';
import type { InputEvent } from '../../input/InputAction.js';

type GameActionType = 'engine:undo' | 'engine:redo' | 'engine:end_turn';

// The post-game scene; its registry-declared default screen is the screen the
// match advances to once the result is resolved (see GameScreenRegistry).
const POST_GAME_SCENE_ID = 'engine:post-game';

type RendererGameLoadState =
    | { readonly status: 'idle' }
    | { readonly status: 'loading'; readonly gameId: string }
    | { readonly status: 'loaded'; readonly gameId: string; readonly game: LoadedRendererGame }
    | { readonly status: 'error'; readonly gameId: string; readonly error: Error };

export default function GamePage(): React.ReactElement | null {
    const router = useRouter();
    const fade = useOptionalFade();
    const fadeRef = React.useRef(fade);
    fadeRef.current = fade;
    const snapshot = useGameStore((state) => state.snapshot);
    const currentTick = useGameStore((state) => state.currentTick);
    const lastReveal = useGameStore((state) => state.lastReveal);
    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const hasLoadedInitialLobbyState = useLobbyStore((state) => state.hasLoadedInitialState);
    const leavingToMainMenu = useLobbyUiStore((state) => state.leavingToMainMenu);
    const restoreAbortPending = useSaveStore((state) => state.restoreAbortPending);
    const leavingRef = React.useRef(false);
    const gameId = lobbyState?.info.gameId ?? null;
    const gameContent = useGameContent(gameId);
    const loadedGame = useLoadedRendererGame(gameId);
    const savesApi = useSavesApi();
    const assetManager = React.useMemo<AssetManager | null>(() => {
        if (loadedGame === null) {
            return null;
        }

        return createAssetManager(createRendererGameAssetResolver());
    }, [loadedGame]);
    const sendActionToHost = useSendAction();
    const sendAction = React.useCallback(
        (action: EngineAction): void => {
            if (snapshot !== null && isTerminalSnapshot(snapshot)) {
                return;
            }

            const actionTick = typeof currentTick === 'number' ? currentTick : action.tick;
            sendActionToHost({ ...action, tick: actionTick });
        },
        [currentTick, sendActionToHost, snapshot],
    );

    // Client leave-to-main-menu. useLeaveGame() sets this flag before the
    // disconnect lands; routing owns the navigation + stale-snapshot reset. Latch
    // the in-flight leave in a ref so the direct-boot effect below cannot hijack
    // it to /lobby once the disconnect nulls both snapshot and lobbyState
    // (lobbyStoreBootstrap applies lobbyState=null on 'disconnected'). The flag is
    // consumed (reset to false) right after navigating.
    useEffect(() => {
        if (leavingToMainMenu && !leavingRef.current) {
            leavingRef.current = true;
            useLobbyUiStore.getState().setLeavingToMainMenu(false);
            // Preserve the game context so the main menu resolves the game's shell
            // (its override) rather than falling back to the engine default.
            const explicitGameId = resolveShellGameId(new URLSearchParams(window.location.search));
            // Fade the game out to black BEFORE resetting + navigating, so the
            // GameShell unmount (reset() nulls the snapshot) is hidden behind the
            // overlay; the main menu fades itself back in on mount.
            const finishLeave = (): void => {
                useGameStore.getState().reset();
                router.replace(withShellGameId('/main-menu', explicitGameId));
            };
            const control = fadeRef.current;
            if (control === null) {
                finishLeave();
            } else {
                void control.fadeOut(screenFadeMs()).then(finishLeave);
            }
        }
    }, [leavingToMainMenu, router]);

    // Restore-abort exit. Cancelling the waiting-for-players overlay unwinds the
    // hosted session, but the mid-restore hop already parked this window on /game
    // and the torn-down session never broadcasts the phase:'lobby' snapshot that
    // drives the usual reverse navigation. The overlay cannot navigate either —
    // the no-session redirect below fires once the cancelled lobby empties and
    // would beat any exit issued there. So, mirroring the leave flag above: the
    // overlay raises the marker, this effect consumes it, drops the restored
    // checkpoint, and returns the host to the saves screen so another slot can be
    // loaded. Declared BEFORE the no-session redirect so the leavingRef latch
    // lands within the same commit; no fade-out — /saves has no mount fade-in
    // (useScreenFadeNavigate) and the abort happens on a faded-in screen.
    useEffect(() => {
        if (restoreAbortPending && !leavingRef.current) {
            leavingRef.current = true;
            useSaveStore.getState().clearRestoreAbort();
            const explicitGameId = resolveShellGameId(new URLSearchParams(window.location.search));
            useGameStore.getState().reset();
            router.replace(withShellGameId('/saves', explicitGameId));
        }
    }, [restoreAbortPending, router]);

    useEffect(() => {
        if (leavingRef.current) return; // a leave or restore-abort hop is in flight
        if (snapshot === null && hasLoadedInitialLobbyState && lobbyState === null) {
            const explicitGameId = resolveShellGameId(new URLSearchParams(window.location.search));
            router.replace(withShellGameId('/lobby', explicitGameId));
        }
    }, [hasLoadedInitialLobbyState, lobbyState, snapshot, router]);

    const dispatchGameAction = (
        snapshotForAction: PlayerSnapshot,
        playerId: NonNullable<PlayerSnapshot['viewerId']>,
        type: GameActionType,
        payload: Record<string, unknown>,
    ): void => {
        if (isTerminalSnapshot(snapshotForAction)) {
            return;
        }

        const actionTick = typeof currentTick === 'number' ? currentTick : snapshotForAction.tick;
        const action: EngineAction = {
            type,
            playerId,
            tick: actionTick,
            payload,
        };
        sendAction(action);
    };

    const onUndoKey = React.useCallback(
        (event: InputEvent) => {
            if (!event.pressed || snapshot === null) return;
            if (isTerminalSnapshot(snapshot)) return;
            if (!snapshot.undoMeta.canUndo) return;
            const actionTick = typeof currentTick === 'number' ? currentTick : snapshot.tick;
            sendAction({
                type: 'engine:undo',
                playerId: snapshot.viewerId,
                tick: actionTick,
                payload: { steps: 1 },
            });
        },
        [snapshot, sendAction, currentTick],
    );
    const onRedoKey = React.useCallback(
        (event: InputEvent) => {
            if (!event.pressed || snapshot === null) return;
            if (isTerminalSnapshot(snapshot)) return;
            if (!snapshot.undoMeta.canRedo) return;
            const actionTick = typeof currentTick === 'number' ? currentTick : snapshot.tick;
            sendAction({
                type: 'engine:redo',
                playerId: snapshot.viewerId,
                tick: actionTick,
                payload: { steps: 1 },
            });
        },
        [snapshot, sendAction, currentTick],
    );
    const onEndTurnKey = React.useCallback(
        (event: InputEvent) => {
            if (!event.pressed || snapshot === null) return;
            // After the match resolves, End Turn becomes "continue": advance to the
            // game's post-game summary screen (a renderer-local screen switch — the
            // authoritative scene is unchanged, so no engine action is dispatched).
            if (isTerminalSnapshot(snapshot)) {
                const postGameScreen =
                    loadedGame?.registry.sceneDefaultScreens?.[POST_GAME_SCENE_ID];
                if (postGameScreen !== undefined) {
                    useUiStore.getState().navigateToScreen(postGameScreen);
                }
                return;
            }
            if (!snapshot.isMyTurn) return;
            const actionTick = typeof currentTick === 'number' ? currentTick : snapshot.tick;
            sendAction({
                type: 'engine:end_turn',
                playerId: snapshot.viewerId,
                tick: actionTick,
                payload: {},
            });
        },
        [snapshot, sendAction, currentTick, loadedGame],
    );
    useInputAction('engine:undo', onUndoKey);
    useInputAction('engine:redo', onRedoKey);
    useInputAction('game:end-turn', onEndTurnKey);

    // App-level screen fade: once the game is actually here (snapshot + game +
    // assets all loaded, i.e. GameShell is about to render), ease in from the
    // black overlay that the lobby→game transition faded to. Latched so it fires
    // once per entry, and re-armed if we drop back out of the ready state.
    const sceneReady =
        snapshot !== null && gameId !== null && loadedGame !== null && assetManager !== null;
    const fadedInRef = React.useRef(false);
    React.useEffect(() => {
        if (sceneReady && !fadedInRef.current) {
            fadedInRef.current = true;
            void fadeRef.current?.fadeIn(screenFadeMs());
        } else if (!sceneReady) {
            fadedInRef.current = false;
        }
    }, [sceneReady]);

    if (snapshot === null) {
        return null;
    }

    if (gameId === null || loadedGame === null || assetManager === null) {
        return null;
    }

    const resolvedPlayerId = snapshot.viewerId;
    // Host vs. client decides which replay the post-game summary can export: the
    // host gets the authoritative deterministic replay; a joined client gets only
    // its own perspective replay (Invariants #71 / #98). `lobbyState` is non-null
    // here — `gameId` derives from it and is guarded above.
    const isHost = lobbyState !== null && lobbyState.info.hostId === resolvedPlayerId;

    // In-game save. Built ONLY for the host so GameShell never offers the
    // saveGame capability to a joined client (Invariant #25 — main-side
    // captureSaveFile rejects non-hosted sessions regardless, defense in depth).
    // A blank name omits `label` so SaveManager default naming applies. Toast
    // titles are static literals carrying no save metadata (Invariant #74).
    const handleSaveGame = async (label: string): Promise<void> => {
        try {
            await savesApi.save({ gameId, ...(label === '' ? {} : { label }) });
            useToastStore.getState().push({ severity: 'success', title: 'Game saved' });
        } catch {
            useToastStore.getState().push({ severity: 'error', title: 'Save failed' });
        }
    };

    return (
        <GameShell
            registry={loadedGame.registry}
            assetManager={assetManager}
            {...(loadedGame.assetManifest === undefined
                ? {}
                : { assetManifest: loadedGame.assetManifest })}
            {...(loadedGame.inputActions === undefined
                ? {}
                : { inputActions: loadedGame.inputActions })}
            snapshot={snapshot}
            currentTick={currentTick}
            sendAction={sendAction}
            {...(gameContent === undefined ? {} : { content: gameContent })}
            reveal={lastReveal}
            canEndTurn={!isTerminalSnapshot(snapshot) && snapshot.isMyTurn}
            localPlayerId={resolvedPlayerId}
            isHost={isHost}
            {...(process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1'
                ? { fadeOutMs: 0, fadeInMs: 0 }
                : {})}
            onUndo={() =>
                dispatchGameAction(snapshot, resolvedPlayerId, 'engine:undo', { steps: 1 })
            }
            onRedo={() =>
                dispatchGameAction(snapshot, resolvedPlayerId, 'engine:redo', { steps: 1 })
            }
            onEndTurn={() => dispatchGameAction(snapshot, resolvedPlayerId, 'engine:end_turn', {})}
            {...(isHost ? { onSaveGame: handleSaveGame } : {})}
        />
    );
}

function isTerminalSnapshot(snapshot: PlayerSnapshot): boolean {
    return snapshot.gameResult !== null || snapshot.phase === 'ended';
}

function useLoadedRendererGame(gameId: string | null): LoadedRendererGame | null {
    const [loadState, setLoadState] = React.useState<RendererGameLoadState>({ status: 'idle' });

    React.useEffect(() => {
        if (gameId === null) {
            setLoadState({ status: 'idle' });
            return;
        }

        let isActive = true;
        setLoadState({ status: 'loading', gameId });

        loadRendererGame(gameId)
            .then((game) => {
                if (isActive) {
                    setLoadState({ status: 'loaded', gameId, game });
                }
            })
            .catch((error: unknown) => {
                if (isActive) {
                    setLoadState({ status: 'error', gameId, error: toError(error) });
                }
            });

        return () => {
            isActive = false;
        };
    }, [gameId]);

    if (loadState.status === 'error' && loadState.gameId === gameId) {
        throw loadState.error;
    }

    if (loadState.status === 'loaded' && loadState.gameId === gameId) {
        return loadState.game;
    }

    return null;
}

function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}
