// The action app's screen registry — the table the renderer host reads (through
// `renderer/loaders.ts`) to mount this game's screens.
//
// Three slots, and the third is the one worth naming out loud:
//
//   - `playfield` — the required slot (Invariant #81), the arena itself.
//   - `hud` — the tick counter and the save affordance.
//   - `inGameMenu` — DELIBERATELY ABSENT. Omitting the slot is what selects the
//     engine's default Resume/Leave menu; the string `'none'` would be the
//     opt-out that makes Escape a no-op, and a component would be an override.
//     A realtime sandbox needs nothing the default does not already do.
//
// Every screen registered here is wrapped in `React.lazy` (Invariant #87), so
// the heavy scene modules stay code-split behind the registry.

import React from 'react';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
// Side-effect import: installs this app's `--ch-*` token overrides. Shared with
// the shell loader, so a match route and a menu route theme identically.
import '../styles/register-token-overrides.js';

const ActionPlayfield = React.lazy(() => import('./ActionPlayfield.js'));
const ActionGameHud = React.lazy(() => import('./ActionGameHud.js'));

export const ActionGameScreenRegistry: GameScreenRegistry = {
    playfield: ActionPlayfield,
    hud: ActionGameHud,
    // The renderer half of the engine scene's default-screen declaration: with
    // no game-contributed scenes, `engine:game` is the only entry there is.
    sceneDefaultScreens: {
        'engine:game': 'playfield',
    },
};
