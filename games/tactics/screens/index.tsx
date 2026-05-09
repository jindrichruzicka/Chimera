import type { GameScreenRegistry } from '@chimera/renderer/components/shell/MatchShell.js';
import { TacticsDemoBoard } from './TacticsDemoBoard.js';

export const MatchScreenRegistry: GameScreenRegistry = {
    board: TacticsDemoBoard,
};
