/**
 * renderer/hooks/useReplayApi.ts
 *
 * Typed hook that wraps `window.__chimera.replay.*` for the replay browser and
 * player routes. Mirrors the pattern of `renderer/app/saves/useSavesApi.ts`.
 *
 * Both replay pages depend on this hook so no component reaches into the preload
 * bridge directly (issue #660 acceptance criterion / Invariant boundary).
 *
 * Architecture reference: §4.28 — Replay System
 *
 * Rules:
 *   - Must NOT import from: electron/main/, simulation/, games/*.
 *   - Reads `window.__chimera.replay` at call-time via getReplayBridge() so that
 *     tests can mock the bridge after module load.
 */

import { useMemo } from 'react';
import type {
    PlayerSnapshot,
    ReplayAPI,
    ReplayListItem,
    ReplayPlaybackInfo,
    Unsubscribe,
} from '@chimera/electron/preload/api-types.js';

// ── Bridge accessor ───────────────────────────────────────────────────────────

interface ChimeraBridge {
    readonly __chimera?: {
        readonly replay?: ReplayAPI;
    };
}

const MISSING_BRIDGE_ERROR = 'Chimera replay API not available';

/**
 * Returns the `ReplayAPI` slice of the preload bridge, or `null` when the bridge
 * is not available (non-Electron context, or before wiring).
 *
 * Accepts an optional `source` so tests can supply a fake global without
 * touching `globalThis`.
 */
export function getReplayBridge(source: unknown = globalThis): ReplayAPI | null {
    const bridge = source as ChimeraBridge;
    return bridge.__chimera?.replay ?? null;
}

// ── Public API type ───────────────────────────────────────────────────────────

export interface ReplayApi {
    list(gameId: string): Promise<ReplayListItem[]>;
    openInPlayer(path: string): Promise<void>;
    delete(path: string): Promise<void>;
    onNavigate(listener: (path: string) => void): Unsubscribe;
    openPlayback(path: string): Promise<ReplayPlaybackInfo>;
    snapshotAt(tick: number): Promise<PlayerSnapshot>;
    snapshotRange(from: number, to: number): Promise<PlayerSnapshot[]>;
    closePlayback(): Promise<void>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

function requireBridge(): ReplayAPI {
    const api = getReplayBridge();
    if (api === null) {
        throw new Error(MISSING_BRIDGE_ERROR);
    }
    return api;
}

/**
 * Returns a stable `ReplayApi` object that delegates each method through the
 * `window.__chimera.replay` preload bridge.
 *
 * Each method throws `Error('Chimera replay API not available')` when invoked
 * without an active bridge. The returned reference is stable across re-renders
 * (`useMemo([], [])`).
 */
export function useReplayApi(): ReplayApi {
    return useMemo(
        () => ({
            // Async wrappers so a missing-bridge throw surfaces as a rejected
            // promise (mirrors `useSavesApi`); `onNavigate` stays synchronous
            // because it must return an `Unsubscribe` immediately.
            list: async (gameId: string): Promise<ReplayListItem[]> => requireBridge().list(gameId),
            openInPlayer: async (path: string): Promise<void> => requireBridge().openInPlayer(path),
            delete: async (path: string): Promise<void> => requireBridge().delete(path),
            onNavigate: (listener: (path: string) => void): Unsubscribe =>
                requireBridge().onNavigate(listener),
            openPlayback: async (path: string): Promise<ReplayPlaybackInfo> =>
                requireBridge().openPlayback(path),
            snapshotAt: async (tick: number): Promise<PlayerSnapshot> =>
                requireBridge().snapshotAt(tick),
            snapshotRange: async (from: number, to: number): Promise<PlayerSnapshot[]> =>
                requireBridge().snapshotRange(from, to),
            closePlayback: async (): Promise<void> => requireBridge().closePlayback(),
        }),
        [],
    );
}
