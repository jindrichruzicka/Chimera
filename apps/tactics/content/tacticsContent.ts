/**
 * apps/tactics/content/tacticsContent.ts
 *
 * Tactics' content adapter. It is the single place that knows tactics authors
 * its colours as the `player-colors` and `board-colors` collections and that
 * each item carries a `hex`. Three responsibilities:
 *
 *   1. `TACTICS_CONTENT_SCHEMAS` — the per-collection Zod schemas handed to the
 *      generic `ContentLoader` (in `electron/main`) so items are validated at
 *      load time. The engine/loader never sees these shapes (Invariant #2).
 *   2. `paletteFromCollections` — a PURE interpreter turning the plain,
 *      transmitted `GameContent` (id + arbitrary fields) into the `TacticsPalette`
 *      the lobby and in-match scene consume. It tolerates missing collections so
 *      a game with no content (or a not-yet-loaded fetch) degrades to defaults.
 *   3. Re-exporting `TACTICS_SHOWCASE_WINDOWS`, which is how the animation
 *      clip-window verification reaches a path that always runs. The check is a
 *      module-scope call in `tacticsAnimations.ts`, so it fires when that module
 *      is EVALUATED — and this module is what `apps/tactics/electron/main.ts`
 *      imports at Electron main startup. Re-exporting from here puts the
 *      verification on that graph, which is what makes a mis-authored beat
 *      window refuse the app rather than mis-time a marker at runtime.
 *
 * Module boundary (§3): workspace imports are simulation/, ai/ and own files
 * only. Lint enforces the renderer half (`chimera/no-game-renderer-internals`)
 * and the electron/networking half (the `no-restricted-imports` zone this path
 * shares with a game's gameplay tree).
 * Safe to import from both `electron/main` (descriptor composition) and the
 * tactics renderer surfaces (prop interpretation).
 */

import type {
    GameContent,
    GameContentItem,
} from '@chimera-engine/simulation/foundation/game-content-contract.js';
import type { LobbyFieldOption } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type { ZodType } from 'zod';
import { ColorItemSchema } from './colorSchemas.js';
import type { TacticsPalette } from '../lobby/lobby-setup.js';

// Responsibility 3 (see the header): a VALUE re-export, not a type one. The
// binding is what keeps the module on the evaluated graph — a bundler is free
// to drop a module nothing names, and a dropped module runs no verification.
export { TACTICS_SHOWCASE_WINDOWS } from './tacticsAnimations.js';

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
