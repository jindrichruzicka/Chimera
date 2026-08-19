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
//   #3  — Only PlayerSnapshot (never GameSnapshot) is consumed here.
//   #48 — GameShell is game-agnostic; this route delegates game-specific
//          registry resolution to renderer/game/rendererGameRegistry.
//   #80 — GameShell never imports from apps/*; the registry is passed as data.
//   #88 — GameShell wraps every screen in React.Suspense (see GameShell.tsx).

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    type EngineAction,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { isSceneTransitionCompletionAction } from '@chimera-engine/simulation/foundation/scene-lifecycle.js';
import { useCriticalAssetPreloadGate } from '../../assets/criticalAssetPreload.js';
import { useOptionalFade } from '../../components/shell/FadeContext';
import { screenFadeMs } from '../../components/shell/screenFadeDuration';
import { GameShell } from '../../components/shell/GameShell';
import { resolveLoadingBeatFloorMs } from '../../components/scene/loadingCoverHold.js';
import { LoadingBeatCover } from '../../components/scene/LoadingBeatCover.js';
import { isRouteCoverGameDeclared } from '../../components/scene/RouteEntryLoadingCover';
import { useLoadingBeat } from '../../components/scene/useLoadingBeat.js';
import { useSendAction } from '../../bridge/useSendAction';
import { loadRendererGame, type LoadedRendererGame } from '../../game/rendererGameRegistry';
import { useRendererGameAssetManager } from '../gameAssetSession.js';
import { useSavesApi } from '../../hooks/useSavesApi';
import { TOAST_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';
import { useGameStore } from '../../state/gameStore';
import { useLobbyStore } from '../../state/lobbyStore';
import { useIsSpectator, useLobbyUiStore } from '../../state/lobbyUiStore';
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
    const isSpectator = useIsSpectator();
    const restoreAbortPending = useSaveStore((state) => state.restoreAbortPending);
    // A restore parks the host on /game and waits for the saved remote seats, so
    // the reveal has to be released while it does: the overlay that aborts it
    // sits below both the curtain and the cover.
    const restoreWaiting = useSaveStore((state) => state.restore?.state === 'waiting');
    const leavingRef = React.useRef(false);
    const gameId = lobbyState?.info.gameId ?? null;
    const gameContent = useGameContent(gameId);
    const loadedGame = useLoadedRendererGame(gameId);
    const savesApi = useSavesApi();
    const t = useTranslate();
    // GameShell below disposes this manager (Invariant #21); the hook only builds.
    const assetManager = useRendererGameAssetManager(loadedGame);
    // The §4.10 route-entry gate. It warms the SAME manifest GameShell's own arm
    // warms — every ref after the first resolves through the manager's cache —
    // and the answer is what the reveal below waits on. `sceneRequiredAssets`
    // travels on the snapshot because a route entered on an already-committed
    // scene has no other channel to that scene's declaration (Invariant #52).
    const criticalAssets = useCriticalAssetPreloadGate(
        assetManager,
        loadedGame?.assetManifest,
        snapshot?.sceneRequiredAssets,
    );
    const sendActionToHost = useSendAction();
    const sendAction = React.useCallback(
        (action: EngineAction): void => {
            // A spectator is a read-only session viewer (Invariant #114): it has
            // no seat, so any action it could produce is structurally invalid.
            // Gate the single renderer choke point so both the keyboard handlers
            // and the HUD callbacks are inert in one place.
            if (isSpectator) {
                return;
            }
            // A resolved match stops GAMEPLAY, not the scene lifecycle. A
            // transition can be in flight when `gameResult` lands, and its ack
            // — dispatched from inside the shell by `useFadeTransition` — comes
            // through this same wrapper, so dropping it here strands the host
            // waiting on an ack no other code path sends. The pipeline's own
            // gate reads the same predicate.
            if (
                snapshot !== null &&
                isTerminalSnapshot(snapshot) &&
                !isSceneTransitionCompletionAction(action.type)
            ) {
                return;
            }

            const actionTick = typeof currentTick === 'number' ? currentTick : action.tick;
            sendActionToHost({ ...action, tick: actionTick });
        },
        [currentTick, isSpectator, sendActionToHost, snapshot],
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
            // /saves has no mount fade-in of its own, so whoever leaves /game
            // owes it a transparent scrim — and an abort can land anywhere in
            // the beat, including on its held black. Asked of the curtain
            // rather than tracked: `leavingRef` above already stopped the beat
            // issuing anything, so what is left is whatever it had reached.
            const curtain = fadeRef.current;
            if (curtain !== null && curtain !== undefined && curtain.opacity > 0) {
                void curtain.fadeIn(screenFadeMs());
            }
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

    // Whether GameShell can MOUNT: snapshot + game + manager all present. It is
    // deliberately the same predicate as the two early returns below, and the
    // preload term is deliberately NOT in it — a preload gates a REVEAL, never a
    // mount, because GameShell is the unique disposer of the manager this route
    // injects (Invariant #21) and a withheld mount would orphan it.
    const shellReady =
        snapshot !== null && gameId !== null && loadedGame !== null && assetManager !== null;
    // Whether the game may be SHOWN. The restore release is not an optimisation:
    // RestoreWaitingOverlay is a Modal at --ch-z-modal, below both the scrim at
    // --ch-z-screen-fade and the cover at --ch-z-loading-hud, so holding the
    // reveal through a restore wait hides the only control that can abort it.
    const sceneReady = shellReady && (criticalAssets.ready || restoreWaiting);

    // The loading beat (§4.36). What it replaced conditioned the cover on being
    // VISIBLE, and the only lever that could make it visible was easing the
    // entry scrim off — which is what hides the scene, so the cover could never
    // be shown without showing the scene with it. The beat inverts that: the
    // curtain is HELD black for the whole wait and an opaque cover rises above
    // it, so the sequence is black, the loading screen alone, black, then the
    // scene and its HUD together.
    //
    // Arming is on a RESOLVED cover, not on a visible one, so a gate that
    // settles before the first frame still gets the beat — the case the
    // previous shape could not serve at all on fast hardware.
    const registry = loadedGame?.registry;
    const routeCoverDeclared =
        registry !== undefined && snapshot !== null && isRouteCoverGameDeclared(registry, snapshot);
    const beatFloorMs = registry === undefined ? 0 : resolveLoadingBeatFloorMs(registry);
    // A screen whose chunk is still in flight is part of the wait: revealing on
    // the asset gate alone would land the player on the Suspense fallback.
    const [scenePending, setScenePending] = React.useState(false);
    const beat = useLoadingBeat({
        curtain: fade,
        active: shellReady,
        declared: routeCoverDeclared,
        settled: sceneReady && !scenePending,
        holdMs: beatFloorMs,
        fadeMs: screenFadeMs(),
        // A waiting restore must surface its abortable overlay, which sits at
        // --ch-z-modal — below both the curtain and the cover. Nothing cosmetic
        // gets to hide the only control that can abort it.
        shortCircuit: restoreWaiting,
        // Read when a command would fire, not when the render that scheduled it
        // ran: `leavingRef` is a ref, and both suppressors mean another owner
        // has taken the screen.
        isSuppressed: () => leavingRef.current || snapshot?.phase === 'lobby',
    });
    // What SceneRouter cannot derive (its inner FadeProvider shadows the
    // app-level fade): something opaque sits above the shell's own covers —
    // this route's cover, or the curtain it rises out of — until the beat
    // reveals.
    const sceneCoverOccluded = !beat.revealed;

    // The entry's fades are the beat's own legs now — the two effects that used
    // to share a latch here are gone with the grace that needed the second one.

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
    // here — `gameId` derives from it and is guarded above. A spectator is never
    // host: it follows a seat's projection, so a host-following spectator has
    // `viewerId === hostId` — the role must override the id match (Invariant #114).
    const isHost =
        !isSpectator && lobbyState !== null && lobbyState.info.hostId === resolvedPlayerId;

    // In-game save. Built ONLY for the host so GameShell never offers the
    // saveGame capability to a joined client (Invariant #25 — main-side
    // captureSaveFile rejects non-hosted sessions regardless, defense in depth).
    // A blank name omits `label` so SaveManager default naming applies. Toast
    // titles are static literals carrying no save metadata (Invariant #74).
    const handleSaveGame = async (label: string): Promise<void> => {
        try {
            await savesApi.save({ gameId, ...(label === '' ? {} : { label }) });
            useToastStore.getState().push({ severity: 'success', title: t(TOAST_KEYS.gameSaved) });
        } catch {
            useToastStore.getState().push({ severity: 'error', title: t(TOAST_KEYS.saveFailed) });
        }
    };

    return (
        <>
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
                isSpectator={isSpectator}
                {...(process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1'
                    ? { fadeOutMs: 0, fadeInMs: 0 }
                    : {})}
                sceneCoverOccluded={sceneCoverOccluded}
                hudMounted={beat.revealed}
                revealPhase={beat.phase}
                onScenePending={setScenePending}
                onUndo={() =>
                    dispatchGameAction(snapshot, resolvedPlayerId, 'engine:undo', { steps: 1 })
                }
                onRedo={() =>
                    dispatchGameAction(snapshot, resolvedPlayerId, 'engine:redo', { steps: 1 })
                }
                onEndTurn={() =>
                    dispatchGameAction(snapshot, resolvedPlayerId, 'engine:end_turn', {})
                }
                {...(isHost ? { onSaveGame: handleSaveGame } : {})}
            />
            {/*
             * A SIBLING of the shell, not a wrapper around it: the shell has to
             * mount for its manager to be disposed (Invariant #21), so what the
             * beat withholds is the sight of it. Mounted and dropped on fixed
             * timers on every settle path, because a cover left standing at
             * --ch-z-loading-hud sits above every modal and toast for the rest
             * of the match.
             */}
            {beat.coverMounted ? (
                <LoadingBeatCover
                    registry={loadedGame.registry}
                    snapshot={snapshot}
                    surface="route"
                    visible={beat.coverVisible}
                    fadeMs={screenFadeMs()}
                />
            ) : null}
        </>
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
