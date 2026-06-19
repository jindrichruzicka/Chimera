/**
 * games/tactics/lobby/lobby-setup.ts
 *
 * Tactics' pure, declarative lobby-setup descriptor (§4.37). The selectable
 * colours are no longer hardcoded here: they live in the content database
 * (`games/tactics/data/{player-colors,board-colors}/`), are loaded by
 * `electron/main` via the generic `ContentLoader`, and are interpreted into a
 * {@link TacticsPalette} by `games/tactics/content/tacticsContent.ts`. `main`
 * then calls {@link buildTacticsLobbySetup} with that palette to produce the
 * descriptor it reads for seat defaults and host/join validation.
 *
 * The `DEFAULT_*` constants stay here as the guaranteed-string safety net for an
 * absent `setup`, an off-palette name, or a game with no loaded content — they
 * are NOT a fallback for a failed content load (which is fatal, Invariant #14).
 *
 * Module boundary (§3): this descriptor must stay load-safe in both `main` and
 * renderer. Its sole runtime import is the dependency-free turn-mode constants
 * from its own package (`games/tactics/constants.ts`); every other import is
 * `import type`, erased at build — so the module stays safe to load anywhere.
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 * Task: #708 (T6, part of #702 — Customizable Lobby)
 */

import {
    TACTICS_DEFAULT_TURN_MODE,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera/tactics/constants.js';
import type { GameLobbySetup, LobbyFieldOption } from '@chimera/shared/game-lobby-contract.js';

/**
 * The interpreted tactics colour palette: the selectable options for the lobby
 * Selects plus the `name → hex` maps the swatches and in-match renderer use.
 * Produced from content by `paletteFromCollections` (tacticsContent.ts).
 */
export interface TacticsPalette {
    readonly playerColors: readonly LobbyFieldOption[];
    readonly boardColors: readonly LobbyFieldOption[];
    readonly playerColorHex: Readonly<Record<string, string>>;
    readonly boardColorHex: Readonly<Record<string, string>>;
}

/**
 * Default board colour seeded into a fresh lobby's match settings. Exported so
 * the lobby screen reuses the same fallback instead of re-hardcoding it.
 */
export const DEFAULT_BOARD_COLOR = 'slate';

/**
 * Seat-0 player colour; the strict-typing fallback in the seat resolver and the
 * lobby screen's render-time fallback for a seat with no assigned colour.
 */
export const DEFAULT_PLAYER_COLOR = 'blue';

/**
 * Hex for {@link DEFAULT_BOARD_COLOR} (`slate`). The guaranteed-string fallback
 * the in-match ground plane uses when `setup` is absent, the chosen board colour
 * is off-palette, or content has not loaded.
 */
export const DEFAULT_BOARD_COLOR_HEX = '#3f3f46';

/**
 * Hex for {@link DEFAULT_PLAYER_COLOR} (`blue`). The guaranteed-string fallback
 * for a unit's colour when `setup` is absent, the owner has no colour, it is
 * off-palette, or content has not loaded.
 */
export const DEFAULT_PLAYER_COLOR_HEX = '#2563eb';

/**
 * Maximum seats this game's lobby admits (humans + AI together). Exported so
 * the lobby screen can gate the "Add AI player" control on total occupancy
 * without re-hardcoding it (F54 T3, #723).
 */
export const TACTICS_MAX_PLAYERS = 4;

/**
 * Build Tactics' lobby-setup descriptor from a loaded colour {@link palette}:
 * 4 seats, a host-chosen board colour, the off-by-default commitment turn mode,
 * and a per-seat unit colour. `resolveDefaultPlayerAttributes` assigns seat `n`
 * the player-colour at index `n`, wrapping via modulo so it stays total for any
 * index `main` might pass and falling back to {@link DEFAULT_PLAYER_COLOR} when
 * the palette is empty.
 *
 * `turnMode` is seeded to {@link TACTICS_DEFAULT_TURN_MODE} (`sequential`) so the
 * synced `LobbyState.matchSettings` carries the commitment battle-mode flag from
 * the start; the host's Battle Setup toggle (T7) flips it via `setMatchSetting`
 * and it rides into the match through `snapshot.setup` for T8 to read.
 */
export function buildTacticsLobbySetup(palette: TacticsPalette): GameLobbySetup {
    return {
        maxPlayers: TACTICS_MAX_PLAYERS,
        matchSettingsDefaults: {
            boardColor: DEFAULT_BOARD_COLOR,
            [TACTICS_TURN_MODE_SETTING]: TACTICS_DEFAULT_TURN_MODE,
        },
        matchSettingsOptions: { boardColor: palette.boardColors },
        playerAttributeOptions: { color: palette.playerColors },
        resolveDefaultPlayerAttributes(seatIndex: number): Record<string, string> {
            const colors = palette.playerColors;
            const option = colors.length === 0 ? undefined : colors[seatIndex % colors.length];
            return { color: option?.value ?? DEFAULT_PLAYER_COLOR };
        },
    };
}
