/**
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
import { createContentLoader } from '@chimera-engine/simulation/content/index.js';
import type { ContentDatabase } from '@chimera-engine/simulation/content/index.js';
import type {
    GameContent,
    GameContentItem,
} from '@chimera-engine/simulation/foundation/game-content-contract.js';
import type { ZodType } from 'zod';

/**
 * Load each game's content from `<gameAssetsRoot>/<gameId>/data`, validating it
 * against the per-game schemas the host derived from the injected game
 * contributions (`MainGameContribution.contentSchemas` → `contentSchemasByGameId`).
 * Returns a map keyed by `gameId`; a game absent from `schemasByGameId`
 * (i.e. one that declares no content) is absent from the map, so its
 * `PipelineContext.db` stays `undefined` (Invariant #46).
 *
 * @throws if any game's content fails to load or validate (Invariant #14).
 */
export async function loadAllGameContent(
    gameAssetsRoot: string,
    schemasByGameId: Readonly<Record<string, Readonly<Record<string, ZodType>>>>,
): Promise<Map<string, ContentDatabase>> {
    const dbs = new Map<string, ContentDatabase>();
    for (const [gameId, schemas] of Object.entries(schemasByGameId)) {
        const dataDir = path.join(gameAssetsRoot, gameId, 'data');
        const db = await createContentLoader().load([{ type: 'directory', path: dataDir }], {
            schemas,
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
