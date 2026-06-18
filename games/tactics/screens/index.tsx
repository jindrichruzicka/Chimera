import React from 'react';
import type { GameScreenRegistry } from '@chimera/shared/game-screen-contract.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '../actions.js';
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

export const TACTICS_INPUT_ACTIONS = [
    { id: 'game:end-turn', description: 'End current turn', category: 'Game', oneShot: true },
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
