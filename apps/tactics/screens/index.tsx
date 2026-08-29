import React from 'react';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { TACTICS_REVEAL_TILE_ACTION } from '../simulation/actions.js';
import { tacticsAudioRefs } from '../asset-manifest.js';
import { SCENE_KEYS } from '../shell/translations/keys.js';
// Side-effect import: redefines --ch-* tokens for the Tactics visual language.
// Shared with shell loaders so URL-selected shell UI can wait for tokens before rendering.
import '../styles/register-token-overrides.js';

const TacticsAssetDemoScreen = React.lazy(() => import('./TacticsAssetDemoScreen.js'));
const TacticsDemoBoard = React.lazy(() => import('./TacticsDemoBoard.js'));
const TacticsGameHud = React.lazy(() => import('./TacticsGameHud.js'));
const TacticsGameResultBanner = React.lazy(() => import('./TacticsGameResultBanner.js'));
const TacticsInGameMenu = React.lazy(() => import('./TacticsInGameMenu.js'));
// Invariant #87: every screen registered here must be wrapped in React.lazy.
const TacticsPostGameSummary = React.lazy(() => import('./TacticsPostGameSummary.js'));

// Step and sword-hit are NOT here: the demo board plays them itself, positioned
// from the delta between the projections it receives — a { type }-only GameEvent
// carries no position, and cannot say WHICH unit moved when several did. An entry
// on both paths would double-play; only reveal stays event-driven.
const TACTICS_EVENT_AUDIO_BINDING = {
    [TACTICS_REVEAL_TILE_ACTION]: {
        ref: tacticsAudioRefs.reveal,
        bus: 'sfx',
        volume: 0.4,
    },
} as const;

export const TacticsGameScreenRegistry: GameScreenRegistry = {
    playfield: TacticsDemoBoard,
    hud: TacticsGameHud,
    inGameMenu: TacticsInGameMenu,
    eventAudioBinding: TACTICS_EVENT_AUDIO_BINDING,
    screens: {
        summary: TacticsPostGameSummary,
        'asset-demo': TacticsAssetDemoScreen,
    },
    // The renderer half of each scene's default-screen declaration; the main
    // half is the descriptor's `defaultScreen` (simulation/scenes.ts), and
    // `index.test.tsx` pins the two together for the contributed scene. Both
    // cover cascades prefer a value carried from the descriptor, so this map is
    // their fallback — the route entry reads the same slots for its own cover.
    sceneDefaultScreens: {
        'engine:game': 'playfield',
        'engine:post-game': 'summary',
        'tactics:asset-demo': 'asset-demo',
    },
    // Keyed on the contributed scene's own screen key, and paired with no
    // registry-wide `loadingScreen` — see `GameScreenRegistry.loadingScreens`.
    //
    // The motionless `{ message }` form, not a spinner or a component, so the
    // cover is deterministic in a screenshot. The string is a translation key —
    // `t` returns an unknown key unchanged, so `index.test.tsx` checks it
    // against the catalogue rather than trusting it to fail loudly.
    loadingScreens: {
        'asset-demo': { message: SCENE_KEYS.assetDemoLoading },
    },
    // Once a cover the player can see has been shown, it stays at least this
    // long (§4.36) — a floor against the sub-perceptual flash of a fast load,
    // never a delay added to a slow one. Registry-wide by design; with the
    // per-key-only topology above it floors the asset-demo covers.
    loadingScreenMinVisibleMs: 400,
    gameResultBanner: TacticsGameResultBanner,
};
