'use client';

import React from 'react';
import type { GameHudProps } from '@chimera/shared/game-screen-contract.js';

export function TacticsMatchHud({
    tick,
    undoDisabled,
    redoDisabled,
    endTurnDisabled,
    handleUndo,
    handleRedo,
    handleEndTurn,
}: GameHudProps): React.ReactElement {
    return (
        <footer aria-label="Match HUD" style={tacticsHudStyle}>
            <div style={tacticsHudStatusStyle}>
                <span style={tacticsHudLabelStyle}>Tactics Tick</span>
                <output data-testid="hud-tick" style={tacticsHudTickStyle}>
                    {tick}
                </output>
            </div>
            <div style={tacticsHudActionsStyle}>
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

const tacticsHudStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--ch-space-md)',
    padding: 'var(--ch-space-sm) var(--ch-space-md)',
    borderTop: 'var(--ch-border-width-sm) solid var(--ch-color-border)',
    fontFamily: 'var(--ch-font-ui)',
};

const tacticsHudStatusStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--ch-space-xs)',
};

const tacticsHudLabelStyle: React.CSSProperties = {
    color: 'var(--ch-color-text-secondary)',
    fontSize: 'var(--ch-font-size-sm)',
};

const tacticsHudTickStyle: React.CSSProperties = {
    color: 'var(--ch-color-text-primary)',
    fontSize: 'var(--ch-font-size-md)',
    fontWeight: 700,
};

const tacticsHudActionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--ch-space-xs)',
};

export default TacticsMatchHud;
