import type { GameManifest } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { TACTICS_GAME_ID } from './simulation/constants.js';

/**
 * Tactics' game manifest. Tactics is the turn-based reference game: `realtime`
 * is `false` (no wall-clock heartbeat — an action-driven clock) and the window
 * title resolves to its display name "Tactics". No `icon` override ⇒ the
 * default Chimera icon.
 *
 * The cursor textures under `assets/cursors/` are 32×32 solid-white
 * placeholders: deliberate stand-ins meant to be overwritten with real
 * art later. Hotspots are omitted ⇒ top-left (0,0) until the art defines them.
 *
 * `logoScreen` points a packaged boot at `renderer/app/logo-screen/`,
 * a thin re-export of the engine default logo page; dev boots skip it and go
 * straight to the main menu.
 *
 * `languages` opts Tactics into the i18n system with English + Czech. English
 * is first, so it is the default when the persisted locale matches neither. The
 * per-locale bundles are contributed through the renderer shell registration
 * (see `renderer/loaders.ts` → `translations`).
 *
 * `spectators` opts Tactics into read-only spectator mode: a spectator follows a
 * seat's projected perspective (switchable via hotkey). The capability alone is
 * behaviour-neutral — a running-match join is admitted as a spectator only when
 * the host also enables the `engine.allowSpectators` match setting (surfaced by
 * the lobby's "Allow spectators" toggle).
 */
export const tacticsManifest: GameManifest = {
    gameId: TACTICS_GAME_ID,
    displayName: 'Tactics',
    realtime: false,
    cursor: {
        default: { image: 'cursors/default.png' },
        pointer: { image: 'cursors/pointer.png' },
        disabled: { image: 'cursors/disabled.png' },
    },
    logoScreen: { route: '/logo-screen' },
    languages: [
        { code: 'en-US', label: 'English' },
        { code: 'cs-CZ', label: 'Čeština' },
    ],
    spectators: { mode: 'perspective' },
};
