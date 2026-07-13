import React from 'react';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '../simulation/actions.js';
import { tacticsAudioRefs } from '../asset-manifest.js';
// Side-effect import: redefines --ch-* tokens for the Tactics visual language.
// Shared with shell loaders so URL-selected shell UI can wait for tokens before rendering.
import '../styles/register-token-overrides.js';

const TacticsDemoBoard = React.lazy(() => import('./TacticsDemoBoard.js'));
const TacticsGameHud = React.lazy(() => import('./TacticsGameHud.js'));
const TacticsGameResultBanner = React.lazy(() => import('./TacticsGameResultBanner.js'));
const TacticsInGameMenu = React.lazy(() => import('./TacticsInGameMenu.js'));
// Invariant #87: every screen registered here must be wrapped in React.lazy.
const TacticsPostGameSummary = React.lazy(() => import('./TacticsPostGameSummary.js'));

const TACTICS_EVENT_AUDIO_BINDING = {
    [TACTICS_MOVE_UNIT_ACTION]: {
        ref: tacticsAudioRefs.step,
        bus: 'sfx',
        volume: 0.45,
    },
    [TACTICS_ATTACK_ACTION]: {
        ref: tacticsAudioRefs.swordHit,
        bus: 'sfx',
        volume: 0.65,
    },
    [TACTICS_REVEAL_TILE_ACTION]: {
        ref: tacticsAudioRefs.reveal,
        bus: 'sfx',
        volume: 0.4,
    },
} as const;

// Description and category are game.tactics.actions.* translation tokens: the
// settings Controls panel resolves both through t() (a literal falls back to
// itself), so the row follows the active locale. The category doubles as the
// grouping key — grouping compares the raw token string, which stays stable.
export const TACTICS_INPUT_ACTIONS = [
    {
        id: 'game:end-turn',
        description: 'game.tactics.actions.endTurn',
        category: 'game.tactics.actions.categoryGame',
        oneShot: true,
    },
] as const;

export const TacticsGameScreenRegistry: GameScreenRegistry = {
    board: TacticsDemoBoard,
    hud: TacticsGameHud,
    inGameMenu: TacticsInGameMenu,
    eventAudioBinding: TACTICS_EVENT_AUDIO_BINDING,
    screens: {
        summary: TacticsPostGameSummary,
    },
    sceneDefaultScreens: {
        'engine:game': 'board',
        'engine:post-game': 'summary',
    },
    gameResultBanner: TacticsGameResultBanner,
};
