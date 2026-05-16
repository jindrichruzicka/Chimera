'use client';

// renderer/app/game/page.tsx
//
// Game route — thin shell that mounts GameShell with the active snapshot.
// Redirects to /lobby when snapshot is null after lobby-state hydration shows
// that no session is active. Direct-match boot can load this route before the
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
import { type EngineAction, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import { createAssetManager, type AssetManager } from '../../assets/AssetManager';
import { createRendererProtocolAssetResolver } from '../../assets/AssetResolver';
import { GameShell } from '../../components/shell/GameShell';
import { useSendAction } from '../../bridge/useSendAction';
import { loadRendererGame, type LoadedRendererGame } from '../../game/rendererGameRegistry';
import { useGameStore } from '../../state/gameStore';
import { useLobbyStore } from '../../state/lobbyStore';

type GameActionType = 'engine:undo' | 'engine:redo' | 'engine:end_turn';

type RendererGameLoadState =
    | { readonly status: 'idle' }
    | { readonly status: 'loading'; readonly gameId: string }
    | { readonly status: 'loaded'; readonly gameId: string; readonly game: LoadedRendererGame }
    | { readonly status: 'error'; readonly gameId: string; readonly error: Error };

export default function GamePage(): React.ReactElement | null {
    const router = useRouter();
    const snapshot = useGameStore((state) => state.snapshot);
    const currentTick = useGameStore((state) => state.currentTick);
    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const hasLoadedInitialLobbyState = useLobbyStore((state) => state.hasLoadedInitialState);
    const gameId = lobbyState?.info.gameId ?? null;
    const loadedGame = useLoadedRendererGame(gameId);
    const assetManager = React.useMemo<AssetManager | null>(() => {
        if (loadedGame === null) {
            return null;
        }

        return createAssetManager(createRendererProtocolAssetResolver());
    }, [loadedGame]);
    const sendActionToHost = useSendAction();
    const sendAction = React.useCallback(
        (action: EngineAction): void => {
            const actionTick = typeof currentTick === 'number' ? currentTick : action.tick;
            sendActionToHost({ ...action, tick: actionTick });
        },
        [currentTick, sendActionToHost],
    );

    useEffect(() => {
        if (snapshot === null && hasLoadedInitialLobbyState && lobbyState === null) {
            router.replace('/lobby');
        }
    }, [hasLoadedInitialLobbyState, lobbyState, snapshot, router]);

    const dispatchMatchAction = (
        snapshotForAction: PlayerSnapshot,
        playerId: NonNullable<PlayerSnapshot['viewerId']>,
        type: GameActionType,
        payload: Record<string, unknown>,
    ): void => {
        const actionTick = typeof currentTick === 'number' ? currentTick : snapshotForAction.tick;
        const action: EngineAction = {
            type,
            playerId,
            tick: actionTick,
            payload,
        };
        sendAction(action);
    };

    if (snapshot === null) {
        return null;
    }

    if (gameId === null || loadedGame === null || assetManager === null) {
        return null;
    }

    const resolvedPlayerId = snapshot.viewerId;

    return (
        <GameShell
            registry={loadedGame.registry}
            assetManager={assetManager}
            {...(loadedGame.assetManifest === undefined
                ? {}
                : { assetManifest: loadedGame.assetManifest })}
            snapshot={snapshot}
            currentTick={currentTick}
            sendAction={sendAction}
            canEndTurn={snapshot.isMyTurn}
            localPlayerId={resolvedPlayerId}
            {...(process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1'
                ? { fadeOutMs: 0, fadeInMs: 0 }
                : {})}
            onUndo={() =>
                dispatchMatchAction(snapshot, resolvedPlayerId, 'engine:undo', { steps: 1 })
            }
            onRedo={() =>
                dispatchMatchAction(snapshot, resolvedPlayerId, 'engine:redo', { steps: 1 })
            }
            onEndTurn={() => dispatchMatchAction(snapshot, resolvedPlayerId, 'engine:end_turn', {})}
        />
    );
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
