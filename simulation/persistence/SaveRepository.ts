/**
 * simulation/persistence/SaveRepository.ts
 *
 * Repository interface for save file storage (§4.11).
 *
 * This file is PURE TYPE DECLARATIONS + an interface — zero runtime code and
 * zero FS or Electron imports. Two implementations exist:
 *   - InMemorySaveRepository (this package) — test double
 *   - FileSaveRepository (electron/main/saves/) — production
 *
 * Architecture reference: §4.11
 * Task: F06 / T3 (issue #122)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — InMemorySaveRepository must pass the identical contract test suite
 *           as FileSaveRepository.
 */

import type { SaveFile } from './SaveFile.js';

// ─── SaveSlotMeta ─────────────────────────────────────────────────────────────

/**
 * Lightweight metadata for a single save slot.
 *
 * Returned by `SaveRepository.list()` so the UI can display slot summaries
 * without loading the full `SaveFile` (which may be large/compressed).
 *
 * `slotId` is the *qualified* identifier in `'<gameId>/<slotName>'` format,
 * matching the key accepted by `SaveRepository.load()`, `delete()`, and
 * `has()`. This allows the renderer to pass `meta.slotId` directly to those
 * methods without reconstruction.
 */
export interface SaveSlotMeta {
    /** Qualified slot identifier: `'<gameId>/<slotName>'`. */
    readonly slotId: string;
    readonly gameId: string;
    readonly savedAt: number;
    readonly turnNumber: number;
    readonly playerNames: readonly string[];
    readonly thumbnailDataUrl?: string;
    readonly schemaVersion: number;
    /** Serialised byte size — used for storage quota display. */
    readonly sizeBytes: number;
}

// ─── SaveRepository ───────────────────────────────────────────────────────────

/**
 * Repository interface for reading and writing save files (§4.11).
 *
 * All methods are async to accommodate both the in-memory test double and the
 * filesystem-backed production implementation.
 *
 * `slotId` in `load()`, `delete()`, and `has()` is the *qualified* identifier
 * in `'<gameId>/<slotName>'` format (e.g. `'tactics/autosave'`). This is the
 * same value returned in `SaveSlotMeta.slotId` by `list()`.
 */
export interface SaveRepository {
    /**
     * List all save slots for the given game.
     * Returns metadata only — does not deserialise the full SaveFile.
     * Results are sorted by `savedAt` descending (most recent first).
     */
    list(gameId: string): Promise<SaveSlotMeta[]>;

    /**
     * Load the full SaveFile for the given qualified slot ID.
     * @throws {SaveNotFoundError} if no slot with `slotId` exists.
     */
    load(slotId: string): Promise<SaveFile>;

    /**
     * Persist a SaveFile. Overwrites the slot silently if it already exists.
     * Implementations must write atomically (see `FileSaveRepository`).
     */
    save(file: SaveFile): Promise<void>;

    /**
     * Delete the save slot with the given qualified `slotId`.
     * @throws {SaveNotFoundError} if no slot with `slotId` exists.
     */
    delete(slotId: string): Promise<void>;

    /** Returns `true` if a slot with the given qualified `slotId` exists. */
    has(slotId: string): Promise<boolean>;
}
