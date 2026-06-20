// shared/game-manifest-contract.ts
//
// Per-game manifest: the small, pure-data descriptor each game declares about
// itself (display name, window title, real-time loop mode, optional icon).
// Lives in `shared/` with zero platform imports so BOTH the main process
// (window title + RealtimeTicker) and the renderer (game-shell display name)
// read one source of truth. The host wall-clock fields (`realtime`,
// `tickRateMs`) never enter the deterministic core — they only steer how the
// host drives `engine:tick` (Invariant #2).

/** Window title used when no game manifest supplies one. */
export const DEFAULT_WINDOW_TITLE = 'Chimera';

/**
 * Default heartbeat interval, in milliseconds, for a real-time game that does
 * not pin its own `tickRateMs`. 50ms ≈ 20Hz — the per-tick perf-budget
 * baseline (`TICK_BUDGET_MS = 16`, see {@link shared/perf-budget.ts}).
 */
export const DEFAULT_TICK_RATE_MS = 50;

/** Everything a game declares about itself, independent of platform layer. */
export interface GameManifest {
    /** Stable game id; must equal the game's `gameId` (e.g. `'tactics'`). */
    readonly gameId: string;
    /**
     * Human-facing game name (e.g. `'Tactics'`). Used for the in-game shell
     * title and, unless {@link windowTitle} overrides it, the OS window title.
     */
    readonly displayName: string;
    /**
     * OS window-title override. Falls back to {@link displayName} when omitted,
     * then to {@link DEFAULT_WINDOW_TITLE} when there is no manifest at all.
     */
    readonly windowTitle?: string;
    /**
     * When `true`, the host drives a wall-clock {@link RealtimeTicker} heartbeat
     * that dispatches `engine:tick` at {@link tickRateMs}; when `false` (the
     * default game model, e.g. tactics) the game stays action/turn-driven.
     */
    readonly realtime: boolean;
    /**
     * Heartbeat interval in milliseconds. Only consulted when {@link realtime}
     * is `true`; defaults to {@link DEFAULT_TICK_RATE_MS}. Must be finite & > 0.
     */
    readonly tickRateMs?: number;
    /**
     * Optional per-game window/app icon override (renderer-relative path).
     * Reserved for M9 F67 (App Icon & Per-Game Branding) — not yet wired;
     * absent ⇒ the default Chimera icon.
     */
    readonly icon?: string;
}

/** Resolve the OS window title for a (possibly absent) game manifest. */
export function resolveWindowTitle(manifest: GameManifest | undefined): string {
    return manifest?.windowTitle ?? manifest?.displayName ?? DEFAULT_WINDOW_TITLE;
}

/**
 * Resolve the real-time heartbeat frequency (Hz) for a manifest, converting the
 * manifest's `tickRateMs` interval into the `hz` a {@link RealtimeTicker}
 * expects. Returns `null` when the game is not real-time (so the host runs no
 * ticker). Throws on a non-positive / non-finite `tickRateMs`.
 */
export function resolveTickerHz(manifest: GameManifest | undefined): number | null {
    if (!manifest?.realtime) {
        return null;
    }
    const tickRateMs = manifest.tickRateMs ?? DEFAULT_TICK_RATE_MS;
    if (!Number.isFinite(tickRateMs) || tickRateMs <= 0) {
        throw new RangeError(
            `GameManifest('${manifest.gameId}'): tickRateMs must be a finite positive number; got ${String(
                tickRateMs,
            )}.`,
        );
    }
    return 1000 / tickRateMs;
}
