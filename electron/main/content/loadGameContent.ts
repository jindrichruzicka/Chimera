/**
 * electron/main/content/loadGameContent.ts
 *
 * Loads every registered game's content directory into an immutable
 * `ContentDatabase` at startup, using the game-supplied schemas. The loader is
 * generic (`simulation/content`); this module only resolves the per-game data
 * directory from the runtime `gameAssetsRoot` and hands over the game's schemas.
 *
 * A load or validation failure is fatal (Invariant #14): content is verified
 * before the tick loop / lobby comes up, never silently skipped.
 *
 * `toGameContent` flattens a loaded database into the plain, agnostic
 * `GameContent` shape (collection → items) that is both transmitted to the
 * renderer over IPC and fed to a game's lobby-setup composition.
 *
 * Architecture: §4.8 — Content Database; Invariants #13, #14, #46.
 */

import path from 'path';
import { createContentLoader } from '@chimera/simulation/content/index.js';
import type { ContentDatabase } from '@chimera/simulation/content/index.js';
import type {
    GameContent,
    GameContentItem,
} from '@chimera/simulation/foundation/game-content-contract.js';
import { gameContentRegistry } from './gameContentRegistry.js';

/**
 * Load all registered games' content from `<gameAssetsRoot>/<gameId>/data`.
 * Returns a map keyed by `gameId`; games absent from the registry are absent
 * from the map (their `PipelineContext.db` stays `undefined`).
 *
 * @throws if any game's content fails to load or validate (Invariant #14).
 */
export async function loadAllGameContent(
    gameAssetsRoot: string,
): Promise<Map<string, ContentDatabase>> {
    const dbs = new Map<string, ContentDatabase>();
    for (const [gameId, registration] of Object.entries(gameContentRegistry)) {
        const dataDir = path.join(gameAssetsRoot, gameId, 'data');
        const db = await createContentLoader().load([{ type: 'directory', path: dataDir }], {
            schemas: registration.schemas,
        });
        dbs.set(gameId, db);
    }
    return dbs;
}

/**
 * Flatten a `ContentDatabase` into the plain, agnostic `GameContent` shape:
 * every collection mapped to its items (id-sorted, as `getAll` returns them).
 * The items are plain frozen JSON objects — wire- and prop-ready.
 */
export function toGameContent(db: ContentDatabase): GameContent {
    const collections: Record<string, readonly GameContentItem[]> = {};
    for (const collectionType of db.collectionTypes()) {
        collections[collectionType] = db.getAll(
            collectionType,
        ) as unknown as readonly GameContentItem[];
    }
    return collections;
}
