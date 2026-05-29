'use client';

import React from 'react';
import type { GameHudProps } from '@chimera/shared/game-screen-contract.js';
import {
    Badge,
    Button,
    Caption,
    Divider,
    Panel,
    type BadgeVariant,
} from '@chimera/renderer/components/ui/index.js';

interface TacticsTurnStatus {
    readonly label: string;
    readonly variant: BadgeVariant;
}

type CompactButtonStyle = React.CSSProperties & {
    readonly '--ch-button-font-size': string;
    readonly '--ch-button-line-height': string;
    readonly '--ch-button-min-width': string;
    readonly '--ch-button-padding': string;
};

export function TacticsGameHud({
    snapshot,
    tick,
    undoDisabled,
    redoDisabled,
    endTurnDisabled,
    handleUndo,
    handleRedo,
    handleEndTurn,
}: GameHudProps): React.ReactElement {
    const turnStatus = resolveTacticsTurnStatus(snapshot.isMyTurn);

    return (
        <footer aria-label="Game HUD" style={tacticsHudStyle}>
            <Panel data-testid="tactics-hud-panel" style={tacticsHudPanelStyle} variant="raised">
                <div style={tacticsHudBodyStyle}>
                    <div style={tacticsHudStatusStyle}>
                        <Badge
                            data-testid="tactics-turn-status"
                            style={tacticsHudBadgeStyle}
                            variant={turnStatus.variant}
                        >
                            {turnStatus.label}
                        </Badge>
                        <div style={tacticsHudTickGroupStyle}>
                            <Caption style={tacticsHudLabelStyle} tone="muted">
                                Tactics Tick
                            </Caption>
                            <output data-testid="hud-tick" style={tacticsHudTickStyle}>
                                {tick}
                            </output>
                        </div>
                    </div>
                    <Divider
                        data-testid="tactics-hud-divider"
                        orientation="vertical"
                        style={tacticsHudDividerStyle}
                    />
                    <div aria-label="Tactics actions" style={tacticsHudActionsStyle}>
                        <Button
                            data-testid="undo"
                            disabled={undoDisabled}
                            onClick={handleUndo}
                            size="sm"
                            style={tacticsHudButtonStyle}
                            variant="secondary"
                        >
                            Undo
                        </Button>
                        <Button
                            data-testid="redo"
                            disabled={redoDisabled}
                            onClick={handleRedo}
                            size="sm"
                            style={tacticsHudButtonStyle}
                            variant="secondary"
                        >
                            Redo
                        </Button>
                        <Button
                            data-testid="end-turn"
                            disabled={endTurnDisabled}
                            onClick={handleEndTurn}
                            size="sm"
                            style={tacticsHudButtonStyle}
                            variant="primary"
                        >
                            End Turn
                        </Button>
                    </div>
                </div>
            </Panel>
        </footer>
    );
}

function resolveTacticsTurnStatus(isMyTurn: boolean): TacticsTurnStatus {
    if (isMyTurn) {
        return { label: 'Your turn', variant: 'success' };
    }

    return { label: 'Waiting', variant: 'warning' };
}

const tacticsHudStyle: React.CSSProperties = {
    fontFamily: 'var(--ch-font-ui)',
};

const tacticsHudPanelStyle: React.CSSProperties = {
    padding: '0 var(--ch-space-sm)',
};

const tacticsHudBodyStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--ch-space-md)',
};

const tacticsHudStatusStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--ch-space-sm)',
    minWidth: 'max-content',
};

const tacticsHudBadgeStyle: React.CSSProperties = {
    padding: '0 var(--ch-space-sm)',
};

const tacticsHudTickGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--ch-space-xs)',
};

const tacticsHudLabelStyle: React.CSSProperties = {
    lineHeight: 'var(--ch-line-height-tight)',
};

const tacticsHudTickStyle: React.CSSProperties = {
    color: 'var(--ch-color-text-primary)',
    fontSize: 'var(--ch-font-size-md)',
    fontWeight: 700,
};

const tacticsHudDividerStyle: React.CSSProperties = {
    alignSelf: 'center',
    minHeight: 'var(--ch-space-lg)',
};

const tacticsHudActionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--ch-space-xs)',
};

const tacticsHudButtonStyle: CompactButtonStyle = {
    '--ch-button-font-size': 'var(--ch-font-size-sm)',
    '--ch-button-line-height': 'var(--ch-line-height-tight)',
    '--ch-button-min-width': 'auto',
    '--ch-button-padding': 'var(--ch-space-xs) var(--ch-space-sm)',
    marginBlock: 'var(--ch-space-xs)',
};

export default TacticsGameHud;
