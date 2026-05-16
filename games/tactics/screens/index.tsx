import React from 'react';
import type { GameScreenRegistry } from '@chimera/shared/game-screen-contract.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '../actions.js';
import { tacticsAudioRefs } from '../asset-manifest.js';
// Side-effect import: redefines --ch-* tokens for the Tactics visual language.
// Must be the only place this file is imported (Invariants #85, #93).
import '../styles/tokens-override.css';

const TacticsDemoBoard = React.lazy(() => import('./TacticsDemoBoard.js'));
const TacticsMatchHud = React.lazy(() => import('./TacticsMatchHud.js'));
const TacticsMatchResultBanner = React.lazy(() => import('./TacticsMatchResultBanner.js'));
// Invariant #87: every screen registered here must be wrapped in React.lazy.
const TacticsPostMatchSummary = React.lazy(() => import('./TacticsPostMatchSummary.js'));

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

export const MatchScreenRegistry: GameScreenRegistry = {
    board: TacticsDemoBoard,
    hud: TacticsMatchHud,
    eventAudioBinding: TACTICS_EVENT_AUDIO_BINDING,
    screens: {
        summary: TacticsPostMatchSummary,
    },
    sceneDefaultScreens: {
        'engine:match': 'board',
        'engine:post-match': 'summary',
    },
    matchResultBanner: TacticsMatchResultBanner,
};
