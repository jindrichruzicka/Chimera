// __Game Title__'s screen registry. The renderer host reads it (via the renderer
// loaders) to mount the game's screens. `playfield` is the only required
// slot; add `hud`, `inGameMenu`, `gameResultBanner`, `transitionOverlay`, the
// loading covers `loadingScreen` and `loadingScreens`, and entries under
// `screens`/`sceneDefaultScreens` as your game grows. Declare a cover only if
// you want a wait explained; leaving both unset keeps the engine default.
// `loadingScreenMinVisibleMs` is how long the cover stays up once it is
// raised — long enough to read a tip on, so a fast load reads as a beat rather
// than a flicker. It is a floor, never a delay added to a slow load. Leave it
// unset for the engine default; declare 0 to drop the floor entirely.

import React from 'react';
import type { InputAction } from '@chimera-engine/renderer/input';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';

// Every screen registered here must be wrapped in React.lazy.
const __GamePascal__Playfield = React.lazy(() => import('./__GamePascal__Playfield.js'));

// Adopter-extensible list of game-contributed input actions. Add entries here
// to register custom key-bindable actions in the engine's Controls settings
// panel. See `@chimera-engine/renderer/input` (`InputAction`) for the contract.
export const __GamePascal__INPUT_ACTIONS: readonly InputAction[] = [];

export const __GamePascal__GameScreenRegistry: GameScreenRegistry = {
    playfield: __GamePascal__Playfield,
    sceneDefaultScreens: {
        'engine:game': 'playfield',
    },
};
