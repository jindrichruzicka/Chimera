import React from 'react';
import type { GameScreenRegistry } from '@chimera/shared/game-screen-contract.js';

const TacticsDemoBoard = React.lazy(() => import('./TacticsDemoBoard.js'));
const TacticsMatchHud = React.lazy(() => import('./TacticsMatchHud.js'));
const TacticsMatchResultBanner = React.lazy(() => import('./TacticsMatchResultBanner.js'));

export const MatchScreenRegistry: GameScreenRegistry = {
    board: TacticsDemoBoard,
    hud: TacticsMatchHud,
    matchResultBanner: TacticsMatchResultBanner,
};
