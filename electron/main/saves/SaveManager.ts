/**
 * electron/main/SaveManager.ts
 *
 * Orchestrates all save / load persistence operations for the main process.
 * Delegates I/O to an injected `SaveRepository` — no concrete repository
 * class is ever imported here (architecture §4.11, invariant #37).
 *
 * Responsibilities:
 *   - Thin delegation: list / load / save / delete / has → repository
 *   - autoSave: forces slotId to 'autosave' before delegating
 *   - restoreFromSave: loads and returns a SaveFile for session restoration
 *   - Crash recovery: markCleanExit / clearCleanExitFlag / checkCrashRecovery
 *     via a `lastCleanExit.flag` file written to `dataDir`
 *
 * The concrete repository and `dataDir` are wired once in
 * `electron/main/index.ts`. Tests use `InMemorySaveRepository` and a
 * real temp directory for the flag-file tests.
 *
 * Architecture reference: §4.11
 * Task: F06 / T5 (issue #124)
 *
 * Invariants upheld:
 *   #37 — No import of FileSaveRepository or any concrete class by name.
 *   #67 — Constructed with an injected Logger child.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SaveFile } from '@chimera/simulation/persistence/SaveFile.js';
import type {
    SaveRepository,
    SaveSlotMeta,
} from '@chimera/simulation/persistence/SaveRepository.js';
import type { Logger } from '../logging/logger.js';

/** Filename of the clean-exit sentinel written on graceful shutdown. */
const CLEAN_EXIT_FILENAME = 'lastCleanExit.flag';

/**
 * Manages all save/load persistence and crash-recovery detection for the
 * main process. Constructed once in `electron/main/index.ts`; wired into
 * the saves IPC namespace and the app lifecycle.
 *
 * `dataDir` is the base directory for the clean-exit flag file —
 * in production this is `app.getPath('userData')`.
 */
export class SaveManager {
    private readonly log: Logger;

    constructor(
        private readonly repository: SaveRepository,
        private readonly dataDir: string,
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

    // ── Crash recovery ────────────────────────────────────────────────────────

    private get cleanExitFlagPath(): string {
        return path.join(this.dataDir, CLEAN_EXIT_FILENAME);
    }

    /**
     * Write the clean-exit sentinel to `dataDir`.
     * Call this inside the `app.on('before-quit')` handler.
     */
    async markCleanExit(): Promise<void> {
        await fs.writeFile(this.cleanExitFlagPath, '');
        this.log.debug('markCleanExit: flag written');
    }

    /**
     * Remove the clean-exit sentinel from `dataDir`.
     * Call this at application start so the next launch can detect a crash.
     *
     * Returns `true` if the flag was present (previous exit was clean), or
     * `false` if it was absent (previous session may have crashed).
     */
    async clearCleanExitFlag(): Promise<boolean> {
        try {
            await fs.unlink(this.cleanExitFlagPath);
            this.log.debug('clearCleanExitFlag: flag removed');
            return true;
        } catch {
            this.log.debug('clearCleanExitFlag: flag was absent');
            return false;
        }
    }

    /**
     * Check whether the previous session crashed.
     *
     * Returns the `SaveSlotMeta` for the first autosave found across the
     * provided `knownGameIds` if:
     *   1. The clean-exit flag is absent (previous session crashed), AND
     *   2. An autosave slot exists for at least one of the `knownGameIds`.
     *
     * Returns `null` if the flag is present, or if no autosave exists.
     *
     * @param knownGameIds  All game IDs to scan for autosaves. In production
     *                      this is the list of installed games.
     */
    async checkCrashRecovery(knownGameIds: readonly string[]): Promise<SaveSlotMeta | null> {
        const hadCleanExit = await fs
            .access(this.cleanExitFlagPath)
            .then(() => true)
            .catch(() => false);

        if (hadCleanExit) {
            return null;
        }

        for (const gameId of knownGameIds) {
            const slots = await this.repository.list(gameId);
            const autosave = slots.find((s) => s.slotId === `${gameId}/autosave`);
            if (autosave !== undefined) {
                this.log.warn('checkCrashRecovery: autosave found after unclean exit', {
                    slotId: autosave.slotId,
                });
                return autosave;
            }
        }

        return null;
    }
}
