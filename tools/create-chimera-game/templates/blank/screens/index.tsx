// __Game Title__'s screen registry. The renderer host reads it (via the renderer
// loaders) to mount the game's screens. `playfield` is the only required slot
// (Invariant #81); add `hud`, `inGameMenu`, `gameResultBanner`, and entries under
// `screens`/`sceneDefaultScreens` as your game grows.

import React from 'react';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';

// Invariant #87: every screen registered here must be wrapped in React.lazy.
const __GamePascal__Playfield = React.lazy(() => import('./__GamePascal__Playfield.js'));

export const __GamePascal__GameScreenRegistry: GameScreenRegistry = {
    playfield: __GamePascal__Playfield,
    sceneDefaultScreens: {
        'engine:game': 'playfield',
    },
};
