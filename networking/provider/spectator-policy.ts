/**
 * networking/provider/spectator-policy.ts
 *
 * Shared spectator-admission policy constants, referenced by both the local
 * WebSocket provider (LobbyServer) and the in-memory provider so their
 * observable spectator behaviour stays in lockstep (Invariant #41 / #114).
 *
 * Lives at the provider root — not under local/ — so the in-memory provider can
 * import it without crossing the `networking/provider/local/` boundary.
 */

/**
 * Default cap on concurrent spectators when the host does not set one.
 * Spectators are read-only viewers that never consume a player seat; this bounds
 * their count independently of `maxPlayers`.
 */
export const DEFAULT_MAX_SPECTATORS = 8;
