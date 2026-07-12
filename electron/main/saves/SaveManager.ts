/**
 * Orchestrates all save / load persistence operations for the main process.
 * Delegates I/O to an injected `SaveRepository` — no concrete repository
 * class is ever imported here (architecture §4.11, invariant #37).
 *
 * The concrete repository is wired once in `electron/main/index.ts`. Tests
 * use `InMemorySaveRepository`.
 *
 * Architecture reference: §4.11
 *
 * Invariants upheld:
 *   #37 — No import of FileSaveRepository or any concrete class by name.
 *   #67 — Constructed with an injected Logger child.
 */

import type { SaveFile } from '@chimera-engine/simulation/persistence/SaveFile.js';
import type {
    SaveRepository,
    SaveSlotMeta,
} from '@chimera-engine/simulation/persistence/SaveRepository.js';
import type { Logger } from '../logging/logger.js';

/**
 * Manages all save/load persistence for the main process. Constructed once in
 * `electron/main/index.ts`; wired into the saves IPC namespace.
 */
export class SaveManager {
    private readonly log: Logger;

    constructor(
        private readonly repository: SaveRepository,
        logger: Logger,
    ) {
        this.log = logger.child({ module: 'save-manager' });
    }

    // ── Repository delegation ─────────────────────────────────────────────────

    list(gameId: string): Promise<SaveSlotMeta[]> {
        return this.repository.list(gameId);
    }

    load(slotId: string): Promise<SaveFile> {
        return this.repository.load(slotId);
    }

    save(file: SaveFile): Promise<void> {
        this.log.info('save', { gameId: file.header.gameId, slotId: file.header.slotId });
        return this.repository.save(file);
    }

    delete(slotId: string): Promise<void> {
        this.log.info('delete', { slotId });
        return this.repository.delete(slotId);
    }

    has(slotId: string): Promise<boolean> {
        return this.repository.has(slotId);
    }

    // ── Auto-save ─────────────────────────────────────────────────────────────

    /**
     * Write the file to `<gameId>/autosave`, overwriting the input `slotId`
     * with `'autosave'` regardless of what was supplied. This guarantees that
     * the autosave slot is always a known, stable identifier.
     */
    async autoSave(file: SaveFile): Promise<void> {
        const autoSaveFile: SaveFile = {
            ...file,
            header: { ...file.header, slotId: 'autosave' },
        };
        this.log.info('autoSave', { gameId: file.header.gameId });
        await this.repository.save(autoSaveFile);
    }

    // ── Restore ───────────────────────────────────────────────────────────────

    /**
     * Load the full `SaveFile` for the given qualified slot ID and return it.
     * The caller (SimulationHost) is responsible for applying the restored
     * state to the running simulation.
     *
     * @throws {SaveNotFoundError} if no slot with `slotId` exists.
     */
    async restoreFromSave(slotId: string): Promise<SaveFile> {
        this.log.info('restoreFromSave', { slotId });
        return this.repository.load(slotId);
    }
}
