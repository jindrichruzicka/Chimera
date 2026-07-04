/**
 * networking/provider/seat-claims.ts
 *
 * Shared saved-seat logic for the restored-session seams (F68/#821): the
 * client-side claim sanitizer and the join-time seat resolver. Both concrete
 * providers (LocalWebSocketProvider's LobbyServer and
 * InMemoryMultiplayerProvider) delegate to `resolveRestoredSeat` so the
 * resolution policy cannot drift between them; each provider supplies only
 * its own connection/identity lookups.
 *
 * Architecture: §4.14 — Multiplayer Provider & WebSocket
 * Task: F68 / #821
 */

import {
    WIRE_MAX_JOIN_CLAIMS,
    WIRE_MAX_JOIN_CLAIM_ID_LENGTH,
} from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { PlayerId, SeatClaim } from './MultiplayerProvider.js';
import { playerId as toPlayerId } from './MultiplayerProvider.js';

// ─── Claim sanitizer ──────────────────────────────────────────────────────────

/** An id the JOIN wire schema accepts: non-empty string within the length cap. */
function isWireId(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length >= 1 &&
        value.length <= WIRE_MAX_JOIN_CLAIM_ID_LENGTH
    );
}

/**
 * Reduce caller-supplied claims to what the JOIN wire schema accepts. The host
 * validates inbound JOIN frames with a strict Zod schema and silently drops
 * any frame that fails — out-of-bounds claims sent raw would therefore hang
 * the join instead of degrading to a fresh id (AC: "malformed claims degrade
 * to a fresh id, never a crash").
 *
 * Surviving entries are rebuilt as exactly `{matchId, playerId}`: callers
 * often spread save-manifest seats, and a leaked extra key (`slotIndex`,
 * `control`, …) would fail the strict per-claim schema just like an oversize
 * id. Entries with non-string/empty/overlong ids are dropped; the result is
 * capped at the entry limit keeping the earliest entries (callers order
 * claims by preference).
 *
 * `undefined` stays `undefined` (no claims presented). An input whose entries
 * are ALL dropped returns `[]`, not `undefined` — the claims were presented,
 * so the host must still skip the claimless restored-seat fallback.
 */
export function sanitizeSeatClaims(
    claims: readonly SeatClaim[] | undefined,
): readonly SeatClaim[] | undefined {
    if (claims === undefined) return undefined;
    const sanitized: SeatClaim[] = [];
    for (const claim of claims) {
        if (sanitized.length === WIRE_MAX_JOIN_CLAIMS) break;
        if (!isWireId(claim?.matchId) || !isWireId(claim?.playerId)) continue;
        sanitized.push({ matchId: claim.matchId, playerId: claim.playerId });
    }
    return sanitized;
}

// ─── Join-time seat resolution ────────────────────────────────────────────────

/**
 * Provider-supplied lookups for {@link resolveRestoredSeat}. All predicates
 * are consulted synchronously during a single join admission.
 */
export interface SeatResolutionContext {
    /** Restored match identity a claim must equal; undefined ⇒ no claim can match. */
    readonly matchId: string | undefined;
    /** Saved host id — never grantable to a joining client. */
    readonly hostPlayerId: PlayerId | undefined;
    /**
     * Non-host restored human seats in slotIndex order (insertion-ordered
     * set). This is both the claim universe and the claimless-fallback order.
     */
    readonly restoredSeats: ReadonlySet<PlayerId>;
    /** Whether the id currently holds a live connection. */
    readonly isConnected: (pid: PlayerId) => boolean;
    /**
     * Whether the id may be reclaimed via `reconnectPlayerId`. Providers must
     * only answer true for identities that actually connected during this
     * session (and, for the local provider, were not forgotten by LEAVE) —
     * never for merely-seeded restored seats, which are reclaimed exclusively
     * through matchId-proof claims.
     */
    readonly isReconnectable: (pid: PlayerId) => boolean;
    /**
     * Whether a restored seat was already handed out once. The claimless
     * fallback never re-hands such a seat; after a drop it stays reclaimable
     * via claim (or reconnect) only.
     */
    readonly isHandedOut: (pid: PlayerId) => boolean;
}

/**
 * Resolve the identity a join is admitted under (F68/#821 priority chain):
 *
 *   1. explicit `reconnectPlayerId` for a reconnectable, disconnected,
 *      non-host identity — existing live-session behavior;
 *   2. claims presented (even `[]`): first claim whose `matchId` equals the
 *      restored match and whose seat is a restored seat not currently
 *      connected — or `undefined` (⇒ fresh id). A join asserting seats from
 *      another match never falls through to the seat fallback. Claims are
 *      checked against `restoredSeats`, not live-session memory, so an
 *      intentional LEAVE cannot orphan a saved seat;
 *   3. no claims: lowest-slotIndex restored seat never handed out and not
 *      connected (join-order fallback);
 *   4. `undefined` — the caller mints a fresh id.
 *
 * Pure: hand-out bookkeeping is the caller's, applied only after the join is
 * fully admitted so a profile-gate rejection cannot burn a seat.
 */
export function resolveRestoredSeat(
    ctx: SeatResolutionContext,
    reconnectPlayerId: PlayerId | undefined,
    claims: readonly SeatClaim[] | undefined,
): PlayerId | undefined {
    if (
        reconnectPlayerId !== undefined &&
        reconnectPlayerId !== ctx.hostPlayerId &&
        !ctx.isConnected(reconnectPlayerId) &&
        ctx.isReconnectable(reconnectPlayerId)
    ) {
        return reconnectPlayerId;
    }

    if (claims !== undefined) {
        if (ctx.matchId === undefined) return undefined;
        for (const claim of claims) {
            if (claim.matchId !== ctx.matchId) continue;
            const pid = toPlayerId(claim.playerId);
            // Host exclusion is structural: the host seat is never seeded
            // into restoredSeats.
            if (!ctx.restoredSeats.has(pid)) continue;
            if (ctx.isConnected(pid)) continue;
            return pid;
        }
        return undefined;
    }

    for (const pid of ctx.restoredSeats) {
        if (ctx.isConnected(pid)) continue;
        if (ctx.isHandedOut(pid)) continue;
        return pid;
    }

    return undefined;
}
