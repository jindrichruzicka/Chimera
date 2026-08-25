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
import { AUTOSAVE_SLOT_NAME } from '@chimera-engine/simulation/foundation/save-slots.js';
import type { Logger } from '../logging/logger.js';

/**
 * Called after {@link SaveManager.save} and {@link SaveManager.autoSave} with
 * the id of the game whose slot list changed. `delete` does not notify — see
 * the note on that method.
 *
 * The composition root wires this to the `chimera:saves:slot-update` push, so
 * a renderer subscribed to the slot list stays coherent with writes it never
 * asked for. That is what an autosave is: it reaches no IPC round-trip —
 * neither the one an accepted `engine:end_turn` triggers nor the crash
 * reporter's capture — so without this seam a reactive "does an autosave exist"
 * consumer would go stale on one and stay stale.
 *
 * Synchronous and `void`-returning by design: the write is already durable when
 * it runs, so the caller is not made to wait on a renderer broadcast, and a
 * listener that throws never turns a persisted save into a rejection.
 */
export type SlotsChangedListener = (gameId: string) => void;

/**
 * Manages all save/load persistence for the main process. Constructed once in
 * `electron/main/index.ts`; wired into the saves IPC namespace.
 */
export class SaveManager {
    private readonly log: Logger;

    constructor(
        private readonly repository: SaveRepository,
        logger: Logger,
        private readonly onSlotsChanged?: SlotsChangedListener,
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

    async save(file: SaveFile): Promise<void> {
        this.log.info('save', { gameId: file.header.gameId, slotId: file.header.slotId });
        await this.repository.save(file);
        this.notifySlotsChanged(file.header.gameId);
    }

    /**
     * Delete a slot by its qualified id.
     *
     * Deliberately does NOT notify: `delete` is reached only from the
     * `chimera:saves:delete` round-trip, which lists and broadcasts for the
     * renderer that asked. `slotId` also carries no gameId this method is
     * entitled to parse. The notification seam exists for the writes no
     * round-trip observes.
     */
    delete(slotId: string): Promise<void> {
        this.log.info('delete', { slotId });
        return this.repository.delete(slotId);
    }

    has(slotId: string): Promise<boolean> {
        return this.repository.has(slotId);
    }

    // ── Auto-save ─────────────────────────────────────────────────────────────

    /**
     * Write the file to this game's autosave slot, overwriting the input
     * `slotId` with {@link AUTOSAVE_SLOT_NAME} regardless of what was supplied.
     * This guarantees that the autosave slot is always a known, stable
     * identifier — `autosaveSlotId(gameId)` is where it lands.
     */
    async autoSave(file: SaveFile): Promise<void> {
        const autoSaveFile: SaveFile = {
            ...file,
            header: { ...file.header, slotId: AUTOSAVE_SLOT_NAME },
        };
        this.log.info('autoSave', { gameId: file.header.gameId });
        await this.repository.save(autoSaveFile);
        this.notifySlotsChanged(file.header.gameId);
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

    // ── Notification ──────────────────────────────────────────────────────────

    /**
     * Run the injected listener for a game whose slot list just changed.
     *
     * One call per notified write — no coalescing, no debounce — so the
     * notification count is a fact about writes rather than about timing. Any
     * batching a consumer wants belongs in its own listener. A listener failure
     * is reported and swallowed: the file is already on disk, and failing the
     * caller here would tell the renderer a persisted save did not happen.
     */
    private notifySlotsChanged(gameId: string): void {
        try {
            this.onSlotsChanged?.(gameId);
        } catch (error: unknown) {
            this.log.warn('slot-change listener failed; the write itself succeeded', {
                gameId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
