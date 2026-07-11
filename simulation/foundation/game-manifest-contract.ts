// shared/game-manifest-contract.ts
//
// Per-game manifest: the small, pure-data descriptor each game declares about
// itself (display name, window title, real-time loop mode, optional icon,
// hardware-cursor textures and logo screen). Lives in `shared/` with zero
// platform imports so BOTH the main process (window title + RealtimeTicker)
// and the renderer (game-shell display name, cursor token overrides) read one
// source of truth.
// The host wall-clock fields (`realtime`, `tickRateMs`) never enter the
// deterministic core — they only steer how the host drives `engine:tick`
// (Invariant #2).

/** Window title used when no game manifest supplies one. */
export const DEFAULT_WINDOW_TITLE = 'Chimera';

/**
 * Default heartbeat interval, in milliseconds, for a real-time game that does
 * not pin its own `tickRateMs`. 50ms ≈ 20Hz — the per-tick perf-budget
 * baseline (`TICK_BUDGET_MS = 16`, see {@link shared/perf-budget.ts}).
 */
export const DEFAULT_TICK_RATE_MS = 50;

/**
 * Named cursor roles a game may re-texture. Mirrors the engine's
 * `--ch-cursor-<role>` token family; additional contextual roles are a
 * game-side token override, not a manifest concern.
 */
export type GameCursorRole = 'default' | 'pointer' | 'disabled';

/** Cursor hotspot in image pixels, measured from the texture's top-left. */
export interface GameCursorHotspot {
    readonly x: number;
    readonly y: number;
}

/** Hotspot used when a {@link GameCursorImage} declares none: the top-left corner. */
export const DEFAULT_CURSOR_HOTSPOT: GameCursorHotspot = { x: 0, y: 0 };

/** One cursor texture declaration: an image path plus an optional hotspot. */
export interface GameCursorImage {
    /**
     * Game-asset-relative image path (same convention as {@link GameManifest.icon},
     * e.g. `'cursors/default.png'`). Opaque at this layer — only the renderer
     * resolves it, through the game-asset protocol (Invariant #20).
     */
    readonly image: string;
    /** Hotspot in image pixels; defaults to {@link DEFAULT_CURSOR_HOTSPOT}. */
    readonly hotspot?: GameCursorHotspot;
}

/**
 * Optional game-owned logo/boot-screen declaration: the renderer route of a
 * page the host boots into before the main menu in packaged builds.
 */
export interface GameLogoScreen {
    /**
     * Renderer route of the game-owned logo page (must start with `'/'`,
     * e.g. `'/logo-screen'`). Opaque route data at this layer — no URL
     * building or protocol knowledge here; only the host/renderer interpret
     * it (Invariant #20).
     */
    readonly route: `/${string}`;
}

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
     * Optional per-game window/app icon override — a game-asset-relative path
     * resolved under the game's own asset root (F67, `resolveAppIcon`); absent
     * ⇒ the default Chimera icon.
     */
    readonly icon?: string;
    /**
     * Optional hardware (texture) mouse-cursor declaration mapping cursor
     * roles to game-asset-relative images. Absent ⇒ the plain system cursor,
     * exactly as today. Paths are opaque strings here; only the renderer
     * resolves them via the game-asset protocol into `--ch-cursor-*` token
     * overrides (Invariant #20).
     */
    readonly cursor?: Partial<Record<GameCursorRole, GameCursorImage>>;
    /**
     * Optional logo/boot screen shown only in **packaged** builds
     * (`app.isPackaged`); dev and e2e boots are untouched. Absent ⇒ boot
     * straight to `/main-menu`, exactly as today. The engine never automates
     * the flow: the declared page owns its entire sequence (logos, intro
     * movies, skip handling) and exits by navigating itself to `/main-menu`
     * (via `withShellGameId`).
     */
    readonly logoScreen?: GameLogoScreen;
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

/**
 * Resolve a manifest's hardware-cursor declaration into per-role entries with
 * hotspots defaulted to {@link DEFAULT_CURSOR_HOTSPOT}. Returns `undefined`
 * when there is no manifest, no `cursor` field, or an empty declaration — all
 * behaviour-neutral: the system cursor stays. Never mutates the input.
 */
export function resolveGameCursor(
    manifest: GameManifest | undefined,
): Partial<Record<GameCursorRole, Required<GameCursorImage>>> | undefined {
    const declared = manifest?.cursor;
    if (declared === undefined) {
        return undefined;
    }
    const resolved: Partial<Record<GameCursorRole, Required<GameCursorImage>>> = {};
    for (const [role, image] of Object.entries(declared) as readonly (readonly [
        GameCursorRole,
        GameCursorImage,
    ])[]) {
        resolved[role] = { image: image.image, hotspot: image.hotspot ?? DEFAULT_CURSOR_HOTSPOT };
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/**
 * Resolve a manifest's logo-screen declaration. Returns `undefined` when
 * there is no manifest, no `logoScreen` field, or a malformed route (not a
 * string starting with `'/'`, or one carrying a `?` query / `#` fragment —
 * the host's trailing-slash normalisation would land the slash inside the
 * query and 404 the static export) — never throws, so a bad manifest can
 * never brick a packaged boot; the host just falls back to `/main-menu`.
 * Never mutates the input.
 */
export function resolveGameLogoScreen(
    manifest: GameManifest | undefined,
): GameLogoScreen | undefined {
    const route: unknown = manifest?.logoScreen?.route;
    if (
        typeof route !== 'string' ||
        !route.startsWith('/') ||
        route.includes('?') ||
        route.includes('#')
    ) {
        return undefined;
    }
    return { route: route as `/${string}` };
}
