/**
 * games/tactics/content/tacticsContent.ts
 *
 * Tactics' content adapter. It is the single place that knows tactics authors
 * its colours as the `player-colors` and `board-colors` collections and that
 * each item carries a `hex`. Two responsibilities:
 *
 *   1. `TACTICS_CONTENT_SCHEMAS` — the per-collection Zod schemas handed to the
 *      generic `ContentLoader` (in `electron/main`) so items are validated at
 *      load time. The engine/loader never sees these shapes (Invariant #2).
 *   2. `paletteFromCollections` — a PURE interpreter turning the plain,
 *      transmitted `GameContent` (id + arbitrary fields) into the `TacticsPalette`
 *      the lobby and in-match scene consume. It tolerates missing collections so
 *      a game with no content (or a not-yet-loaded fetch) degrades to defaults.
 *
 * Module boundary (§3): may import from simulation/, ai/, shared/ and own files
 * only. Must NOT import from renderer/, electron/, or other games/ directories.
 * Safe to import from both `electron/main` (descriptor composition) and the
 * tactics renderer surfaces (prop interpretation).
 */

import type { GameContent, GameContentItem } from '@chimera/shared/game-content-contract.js';
import type { LobbyFieldOption } from '@chimera/shared/game-lobby-contract.js';
import type { ZodType } from 'zod';
import { ColorItemSchema } from './colorSchemas.js';
import type { TacticsPalette } from '../lobby/lobby-setup.js';

/** Collection type (data subdirectory) holding the per-player unit colours. */
export const PLAYER_COLORS_COLLECTION = 'player-colors';

/** Collection type (data subdirectory) holding the board-background colours. */
export const BOARD_COLORS_COLLECTION = 'board-colors';

/**
 * Per-collection schemas for tactics content, keyed by collection type. Handed
 * to the generic `ContentLoader` so a malformed colour fails the load (Invariant
 * #14) instead of reaching the lobby.
 */
export const TACTICS_CONTENT_SCHEMAS: Readonly<Record<string, ZodType>> = {
    [PLAYER_COLORS_COLLECTION]: ColorItemSchema,
    [BOARD_COLORS_COLLECTION]: ColorItemSchema,
};

function readString(item: GameContentItem, key: string): string | undefined {
    const value = item[key];
    return typeof value === 'string' ? value : undefined;
}

function readNumber(item: GameContentItem, key: string): number | undefined {
    const value = item[key];
    return typeof value === 'number' ? value : undefined;
}

/**
 * Re-impose the authored seat/display order. The generic content pipeline
 * delivers items id-sorted (alphabetical), so tactics sorts by each item's
 * `order` field. Items without a numeric `order` (degenerate / non-schema'd
 * content) sort last while preserving their relative input order (stable sort).
 */
function byAuthoredOrder(items: readonly GameContentItem[]): readonly GameContentItem[] {
    const rank = (item: GameContentItem): number =>
        readNumber(item, 'order') ?? Number.MAX_SAFE_INTEGER;
    return [...items].sort((a, b) => rank(a) - rank(b));
}

/** Map items to `{ value, label }` options, falling back to the id for a label. */
function toOptions(items: readonly GameContentItem[]): LobbyFieldOption[] {
    return items.map((item) => ({ value: item.id, label: readString(item, 'name') ?? item.id }));
}

/** Map items to `id → hex`, skipping any item lacking a string `hex`. */
function toHexMap(items: readonly GameContentItem[]): Record<string, string> {
    const hex: Record<string, string> = {};
    for (const item of items) {
        const value = readString(item, 'hex');
        if (value !== undefined) {
            hex[item.id] = value;
        }
    }
    return hex;
}

/**
 * Pure interpreter: build the tactics palette from transmitted content. Missing
 * collections yield empty options/maps, so the lobby and scene fall back to the
 * `DEFAULT_*` constants in `lobby-setup.ts`.
 */
export function paletteFromCollections(content: GameContent): TacticsPalette {
    const player = byAuthoredOrder(content[PLAYER_COLORS_COLLECTION] ?? []);
    const board = byAuthoredOrder(content[BOARD_COLORS_COLLECTION] ?? []);
    return {
        playerColors: toOptions(player),
        boardColors: toOptions(board),
        playerColorHex: toHexMap(player),
        boardColorHex: toHexMap(board),
    };
}
