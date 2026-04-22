/**
 * simulation/persistence/InMemorySaveRepository.ts
 *
 * In-memory SaveRepository implementation for use in unit tests and E2E
 * fixtures. Backed by a `Map`; no filesystem access (§4.11, invariant #41).
 *
 * Architecture reference: §4.11
 * Task: F06 / T3 (issue #122)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — Passes the identical contract test suite as FileSaveRepository.
 */

import type { SaveFile } from './SaveFile.js';
import type { SaveRepository, SaveSlotMeta } from './SaveRepository.js';
import { SaveNotFoundError } from './SaveMigrator.js';

/**
 * In-memory test double for `SaveRepository`.
 *
 * The map key is the qualified slot identifier `'<gameId>/<slotName>'`
 * (e.g. `'tactics/autosave'`), constructed from `file.header.gameId` and
 * `file.header.slotId` on `save()`.
 */
export class InMemorySaveRepository implements SaveRepository {
    private readonly store = new Map<string, SaveFile>();

    private static qualifiedKey(gameId: string, slotId: string): string {
        return `${gameId}/${slotId}`;
    }

    private static toMeta(file: SaveFile, qualifiedSlotId: string): SaveSlotMeta {
        const meta: SaveSlotMeta = {
            slotId: qualifiedSlotId,
            gameId: file.header.gameId,
            savedAt: file.header.savedAt,
            turnNumber: file.header.turnNumber,
            playerNames: file.header.playerNames,
            schemaVersion: file.header.schemaVersion,
            // Approximate byte size using JSON representation (no compression).
            sizeBytes: JSON.stringify(file).length,
        };

        if (file.header.thumbnailDataUrl !== undefined) {
            return { ...meta, thumbnailDataUrl: file.header.thumbnailDataUrl };
        }

        return meta;
    }

    list(gameId: string): Promise<SaveSlotMeta[]> {
        const results: SaveSlotMeta[] = [];

        for (const [key, file] of this.store) {
            if (file.header.gameId === gameId) {
                results.push(InMemorySaveRepository.toMeta(file, key));
            }
        }

        results.sort((a, b) => b.savedAt - a.savedAt);
        return Promise.resolve(results);
    }

    load(slotId: string): Promise<SaveFile> {
        const file = this.store.get(slotId);

        if (file === undefined) {
            return Promise.reject(new SaveNotFoundError(slotId));
        }

        return Promise.resolve(file);
    }

    save(file: SaveFile): Promise<void> {
        const key = InMemorySaveRepository.qualifiedKey(file.header.gameId, file.header.slotId);
        this.store.set(key, file);
        return Promise.resolve();
    }

    delete(slotId: string): Promise<void> {
        if (!this.store.has(slotId)) {
            return Promise.reject(new SaveNotFoundError(slotId));
        }

        this.store.delete(slotId);
        return Promise.resolve();
    }

    has(slotId: string): Promise<boolean> {
        return Promise.resolve(this.store.has(slotId));
    }
}
