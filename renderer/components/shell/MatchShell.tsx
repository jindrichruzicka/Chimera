'use client';

// renderer/components/shell/MatchShell.tsx

import React, { type ReactNode } from 'react';
import type {
    EngineAction,
    PlayerId,
    PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';

export interface MatchShellProps {
    readonly children?: ReactNode;
    readonly tick: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly canEndTurn?: boolean;
    readonly isGameOver?: boolean;
    readonly gameOverMessage?: string;
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
    onUndo,
    onRedo,
    onEndTurn,
}: MatchShellProps): React.ReactElement {
    const undoDisabled = !canUndo || onUndo === undefined;
    const redoDisabled = !canRedo || onRedo === undefined;
    const endTurnDisabled = !canEndTurn || onEndTurn === undefined;

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
                {children}
                {isGameOver && (
                    <div
                        data-testid="game-over-banner"
                        role="status"
                        style={{
                            position: 'absolute',
                            inset: '1rem',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '1.25rem',
                            fontWeight: 700,
                            pointerEvents: 'none',
                        }}
                    >
                        {gameOverMessage}
                    </div>
                )}
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

export type SendAction = (action: EngineAction) => void;

export interface GameScreenProps {
    readonly snapshot: PlayerSnapshot;
    readonly localPlayerId?: PlayerId;
    readonly sendAction: SendAction;
}

export interface GameScreenRegistry {
    readonly board: React.ComponentType<GameScreenProps>;
    readonly hud?: React.ComponentType<GameScreenProps>;
    readonly screens?: Readonly<Record<string, React.ComponentType<GameScreenProps>>>;
    readonly transitionOverlay?: React.ComponentType<GameScreenProps>;
}
