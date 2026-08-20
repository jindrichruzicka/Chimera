'use client';

import React, { type ReactNode } from 'react';
import type {
    CommitmentReveal,
    GameResult,
    PlayerId,
    PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { ContentDatabase } from '@chimera-engine/simulation/content/index.js';
import {
    resolveGameResultOutcome,
    type GameHudProps,
    type GameScreenComponent,
    type GameScreenRegistry,
    type GameResultBannerProps,
    type SendAction,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import { GAME_RESULT_KEYS, GAME_SHELL_KEYS, HUD_KEYS } from '../../i18n/engine-keys.js';
import { useTranslate } from '../../i18n/useTranslate.js';
import type { TranslateFn } from '../../i18n/i18n-context.js';
import { createAssetManager, type AssetManager } from '../../assets/AssetManager';
import type { LeaveGame } from '../../bridge/useLeaveGame.js';
import { AssetManagerContext } from '../../assets/AssetManagerContext.js';
import type { AssetResolver } from '../../assets/AssetResolver';
import type { AudioManager } from '../../audio/AudioManager.js';
import { useAudioManager } from '../../audio/AudioManagerContext.js';
import { useSetGameAssetManager } from '../../assets/SetGameAssetManagerContext';
import { useCriticalAssetPreload } from '../../assets/criticalAssetPreload.js';
import type { InputAction } from '../../input/InputAction.js';
import { useInputActionRegistry } from '../../input/InputActionRegistryContext.js';
import { useActiveScreen } from '../../state/uiStore.js';
import { EventAudioPlayer } from '../audio/EventAudioPlayer.js';
import { SceneRouter } from '../scene/SceneRouter.js';
import { Button } from '../ui/Button.js';
import { ContentDatabaseProvider } from './ContentDatabaseContext.js';
import { DebugInspectorToggle } from './debug/DebugInspectorToggle.js';
import { FadeProvider } from './FadeContext.js';
import { InGameMenuHost } from './InGameMenuHost.js';
import { PerfHud } from './perf/PerfHud.js';
import { SpectatorHud } from './SpectatorHud.js';
import { TimeScaleBridge } from './TimeScaleBridge.js';

interface GameShellBaseProps {
    readonly children?: ReactNode;
    readonly tick: number;
    /**
     * Whether the match chrome may be mounted yet (§4.33). `false` withholds
     * the HUD row and the spectator HUD while a loading beat still owns the
     * screen, so a player never watches them assemble beside a loading screen.
     *
     * Withholds a MOUNT rather than hiding a mounted row: an invisible HUD
     * still runs its effects and still takes its grid row. What is NOT deferred
     * is the scene beneath it — the canvas warms up under the curtain, and
     * `GameShell` stays the unique disposer of a page-injected `AssetManager`
     * (Invariant #21) — nor the diagnostics overlays, which self-gate already.
     *
     * Expected to flip while the screen is still OPAQUE, not as it opens: the
     * row is a grid row of the layout below, so mounting it re-fits the canvas
     * beneath — and that re-fit lands two observer round-trips later, which on
     * a reveal is well inside the fade the player is watching. The loading
     * beat's `chromeMounted` is the term that satisfies this; `revealed` is not.
     *
     * Defaults to `true`, so a caller that knows nothing of the beat is
     * unchanged.
     */
    readonly hudMounted?: boolean;
    /**
     * The loading beat's phase, published as `data-reveal-phase` for the e2e
     * reveal timeline. Presentation-inert: nothing renders differently for it.
     */
    readonly revealPhase?: string;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly canEndTurn?: boolean;
    readonly isGameOver?: boolean;
    readonly gameOverMessage?: string;
    readonly gameResult?: GameResult | null;
    readonly gameResultBanner?: GameScreenComponent<GameResultBannerProps>;
    readonly localPlayerId?: PlayerId;
    /**
     * Passed through to the HUD as `GameHudProps.isHost`, and consulted by the
     * frame's `saveGame` withholding: an explicit `false` suppresses the
     * capability even when `onSaveGame` is wired (Invariant #25); absent means
     * "role unknown — treat as host".
     */
    readonly isHost?: boolean;
    /**
     * When true, the local session is a read-only spectator (Invariant #114):
     * the action controls (undo / redo / end-turn) are locked exactly like a
     * game-over, so the playfield is observable but inert. Absent means "player".
     */
    readonly isSpectator?: boolean;
    readonly onUndo?: () => void | Promise<void>;
    readonly onRedo?: () => void | Promise<void>;
    readonly onEndTurn?: () => void | Promise<void>;
    /**
     * Receives the trimmed save name when the HUD's save affordance confirms.
     * The frame synthesizes `GameHudProps.saveGame` from it — withheld entirely
     * (prop absent, not disabled) while controls are locked or when this
     * callback is missing (Invariant #25: non-hosts are never offered it).
     */
    readonly onSaveGame?: (label: string) => void | Promise<void>;
}

interface GameShellDefaultHudProps extends GameShellBaseProps {
    readonly hud?: undefined;
    readonly snapshot?: PlayerSnapshot;
    readonly sendAction?: SendAction;
}

interface GameShellGameHudProps extends GameShellBaseProps {
    readonly hud: GameScreenComponent<GameHudProps>;
    readonly snapshot: PlayerSnapshot;
    readonly sendAction: SendAction;
}

interface GameShellRegistryProps {
    readonly registry: GameScreenRegistry;
    readonly snapshot: PlayerSnapshot;
    readonly currentTick?: number;
    readonly sendAction: SendAction;
    readonly localPlayerId?: PlayerId;
    readonly assetManager?: AssetManager;
    readonly assetManifest?: AssetManifest;
    readonly inputActions?: readonly InputAction[];
    readonly contentDatabase?: ContentDatabase | null;
    /**
     * This game's content collections (§4.8), delivered to the playfield/screens as
     * the generic `GameScreenProps.content`. Game-agnostic plain data.
     */
    readonly content?: GameContent;
    /** Latest verified commitment-mode reveal, passed through to the playfield. */
    readonly reveal?: CommitmentReveal | null;
    /**
     * Whether the local player hosted the match; passed through to screens as
     * `GameScreenProps.isHost` (e.g. the post-game summary picks the deterministic
     * vs perspective replay to export).
     */
    readonly isHost?: boolean;
    /** See {@link GameShellBaseProps.isSpectator}; forwarded to the frame. */
    readonly isSpectator?: boolean;
    readonly canEndTurn?: boolean;
    /**
     * Overrides the in-game menu's leave action (see {@link InGameMenuHost}).
     * Omitted for a live match (the role-aware live leave is used); the replay
     * player injects its own context-aware leave.
     */
    readonly leaveGame?: LeaveGame;
    readonly fadeOutMs?: number;
    readonly fadeInMs?: number;
    /**
     * True while an outer cover or the opaque app-level scrim sits above this
     * shell — threaded through to `SceneRouter`, whose minimum-visible hold
     * must not arm for a cover nobody saw (§4.36). The shell cannot derive it:
     * the route cover's state is page-local, and the inner `FadeProvider`
     * mounted below shadows the app-level fade context.
     */
    readonly sceneCoverOccluded?: boolean;
    /** See {@link GameShellBaseProps.hudMounted}; forwarded to the frame. */
    readonly hudMounted?: boolean;
    /**
     * Whether the in-game menu host may mount — the Escape-bearing chrome,
     * gated apart from the HUD row above because its concern is a KEY rather
     * than a paint. The row wants to mount early, while the screen is opaque,
     * so its layout change happens out of view; the menu must not, because an
     * Escape-stack layer under a screen the player cannot see swallows the key
     * without showing a menu. The loading beat's `revealed` is the term that
     * satisfies this.
     *
     * Defaults to {@link GameShellRegistryProps.hudMounted}, so a caller that
     * knows only the one gate keeps the behaviour it had.
     */
    readonly menuMounted?: boolean;
    /** See {@link GameShellBaseProps.revealPhase}; forwarded to the frame. */
    readonly revealPhase?: string;
    /**
     * Called when a code-split screen starts or stops suspending below, so a
     * loading beat can fold that wait into its own settle term — a reveal that
     * ignored it would land on the fallback rather than on the screen.
     *
     * Only transitions are reported, so a consumer starts from "not pending"
     * itself. Forwarded to `SceneRouter`, where the reporting is done.
     */
    readonly onScenePending?: (pending: boolean) => void;
    readonly onUndo?: () => void | Promise<void>;
    readonly onRedo?: () => void | Promise<void>;
    readonly onEndTurn?: () => void | Promise<void>;
    /** See {@link GameShellBaseProps.onSaveGame}; forwarded to the frame. */
    readonly onSaveGame?: (label: string) => void | Promise<void>;
}

export type GameShellProps =
    | GameShellDefaultHudProps
    | GameShellGameHudProps
    | GameShellRegistryProps;

export function GameShell(props: GameShellProps): React.ReactElement {
    if ('registry' in props) {
        return <RegistryGameShell {...props} />;
    }

    return <GameShellFrame {...props} />;
}

function RegistryGameShell({
    registry,
    snapshot,
    currentTick,
    sendAction,
    localPlayerId,
    assetManager,
    assetManifest,
    inputActions,
    contentDatabase = null,
    content,
    reveal,
    isHost,
    isSpectator,
    canEndTurn,
    leaveGame,
    fadeOutMs,
    fadeInMs,
    sceneCoverOccluded,
    hudMounted,
    menuMounted,
    revealPhase,
    onScenePending,
    onUndo,
    onRedo,
    onEndTurn,
    onSaveGame,
}: GameShellRegistryProps): React.ReactElement {
    const resolvedAssetManager = useGameAssetManager(assetManager, assetManifest);
    const eventAudioBinding = registry.eventAudioBinding;
    const audioManager = useAudioManager();
    const isGameEnded = snapshot.phase === 'ended';

    useRegisterInputActions(inputActions);
    useStopAudioOnGameEnd(audioManager, isGameEnded);

    const gameShell = (
        <AssetManagerContext.Provider value={resolvedAssetManager}>
            {/*
             * Mounted here, inside the one expression BOTH return paths below
             * return, rather than beside <EventAudioPlayer> in the fragment only
             * the second path builds: a game that declares no eventAudioBinding
             * — the blank scaffold included — would otherwise never mount the
             * bridge, and authoritative dilation would be dead for it while the
             * host ticker still re-paced the match. One mount site makes that
             * miss structurally impossible.
             */}
            <TimeScaleBridge permille={snapshot.timeScalePermille} />
            <ContentDatabaseProvider value={contentDatabase}>
                <FadeProvider>
                    <GameShellFrame
                        tick={currentTick ?? snapshot.tick}
                        canUndo={snapshot.undoMeta.canUndo}
                        canRedo={snapshot.undoMeta.canRedo}
                        canEndTurn={canEndTurn ?? snapshot.isMyTurn}
                        snapshot={snapshot}
                        sendAction={sendAction}
                        gameResult={snapshot.gameResult}
                        isGameOver={snapshot.phase === 'ended'}
                        {...(registry.hud === undefined ? {} : { hud: registry.hud })}
                        {...(registry.gameResultBanner === undefined
                            ? {}
                            : { gameResultBanner: registry.gameResultBanner })}
                        {...(localPlayerId === undefined ? {} : { localPlayerId })}
                        {...(isHost === undefined ? {} : { isHost })}
                        {...(isSpectator === undefined ? {} : { isSpectator })}
                        {...(hudMounted === undefined ? {} : { hudMounted })}
                        {...(revealPhase === undefined ? {} : { revealPhase })}
                        {...(onUndo === undefined ? {} : { onUndo })}
                        {...(onRedo === undefined ? {} : { onRedo })}
                        {...(onEndTurn === undefined ? {} : { onEndTurn })}
                        {...(onSaveGame === undefined ? {} : { onSaveGame })}
                    >
                        <SceneRouter
                            registry={registry}
                            snapshot={snapshot}
                            sendAction={sendAction}
                            {...(localPlayerId === undefined ? {} : { localPlayerId })}
                            {...(content === undefined ? {} : { content })}
                            {...(reveal === undefined ? {} : { reveal })}
                            {...(isHost === undefined ? {} : { isHost })}
                            {...(fadeOutMs === undefined ? {} : { fadeOutMs })}
                            {...(fadeInMs === undefined ? {} : { fadeInMs })}
                            {...(assetManifest === undefined ? {} : { assetManifest })}
                            {...(sceneCoverOccluded === undefined ? {} : { sceneCoverOccluded })}
                            {...(onScenePending === undefined ? {} : { onScenePending })}
                        />
                    </GameShellFrame>
                    {/*
                     * Withheld PAST the HUD row, on its own gate. An Escape-
                     * stack layer mounted under an opaque loading screen would
                     * swallow the key without showing a menu, and the row above
                     * mounts while the screen is still exactly that — opaque —
                     * so that its grid change re-fits the canvas out of view.
                     * `?? hudMounted` keeps the pair moving together for a
                     * caller that supplies only the row's gate.
                     */}
                    {(menuMounted ?? hudMounted) !== false && (
                        <InGameMenuHost
                            {...(registry.inGameMenu === undefined
                                ? {}
                                : { inGameMenu: registry.inGameMenu })}
                            {...(isHost === undefined ? {} : { isHost })}
                            {...(localPlayerId === undefined ? {} : { localPlayerId })}
                            {...(leaveGame === undefined ? {} : { leaveGame })}
                        />
                    )}
                </FadeProvider>
            </ContentDatabaseProvider>
        </AssetManagerContext.Provider>
    );

    if (eventAudioBinding === undefined) {
        return gameShell;
    }

    return (
        <>
            {gameShell}
            <EventAudioPlayer binding={eventAudioBinding} />
        </>
    );
}

function useGameAssetManager(
    injectedAssetManager: AssetManager | undefined,
    assetManifest: AssetManifest | undefined,
): AssetManager {
    // SetGameAssetManagerContext is provided by Providers and allows GameShell to wire the
    // game-level AssetManager into the app-level DelegatingAssetManager so the AudioManager
    // (which is app-level) can load game-specific audio assets. Registry-mode GameShell always
    // runs under Providers, so the throwing hook (Invariant #83) makes a missing provider a
    // loud error rather than a silent no-op; tests mount the provider via the shell wrapper.
    const setGameAssetManager = useSetGameAssetManager();

    // Manifest at CONSTRUCTION — see createAssetManager's JSDoc for why every
    // alternative registration point fails. A manifest identity change
    // rebuilds the fallback manager (the old one is disposed by the effect
    // below); an injected manager is never rebuilt here.
    const assetManager = React.useMemo(
        () =>
            injectedAssetManager ??
            createAssetManager(createUnconfiguredAssetResolver(), assetManifest),
        [injectedAssetManager, assetManifest],
    );

    // Backstop only: for an INJECTED manager the injector owns registration
    // (the pages construct with the manifest), and this re-registration is
    // idempotent because registerManifest retains entries that
    // assetManifestEntryEquivalent judges unchanged. Sharp edge, deliberately
    // not fixed here: that equivalence compares metadata by JSON.stringify,
    // so identical metadata with a different key ORDER evicts and disposes.
    React.useEffect(() => {
        if (assetManifest !== undefined) {
            assetManager.registerManifest(assetManifest);
        }
    }, [assetManager, assetManifest]);

    // What makes `priority: 'critical'` mean anything for a match (§4.10): the
    // entries a game marked critical are warmed here so the first thing that
    // needs one is served from cache rather than from a fetch+decode it has to
    // wait out. Non-blocking — the match renders while it runs — and it is the
    // manager's own priority filter that decides what loads, so a manifest of
    // purely deferred entries costs one no-op call. See the hook for why it
    // cannot move into `createAssetManager` beside the manifest registration.
    useCriticalAssetPreload(assetManager, assetManifest);

    // Register the game AssetManager as the active delegate for the app-level AudioManager.
    //
    // Registered during RENDER, for the reason createAssetManager's JSDoc gives about
    // the manifest: React flushes passive mount effects CHILDREN-FIRST, so a delegate
    // registered only in the effect below arrives after a screen that loads in its own
    // mount effect has already asked for its asset. A music bed is exactly that shape —
    // `useSound` plays on mount, and the play resolves its clip through the app-level
    // delegating manager (Invariant #64), which with no delegate rejects
    // NoActiveGameSessionError. `AudioManager.play` swallows a rejected load, so the bed
    // is simply silent, with nothing in the log.
    //
    // A screen mounted behind React.lazy hides this on the FIRST match of a session: the
    // suspense lands it a commit late, by which time the effect has run. The payload is
    // resolved for every match after that, so the screen mounts in GameShell's own commit
    // and the bed never starts — which is what made this a second-match bug rather than a
    // permanent one.
    //
    // Unlike the manifest registration the JSDoc rules out, this touches no state on the
    // shared, already-committed delegating manager: it swaps one pointer, evicting and
    // disposing nothing, and a discarded render is corrected by the next committed one —
    // this runs on every render, not once.
    setGameAssetManager(assetManager);

    // The effect is what OWNS the binding across a mount's whole life. It re-registers
    // rather than merely cleaning up, because StrictMode's simulated remount runs
    // cleanup → setup with no render between them: without the setup call, the delegate
    // would be left null for the rest of the mount.
    React.useEffect(() => {
        setGameAssetManager(assetManager);
        return () => {
            setGameAssetManager(null);
        };
    }, [assetManager, setGameAssetManager]);

    // Session-end disposal (Invariant #21): GameShell is the unique disposer
    // of a match-level manager, injected or fallback. The dispose is deferred
    // by one microtask and cancelled when this effect re-runs for the SAME
    // manager: StrictMode's simulated mount→unmount→mount runs the cleanup
    // between the two mounts, so an immediate dispose here would empty the
    // manifest out from under the second mount's children-first loads — and
    // destroy a page-injected manager the page still holds. A real unmount has
    // no re-run, so the microtask disposes exactly once; a manifest-identity
    // rebuild re-runs with a DIFFERENT manager, so the old manager's scheduled
    // dispose proceeds. The cancellation window is safe because React runs the
    // cleanup and the re-run synchronously in one passive-effect flush, which
    // no microtask can interleave.
    const pendingDisposeRef = React.useRef<PendingAssetManagerDispose | null>(null);
    React.useEffect(() => {
        const pending = pendingDisposeRef.current;
        if (pending !== null && pending.assetManager === assetManager) {
            pending.cancelled = true;
        }
        return () => {
            const scheduled: PendingAssetManagerDispose = { assetManager, cancelled: false };
            pendingDisposeRef.current = scheduled;
            queueMicrotask(() => {
                if (!scheduled.cancelled) {
                    assetManager.dispose();
                }
            });
        };
    }, [assetManager]);

    return assetManager;
}

interface PendingAssetManagerDispose {
    readonly assetManager: AssetManager;
    cancelled: boolean;
}

function useStopAudioOnGameEnd(audioManager: AudioManager, isGameEnded: boolean): void {
    React.useEffect(() => {
        if (!isGameEnded) {
            return;
        }

        audioManager.stopAll();
    }, [audioManager, isGameEnded]);
}

function useRegisterInputActions(inputActions: readonly InputAction[] | undefined): void {
    const inputActionRegistry = useInputActionRegistry();

    React.useEffect(() => {
        if (inputActions === undefined) {
            return;
        }

        for (const action of inputActions) {
            if (inputActionRegistry.has(action.id)) {
                assertSameInputAction(inputActionRegistry.get(action.id), action);
                continue;
            }

            inputActionRegistry.register(action);
        }
    }, [inputActionRegistry, inputActions]);
}

function assertSameInputAction(existing: InputAction, next: InputAction): void {
    if (
        existing.description !== next.description ||
        existing.category !== next.category ||
        existing.oneShot !== next.oneShot
    ) {
        throw new Error(`Input action '${next.id}' is already registered with different metadata.`);
    }
}

function createUnconfiguredAssetResolver(): AssetResolver {
    return {
        resolve(): string {
            throw new Error(
                'AssetResolver is not configured for this game; inject an AssetManager into GameShell.',
            );
        },
    };
}

function GameShellFrame(
    props: GameShellDefaultHudProps | GameShellGameHudProps,
): React.ReactElement {
    const {
        children,
        tick,
        canUndo,
        canRedo,
        canEndTurn = true,
        isGameOver = false,
        gameOverMessage,
        gameResult,
        gameResultBanner: GameResultBanner = DefaultGameResultBanner,
        localPlayerId,
        isHost,
        isSpectator = false,
        hudMounted = true,
        revealPhase,
        onUndo,
        onRedo,
        onEndTurn,
        onSaveGame,
    } = props;
    const t = useTranslate();
    // The result banner is an overlay on the live playfield. Once the player advances
    // to another screen (e.g. the post-game summary), suppress it so it does not
    // float on top of that screen. Control-lock semantics are unaffected.
    const activeScreenKey = useActiveScreen();
    const onPlayfieldScreen = activeScreenKey === 'playfield';
    const hasResolvedResult = gameResult !== undefined && gameResult !== null;
    const shouldShowResolvedResult = hasResolvedResult && onPlayfieldScreen;
    const shouldShowFallbackResult = !hasResolvedResult && isGameOver && onPlayfieldScreen;
    // A spectator locks the action controls exactly like game-over — the playfield
    // is observable but inert (Invariant #114); dispatch is separately gated at
    // the route's sendAction wrapper (defense in depth).
    const controlsLocked = isGameOver || hasResolvedResult || isSpectator;
    const undoDisabled = controlsLocked || !canUndo || onUndo === undefined;
    const redoDisabled = controlsLocked || !canRedo || onRedo === undefined;
    const endTurnDisabled = controlsLocked || !canEndTurn || onEndTurn === undefined;

    function handleUndo(): void {
        if (!undoDisabled && onUndo !== undefined) {
            void onUndo();
        }
    }

    function handleRedo(): void {
        if (!redoDisabled && onRedo !== undefined) {
            void onRedo();
        }
    }

    function handleEndTurn(): void {
        if (!endTurnDisabled && onEndTurn !== undefined) {
            void onEndTurn();
        }
    }

    // Unlike undo/redo/end-turn there is no disabled pair: the capability is
    // WITHHELD (prop absent) when unavailable — Invariant #25. An explicit
    // isHost === false withholds it even if a caller wrongly wires onSaveGame
    // for a client; an absent isHost means "role unknown — treat as host"
    // (GameScreenProps contract). DefaultGameHud deliberately renders no save
    // affordance; games opt in via their registry HUD (e.g. with the ui
    // barrel's SaveGameButton).
    const saveGame =
        controlsLocked || onSaveGame === undefined || isHost === false
            ? undefined
            : (label: string): void => {
                  void onSaveGame(label);
              };

    const hud =
        props.hud === undefined ? (
            <DefaultGameHud endTurnDisabled={endTurnDisabled} handleEndTurn={handleEndTurn} />
        ) : (
            <GameHudSlot
                Hud={props.hud}
                snapshot={props.snapshot}
                sendAction={props.sendAction}
                tick={tick}
                undoDisabled={undoDisabled}
                redoDisabled={redoDisabled}
                endTurnDisabled={endTurnDisabled}
                handleUndo={handleUndo}
                handleRedo={handleRedo}
                handleEndTurn={handleEndTurn}
                {...(localPlayerId === undefined ? {} : { localPlayerId })}
                {...(isHost === undefined ? {} : { isHost })}
                {...(saveGame === undefined ? {} : { saveGame })}
            />
        );

    return (
        <main
            data-testid="game-shell-root"
            aria-label={t(GAME_SHELL_KEYS.mainAriaLabel)}
            style={gameShellRootStyle}
            {...(revealPhase === undefined ? {} : { 'data-reveal-phase': revealPhase })}
        >
            <section
                data-testid="game-canvas"
                aria-label={t(GAME_SHELL_KEYS.canvasAriaLabel)}
                style={{ minHeight: 'calc(var(--ch-space-md) * 20)', position: 'relative' }}
            >
                <React.Suspense fallback={null}>{children}</React.Suspense>
                {shouldShowResolvedResult && (
                    <React.Suspense fallback={null}>
                        <GameResultBanner
                            gameResult={gameResult}
                            {...(localPlayerId === undefined ? {} : { localPlayerId })}
                        />
                    </React.Suspense>
                )}
                {shouldShowFallbackResult && (
                    <DefaultGameOverBanner
                        message={gameOverMessage ?? t(GAME_RESULT_KEYS.gameOver)}
                    />
                )}
            </section>
            {/* A wrapper so the row has one thing to mount, unmount and locate. */}
            {hudMounted && <div data-testid="game-hud-slot">{hud}</div>}
            <PerfHud />
            {/*
             * Match chrome, so it is withheld with the row above — but left in
             * its own place in the tree rather than moved inside the wrapper.
             * It and `PerfHud` are both fixed at the same z-index, where paint
             * order is tree order, so moving it would put one on top of the
             * other where they overlap.
             */}
            {hudMounted && <SpectatorHud />}
            <DebugInspectorToggle />
        </main>
    );
}

interface GameHudControlsProps {
    readonly endTurnDisabled: boolean;
    readonly handleEndTurn: () => void;
}

interface GameHudSlotProps extends GameHudProps {
    readonly Hud: GameScreenComponent<GameHudProps>;
}

function GameHudSlot({ Hud, ...hudProps }: GameHudSlotProps): React.ReactElement {
    return (
        <React.Suspense fallback={null}>
            <Hud {...hudProps} />
        </React.Suspense>
    );
}

function DefaultGameHud({
    endTurnDisabled,
    handleEndTurn,
}: GameHudControlsProps): React.ReactElement {
    const t = useTranslate();
    // The engine default HUD ships only End Turn. Undo/redo are opt-in: many
    // games have no undo (or no redo), so surfacing them by default would imply
    // a capability the game may not support. A game that wants them contributes
    // its own HUD (GameScreenRegistry.hud) — the undo/redo props still flow to it
    // via GameHudProps (see the tactics HUD).
    return (
        <footer aria-label={t(GAME_SHELL_KEYS.hudAriaLabel)} style={gameShellHudStyle}>
            <div style={gameShellActionsStyle}>
                <Button
                    data-testid="end-turn"
                    variant="secondary"
                    size="sm"
                    disabled={endTurnDisabled}
                    onClick={handleEndTurn}
                >
                    {t(HUD_KEYS.endTurn)}
                </Button>
            </div>
        </footer>
    );
}

const gameShellRootStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateRows: '1fr auto',
    minHeight: '100vh',
    fontFamily: 'var(--ch-font-ui)',
};

const gameShellHudStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 'var(--ch-space-md)',
    padding: 'var(--ch-space-sm) var(--ch-space-md)',
    borderTop: 'var(--ch-border-width-sm) solid var(--ch-color-border)',
};

const gameShellActionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--ch-space-xs)',
};

const gameResultBannerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 'var(--ch-space-md)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 'var(--ch-font-size-lg)',
    fontWeight: 'var(--ch-font-weight-bold)',
    pointerEvents: 'none',
};

function DefaultGameResultBanner({
    gameResult,
    localPlayerId,
}: GameResultBannerProps): React.ReactElement {
    const t = useTranslate();
    const outcome = resolveGameResultOutcome(gameResult, localPlayerId);

    return (
        <div
            data-testid="game-result-banner"
            data-game-result-outcome={outcome}
            role="status"
            style={gameResultBannerStyle}
        >
            <span data-testid="game-result-text">
                {resolveGameResultMessage(t, gameResult, localPlayerId)}
            </span>
        </div>
    );
}

function DefaultGameOverBanner({ message }: { readonly message: string }): React.ReactElement {
    return (
        <div
            data-testid="game-result-banner"
            data-game-result-outcome="unknown"
            role="status"
            style={gameResultBannerStyle}
        >
            <span data-testid="game-result-text">{message}</span>
        </div>
    );
}

function resolveGameResultMessage(
    t: TranslateFn,
    gameResult: GameResult,
    localPlayerId: PlayerId | undefined,
): string {
    if (gameResult.winnerIds.length === 0) {
        return t(GAME_RESULT_KEYS.draw);
    }
    if (localPlayerId === undefined) {
        return t(GAME_RESULT_KEYS.ended);
    }
    return gameResult.winnerIds.includes(localPlayerId)
        ? t(GAME_RESULT_KEYS.won)
        : t(GAME_RESULT_KEYS.lose);
}

export type {
    GameHudProps,
    GameScreenProps,
    GameScreenRegistry,
    GameResultBannerProps,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
