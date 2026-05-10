'use client';

// renderer/components/shell/MatchShell.tsx

import React, { type ReactNode } from 'react';
import type { MatchResult, PlayerId } from '@chimera/electron/preload/api-types.js';
import {
    resolveMatchResultOutcome,
    type GameScreenComponent,
    type MatchResultBannerProps,
} from '@chimera/shared/game-screen-contract.js';

export interface MatchShellProps {
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

export function MatchShell({
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
}: MatchShellProps): React.ReactElement {
    const undoDisabled = !canUndo || onUndo === undefined;
    const redoDisabled = !canRedo || onRedo === undefined;
    const endTurnDisabled = !canEndTurn || onEndTurn === undefined;
    const shouldShowResolvedResult = matchResult !== undefined && matchResult !== null;
    const shouldShowFallbackResult = !shouldShowResolvedResult && isGameOver;

    function handleUndo(): void {
        if (onUndo !== undefined) {
            void onUndo();
        }
    }

    function handleRedo(): void {
        if (onRedo !== undefined) {
            void onRedo();
        }
    }

    function handleEndTurn(): void {
        if (onEndTurn !== undefined) {
            void onEndTurn();
        }
    }

    return (
        <main
            aria-label="Match"
            style={{
                display: 'grid',
                gridTemplateRows: '1fr auto',
                minHeight: '100vh',
                fontFamily: 'system-ui, sans-serif',
            }}
        >
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
            <footer
                aria-label="Match HUD"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    padding: '0.75rem 1rem',
                    borderTop: '1px solid #ddd',
                }}
            >
                <div>
                    Tick <output data-testid="hud-tick">{tick}</output>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
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
        </main>
    );
}

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
    GameScreenProps,
    GameScreenRegistry,
    MatchResultBannerProps,
} from '@chimera/shared/game-screen-contract.js';
