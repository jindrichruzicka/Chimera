/**
 * electron/main/saves/SavesIpcAdapter.ts
 *
 * Production adapter that turns a {@link SaveManager} (which speaks the
 * simulation-side `SaveFile` / `SaveSlotMeta` vocabulary defined in
 * `simulation/persistence`) into the {@link SavesIpcPort} consumed by the
 * `chimera:saves:*` IPC handlers (which speak the preload-side
 * `SaveSlotMeta` vocabulary defined in `electron/preload/api-types.ts`).
 *
 * Two shape conversions happen here:
 *
 *   1. Simulation `SaveSlotMeta` (with `turnNumber`, `playerNames`,
 *      `turnNumber`, `playerNames`, `sizeBytes`, `schemaVersion`) → preload
 *      `SaveSlotMeta` (with checkpoint `tick`, `label?`). Simulation-only
 *      fields stay inside main and never cross IPC.
 *
 *   2. `SaveRequest` (gameId + optional slotId/label) → `SaveFile`
 *      (full simulation memento). The capture step is delegated to the
 *      injected `captureSaveFile` callback because state capture requires
 *      access to the running simulation host (F18 territory). The adapter
 *      itself never touches the simulation directly.
 *
 * Architecture reference: §4.11
 * Task: F18 / issue #372
 *
 * Invariants upheld:
 *   #25 — Inputs reaching this module are already validated by the IPC
 *         handler's Zod schemas; this module performs no boundary
 *         validation of its own.
 *   #37 — No concrete repository class is imported; the adapter wraps a
 *         {@link SaveManager} which itself injects a `SaveRepository`.
 *   #67 — Constructed with an injected logger.
 */

import {
    toSlotId,
    type SaveSlotMeta as PreloadSaveSlotMeta,
    type SaveRequest,
} from '../../preload/api-types.js';
import type { SaveFile } from '@chimera-engine/simulation/persistence/SaveFile.js';
import type { SaveSlotMeta as SimSaveSlotMeta } from '@chimera-engine/simulation/persistence/SaveRepository.js';
import type { SavesIpcPort } from '../ipc/ipc-handlers.js';
import type { Logger } from '../logging/logger.js';
import type { SaveManager } from './SaveManager.js';

/**
 * Capture the running simulation state for a given {@link SaveRequest}.
 *
 * Lives in F18 / SimulationHost wiring — the adapter is intentionally
 * agnostic of how state is captured so this module remains testable
 * without spinning up a full host.
 */
export type SaveFileCapture = (request: SaveRequest) => Promise<SaveFile>;

/**
 * Restore a previously persisted {@link SaveFile} into a playable session.
 *
 * Lives in composition-root wiring (`electron/main/index.ts`), which decides
 * between the two supported flows (#823): with an active session the file is
 * live-applied via `SessionRuntime.applyRestoredFile` (Invariant #24); with
 * no active session the `SessionRestoreCoordinator` hosts a restored session
 * seeded from `SaveFile.session` and applies the checkpoint through that same
 * entry point.  Rejections (e.g. loading a different match into a live
 * session) propagate to the renderer as the load IPC rejection.
 */
export type SessionRestoreRequest = (file: SaveFile) => Promise<void>;

export interface CreateSavesIpcPortOptions {
    readonly saveManager: SaveManager;
    readonly captureSaveFile: SaveFileCapture;
    /**
     * Awaited after `SaveManager.restoreFromSave(slotId)` resolves with the
     * loaded {@link SaveFile}.  When omitted, load behaves as a pure file
     * fetch — useful for tests exercising only the fetch/convert half.
     */
    readonly restoreSession?: SessionRestoreRequest;
    readonly logger: Logger;
}

/**
 * Build a {@link SavesIpcPort} backed by `SaveManager`. The returned port
 * is the value passed to `registerSavesHandlers({ saves })` in
 * `electron/main/index.ts`.
 */
export function createSavesIpcPort(options: CreateSavesIpcPortOptions): SavesIpcPort {
    const { saveManager, captureSaveFile, restoreSession, logger } = options;
    const log = logger.child({ module: 'saves-ipc-adapter' });

    return {
        list: async (gameId) => {
            const slots = await saveManager.list(gameId);
            return slots.map(toPreloadMeta);
        },
        save: async (request) => {
            const file = await captureSaveFile(request);
            await saveManager.save(file);
            log.info('save persisted', {
                gameId: file.header.gameId,
                slotId: file.header.slotId,
            });
            const meta = simMetaFromFile(file);
            return mergeLabel(toPreloadMeta(meta), request.label);
        },
        load: async (slotId) => {
            const file = await saveManager.restoreFromSave(slotId);
            if (restoreSession !== undefined) {
                await restoreSession(file);
                log.info('save restored', { slotId });
            }
            // The preload contract returns void; the renderer's role is
            // limited to triggering the load.
        },
        delete: async (slotId) => {
            await saveManager.delete(slotId);
        },
    };
}

/**
 * Project a simulation `SaveSlotMeta` onto the preload `SaveSlotMeta`
 * shape. The checkpoint simulation tick becomes the renderer-facing `tick`;
 * legacy test doubles that do not provide it fall back to `turnNumber`.
 * `playerNames`, `sizeBytes`, `schemaVersion`, and `thumbnailDataUrl` are
 * intentionally dropped because the preload type does not carry them.
 */
function toPreloadMeta(meta: SimSaveSlotMeta): PreloadSaveSlotMeta {
    return {
        slotId: toSlotId(meta.slotId),
        gameId: meta.gameId,
        tick: meta.tick ?? meta.turnNumber,
        savedAt: meta.savedAt,
    };
}

/**
 * Build a simulation-side `SaveSlotMeta` from the freshly-captured file.
 * Used immediately after `SaveManager.save()` so the renderer receives
 * accurate metadata for the saved slot without an extra repository
 * round-trip.
 *
 * The qualified `slotId` follows the same `'<gameId>/<slotName>'`
 * convention used by the repository's `list()` results.
 */
function simMetaFromFile(file: SaveFile): SimSaveSlotMeta {
    return {
        slotId: `${file.header.gameId}/${file.header.slotId}`,
        gameId: file.header.gameId,
        tick: file.checkpoint.tick,
        savedAt: file.header.savedAt,
        turnNumber: file.header.turnNumber,
        playerNames: file.header.playerNames,
        schemaVersion: file.header.schemaVersion,
        sizeBytes: 0,
    };
}

/** Attach an optional label to a preload `SaveSlotMeta`. */
function mergeLabel(meta: PreloadSaveSlotMeta, label: string | undefined): PreloadSaveSlotMeta {
    if (label === undefined) {
        return meta;
    }
    return { ...meta, label };
}
