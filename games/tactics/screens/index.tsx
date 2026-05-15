import React from 'react';
import type { GameScreenRegistry } from '@chimera/shared/game-screen-contract.js';
// Side-effect import: redefines --ch-* tokens for the Tactics visual language.
// Must be the only place this file is imported (Invariants #85, #93).
import '../styles/tokens-override.css';

const TacticsDemoBoard = React.lazy(() => import('./TacticsDemoBoard.js'));
const TacticsMatchHud = React.lazy(() => import('./TacticsMatchHud.js'));
const TacticsMatchResultBanner = React.lazy(() => import('./TacticsMatchResultBanner.js'));
// Invariant #87: every screen registered here must be wrapped in React.lazy.
const TacticsPostMatchSummary = React.lazy(() => import('./TacticsPostMatchSummary.js'));

export const MatchScreenRegistry: GameScreenRegistry = {
    board: TacticsDemoBoard,
    hud: TacticsMatchHud,
    screens: {
        summary: TacticsPostMatchSummary,
    },
    sceneDefaultScreens: {
        'engine:match': 'board',
        'engine:post-match': 'summary',
    },
    matchResultBanner: TacticsMatchResultBanner,
};
