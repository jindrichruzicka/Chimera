/**
 * The two replay kinds (§4.28) that coexist in the renderer and a parser for the player
 * route's `?kind=` query param. Deterministic replays drive
 * `window.__chimera.replay.*`; perspective replays drive
 * `window.__chimera.replay.perspective.*` and lock playback to a single
 * recorded viewer with no seat switching (Invariant #98).
 *
 * Shared by the replay browser, the player route, and `ReplayControls` so the
 * `kind` discriminator has a single source of truth.
 */

export type ReplayKind = 'deterministic' | 'perspective';

/**
 * Parse a `?kind=` query value into a {@link ReplayKind}, defaulting to
 * `'deterministic'` for any absent or unrecognised value. The shared,
 * path-only `chimera:replay:navigate` push carries no kind, so a deterministic
 * default keeps the existing navigate flow unchanged.
 */
export function parseReplayKind(raw: string | null): ReplayKind {
    return raw === 'perspective' ? 'perspective' : 'deterministic';
}
