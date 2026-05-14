'use client';

// renderer/components/shell/MatchShell.tsx

import React, { type ReactNode } from 'react';
import type { MatchResult, PlayerId, PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import type { AssetManifest } from '@chimera/simulation/content/AssetManifest.js';
import type { ContentDatabase } from '@chimera/simulation/content/index.js';
import {
    resolveMatchResultOutcome,
    type GameHudProps,
    type GameScreenComponent,
    type GameScreenRegistry,
    type MatchResultBannerProps,
    type SendAction,
} from '@chimera/shared/game-screen-contract.js';
import { createAssetManager, type AssetManager } from '../../assets/AssetManager';
import { AssetManagerContext } from '../../assets/AssetManagerContext.js';
import type { AssetResolver } from '../../assets/AssetResolver';
import { SceneRouter } from '../scene/SceneRouter.js';
import { ContentDatabaseProvider } from './ContentDatabaseContext.js';
import { FadeProvider } from './FadeContext.js';

interface MatchShellBaseProps {
    readonly children?: ReactNode;
    readonly tick: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly canEndTurn?: boolean;
    readonly isGameOver?: boolean;
    readonly gameOverMessage?: string;
    readonly matchResult?: MatchResult | null;
    readonly matchResultBanner?: GameScreenComponent<MatchResultBannerProps>;
    readonly localPlayerId?: PlayerId;
    readonly onUndo?: () => void | Promise<void>;
    readonly onRedo?: () => void | Promise<void>;
    readonly onEndTurn?: () => void | Promise<void>;
}

interface MatchShellDefaultHudProps extends MatchShellBaseProps {
    readonly hud?: undefined;
    readonly snapshot?: PlayerSnapshot;
    readonly sendAction?: SendAction;
}

interface MatchShellGameHudProps extends MatchShellBaseProps {
    readonly hud: GameScreenComponent<GameHudProps>;
    readonly snapshot: PlayerSnapshot;
    readonly sendAction: SendAction;
}

interface MatchShellRegistryProps {
    readonly registry: GameScreenRegistry;
    readonly snapshot: PlayerSnapshot;
    readonly currentTick?: number;
    readonly sendAction: SendAction;
    readonly localPlayerId?: PlayerId;
    readonly assetManager?: AssetManager;
    readonly assetManifest?: AssetManifest;
    readonly contentDatabase?: ContentDatabase | null;
    readonly canEndTurn?: boolean;
    readonly fadeOutMs?: number;
    readonly fadeInMs?: number;
    readonly onUndo?: () => void | Promise<void>;
    readonly onRedo?: () => void | Promise<void>;
    readonly onEndTurn?: () => void | Promise<void>;
}

export type MatchShellProps =
    | MatchShellDefaultHudProps
    | MatchShellGameHudProps
    | MatchShellRegistryProps;

export function MatchShell(props: MatchShellProps): React.ReactElement {
    if ('registry' in props) {
        return <RegistryMatchShell {...props} />;
    }

    return <MatchShellFrame {...props} />;
}

function RegistryMatchShell({
    registry,
    snapshot,
    currentTick,
    sendAction,
    localPlayerId,
    assetManager,
    assetManifest,
    contentDatabase = null,
    canEndTurn,
    fadeOutMs,
    fadeInMs,
    onUndo,
    onRedo,
    onEndTurn,
}: MatchShellRegistryProps): React.ReactElement {
    const resolvedAssetManager = useMatchAssetManager(assetManager, assetManifest);

    return (
        <AssetManagerContext.Provider value={resolvedAssetManager}>
            <ContentDatabaseProvider value={contentDatabase}>
                <FadeProvider>
                    <MatchShellFrame
                        tick={currentTick ?? snapshot.tick}
                        canUndo={snapshot.undoMeta.canUndo}
                        canRedo={snapshot.undoMeta.canRedo}
                        canEndTurn={canEndTurn ?? snapshot.isMyTurn}
                        snapshot={snapshot}
                        sendAction={sendAction}
                        matchResult={snapshot.matchResult}
                        isGameOver={snapshot.phase === 'ended'}
                        {...(registry.hud === undefined ? {} : { hud: registry.hud })}
                        {...(registry.matchResultBanner === undefined
                            ? {}
                            : { matchResultBanner: registry.matchResultBanner })}
                        {...(localPlayerId === undefined ? {} : { localPlayerId })}
                        {...(onUndo === undefined ? {} : { onUndo })}
                        {...(onRedo === undefined ? {} : { onRedo })}
                        {...(onEndTurn === undefined ? {} : { onEndTurn })}
                    >
                        <SceneRouter
                            registry={registry}
                            snapshot={snapshot}
                            sendAction={sendAction}
                            {...(localPlayerId === undefined ? {} : { localPlayerId })}
                            {...(fadeOutMs === undefined ? {} : { fadeOutMs })}
                            {...(fadeInMs === undefined ? {} : { fadeInMs })}
                        />
                    </MatchShellFrame>
                </FadeProvider>
            </ContentDatabaseProvider>
        </AssetManagerContext.Provider>
    );
}

function useMatchAssetManager(
    injectedAssetManager: AssetManager | undefined,
    assetManifest: AssetManifest | undefined,
): AssetManager {
    const assetManager = React.useMemo(
        () => injectedAssetManager ?? createAssetManager(createUnconfiguredAssetResolver()),
        [injectedAssetManager],
    );

    React.useEffect(() => {
        if (assetManifest !== undefined) {
            assetManager.registerManifest(assetManifest);
        }
    }, [assetManager, assetManifest]);

    React.useEffect(() => {
        return () => {
            assetManager.dispose();
        };
    }, [assetManager]);

    return assetManager;
}

function createUnconfiguredAssetResolver(): AssetResolver {
    return {
        resolve(): string {
            throw new Error(
                'AssetResolver is not configured for this match; inject an AssetManager into MatchShell.',
            );
        },
    };
}

function MatchShellFrame(
    props: MatchShellDefaultHudProps | MatchShellGameHudProps,
): React.ReactElement {
    const {
        children,
        tick,
        canUndo,
        canRedo,
        canEndTurn = true,
        isGameOver = false,
        gameOverMessage = 'Game Over',
        matchResult,
        matchResultBanner: MatchResultBanner = DefaultMatchResultBanner,
        localPlayerId,
        onUndo,
        onRedo,
        onEndTurn,
    } = props;
    const undoDisabled = !canUndo || onUndo === undefined;
    const redoDisabled = !canRedo || onRedo === undefined;
    const endTurnDisabled = !canEndTurn || onEndTurn === undefined;
    const shouldShowResolvedResult = matchResult !== undefined && matchResult !== null;
    const shouldShowFallbackResult = !shouldShowResolvedResult && isGameOver;

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

    const hud =
        props.hud === undefined ? (
            <DefaultMatchHud
                tick={tick}
                undoDisabled={undoDisabled}
                redoDisabled={redoDisabled}
                endTurnDisabled={endTurnDisabled}
                handleUndo={handleUndo}
                handleRedo={handleRedo}
                handleEndTurn={handleEndTurn}
            />
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
            />
        );

    return (
        <main aria-label="Match" style={matchShellRootStyle}>
            <section
                data-testid="match-canvas"
                aria-label="Match canvas"
                style={{ minHeight: '20rem', position: 'relative' }}
            >
                <React.Suspense fallback={null}>{children}</React.Suspense>
                {shouldShowResolvedResult && (
                    <React.Suspense fallback={null}>
                        <MatchResultBanner
                            matchResult={matchResult}
                            {...(localPlayerId === undefined ? {} : { localPlayerId })}
                        />
                    </React.Suspense>
                )}
                {shouldShowFallbackResult && <DefaultGameOverBanner message={gameOverMessage} />}
            </section>
            {hud}
        </main>
    );
}

interface MatchHudControlsProps {
    readonly tick: number;
    readonly undoDisabled: boolean;
    readonly redoDisabled: boolean;
    readonly endTurnDisabled: boolean;
    readonly handleUndo: () => void;
    readonly handleRedo: () => void;
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

function DefaultMatchHud({
    tick,
    undoDisabled,
    redoDisabled,
    endTurnDisabled,
    handleUndo,
    handleRedo,
    handleEndTurn,
}: MatchHudControlsProps): React.ReactElement {
    return (
        <footer aria-label="Match HUD" style={matchShellHudStyle}>
            <div>
                Tick <output data-testid="hud-tick">{tick}</output>
            </div>
            <div style={matchShellActionsStyle}>
                <button
                    data-testid="undo"
                    type="button"
                    disabled={undoDisabled}
                    onClick={handleUndo}
                >
                    Undo
                </button>
                <button
                    data-testid="redo"
                    type="button"
                    disabled={redoDisabled}
                    onClick={handleRedo}
                >
                    Redo
                </button>
                <button
                    data-testid="end-turn"
                    type="button"
                    disabled={endTurnDisabled}
                    onClick={handleEndTurn}
                >
                    End Turn
                </button>
            </div>
        </footer>
    );
}

const matchShellRootStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateRows: '1fr auto',
    minHeight: '100vh',
    fontFamily: 'var(--ch-font-ui)',
};

const matchShellHudStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--ch-space-md)',
    padding: 'var(--ch-space-sm) var(--ch-space-md)',
    borderTop: '1px solid var(--ch-color-border-default)',
};

const matchShellActionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--ch-space-xs)',
};

const matchResultBannerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 'var(--ch-space-md)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 'var(--ch-font-size-lg)',
    fontWeight: 700,
    pointerEvents: 'none',
};

function DefaultMatchResultBanner({
    matchResult,
    localPlayerId,
}: MatchResultBannerProps): React.ReactElement {
    const outcome = resolveMatchResultOutcome(matchResult, localPlayerId);

    return (
        <div
            data-testid="match-result-banner"
            data-match-result-outcome={outcome}
            role="status"
            style={matchResultBannerStyle}
        >
            <span data-testid="match-result-text">
                {resolveMatchResultMessage(matchResult, localPlayerId)}
            </span>
        </div>
    );
}

function DefaultGameOverBanner({ message }: { readonly message: string }): React.ReactElement {
    return (
        <div
            data-testid="match-result-banner"
            data-match-result-outcome="unknown"
            role="status"
            style={matchResultBannerStyle}
        >
            <span data-testid="match-result-text">{message}</span>
        </div>
    );
}

function resolveMatchResultMessage(
    matchResult: MatchResult,
    localPlayerId: PlayerId | undefined,
): string {
    if (matchResult.winnerIds.length === 0) {
        return 'Draw';
    }
    if (localPlayerId === undefined) {
        return 'Match ended';
    }
    return matchResult.winnerIds.includes(localPlayerId) ? 'You won' : 'You lose';
}

export type {
    GameHudProps,
    GameScreenProps,
    GameScreenRegistry,
    MatchResultBannerProps,
} from '@chimera/shared/game-screen-contract.js';
