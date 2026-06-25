/**
 * renderer/app/saves/useSavesApi.ts
 *
 * Typed hook that wraps `window.__chimera.saves.*` for use in the SavesPage
 * and any other renderer component that needs save/load/delete operations.
 *
 * Mirrors the pattern of `renderer/app/lobby/useLobbyApi.ts`.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #374 (WARN-1)
 *
 * Rules:
 *   - Must NOT import from: electron/main/, simulation/engine/, networking/.
 *   - Reads `window.__chimera.saves` at call-time via getSavesBridge() so that
 *     tests can mock the bridge after module load.
 */

import { useMemo } from 'react';
import type {
    CrashRecoveryStatus,
    SaveRequest,
    SaveSlotMeta,
    SavesAPI,
    SlotId,
} from '@chimera/simulation/bridge/api-types.js';

// ── Bridge accessor ───────────────────────────────────────────────────────────

interface ChimeraBridge {
    readonly __chimera?: {
        readonly saves?: SavesAPI;
    };
}

const MISSING_BRIDGE_ERROR = 'Chimera saves API not available';

/**
 * Returns the `SavesAPI` slice of the preload bridge, or `null` when the
 * bridge is not available (e.g. in a non-Electron context or before wiring).
 *
 * Accepts an optional `source` parameter so tests can supply a fake global
 * without touching `globalThis`.
 */
export function getSavesBridge(source: unknown = globalThis): SavesAPI | null {
    const bridge = source as ChimeraBridge;
    return bridge.__chimera?.saves ?? null;
}

// ── Public API type ───────────────────────────────────────────────────────────

export interface SavesApi {
    save(request: SaveRequest): Promise<SaveSlotMeta>;
    load(slotId: SlotId): Promise<void>;
    delete(slotId: SlotId): Promise<void>;
    checkCrashRecovery(): Promise<CrashRecoveryStatus>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns a stable `SavesApi` object that delegates each method through the
 * `window.__chimera.saves` preload bridge.
 *
 * Throws `Error('Chimera saves API not available')` when called without an
 * active bridge (i.e. outside Electron, before preload wiring).
 *
 * Reference is stable across re-renders (`useMemo([], [])`).
 */
export function useSavesApi(): SavesApi {
    return useMemo(
        () => ({
            async save(request: SaveRequest): Promise<SaveSlotMeta> {
                const api = getSavesBridge();
                if (!api) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                return api.save(request);
            },

            async load(slotId: SlotId): Promise<void> {
                const api = getSavesBridge();
                if (!api) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                return api.load(slotId);
            },

            async delete(slotId: SlotId): Promise<void> {
                const api = getSavesBridge();
                if (!api) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                return api.delete(slotId);
            },

            async checkCrashRecovery(): Promise<CrashRecoveryStatus> {
                const api = getSavesBridge();
                if (!api) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }
                return api.checkCrashRecovery();
            },
        }),
        [],
    );
}
