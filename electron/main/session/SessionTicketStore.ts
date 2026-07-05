/**
 * electron/main/session/SessionTicketStore.ts
 *
 * Client-side session-ticket persistence contract (F68 #822, §4.11/§4.14).
 *
 * A `SessionTicket` remembers which seat this machine held in a match so a
 * returning client can present it as a JOIN `claims` entry and reclaim its
 * original `PlayerId` on a restored session (#821). Tickets hold opaque
 * host-minted ids only — never profile or display-name data — and live solely
 * in this client's own userData (invariants #59/#60). They never cross IPC to
 * the renderer.
 *
 * Implementations:
 *   - `FileSessionTicketStore`     — production, `<userData>/session-tickets.json`
 *   - `InMemorySessionTicketStore` — test twin
 *
 * Both must pass the shared contract suite in
 * `__test-support__/sessionTicketStoreContractTests.ts` (invariants #37/#41).
 */

import { z } from 'zod';
import { WIRE_MAX_JOIN_CLAIM_ID_LENGTH } from '@chimera-engine/simulation/foundation/messages-schemas.js';

/** One remembered seat: "in match `matchId` this client played as `playerId`". */
export interface SessionTicket {
    /** Host-minted stable match identity (`BaseGameSnapshot.matchId`, #820). */
    readonly matchId: string;
    /** The seat this client held — an opaque provider-assigned id (Inv #59/#60). */
    readonly playerId: string;
    /** Game the match belonged to; used to scope claims at the wiring point. */
    readonly gameId: string;
    /** Wall-clock ms of the most recent record, stamped by the caller. */
    readonly updatedAt: number;
}

/**
 * Maximum number of tickets retained. `record()` beyond the cap evicts the
 * least-recently-recorded ticket (LRU) so the store stays bounded no matter
 * how many matches this client joins.
 */
export const SESSION_TICKET_CAP = 32;

/**
 * Id bound for `matchId`/`playerId`, aligned to the JOIN claim wire bound: a
 * longer id could be stored but never presented — `sanitizeSeatClaims` would
 * drop it at join time, and an all-dropped list goes out as `claims: []`,
 * opting the client out of the claimless slot fallback (#821). The wire
 * snapshot schema leaves these ids unbounded, so the store enforces it.
 */
export const SESSION_TICKET_MAX_CLAIM_ID_LENGTH = WIRE_MAX_JOIN_CLAIM_ID_LENGTH;

/** Bound for `gameId` — local-only (never on the wire), so merely sane. */
export const SESSION_TICKET_MAX_GAME_ID_LENGTH = 256;

/**
 * Runtime shape of a valid {@link SessionTicket}. Shared by `record()`
 * validation in both implementations and by `FileSessionTicketStore`'s
 * per-ticket load filtering, so the write and read boundaries can never
 * drift apart again.
 */
export const SessionTicketSchema = z.object({
    matchId: z.string().min(1).max(SESSION_TICKET_MAX_CLAIM_ID_LENGTH),
    playerId: z.string().min(1).max(SESSION_TICKET_MAX_CLAIM_ID_LENGTH),
    gameId: z.string().min(1).max(SESSION_TICKET_MAX_GAME_ID_LENGTH),
    updatedAt: z.number().finite(),
});

/** Thrown (as a rejection) by `record()` when a ticket fails validation. */
export class InvalidSessionTicketError extends Error {
    constructor(detail: string) {
        super(`Invalid session ticket: ${detail}`);
        this.name = 'InvalidSessionTicketError';
    }
}

/**
 * Validate a ticket, returning the error instead of throwing so
 * Promise-returning non-async `record()` implementations can reject rather
 * than throw synchronously (the production caller is fire-and-forget).
 */
export function validateSessionTicket(ticket: SessionTicket): InvalidSessionTicketError | null {
    const result = SessionTicketSchema.safeParse(ticket);
    if (result.success) return null;
    const issue = result.error.issues[0];
    return new InvalidSessionTicketError(
        issue === undefined ? 'unknown' : `${issue.path.join('.')}: ${issue.message}`,
    );
}

/**
 * Bounded LRU store of this client's session tickets.
 *
 * The concrete implementation is chosen once in `electron/main/index.ts`
 * (invariant #37); everything else depends on this interface.
 */
export interface SessionTicketStore {
    /**
     * Upsert a ticket keyed by `matchId`, making it the most recent. Evicts
     * the least-recently-recorded ticket when the cap is exceeded. Rejects
     * with {@link InvalidSessionTicketError} (never throws synchronously)
     * when the ticket fails {@link SessionTicketSchema} validation, storing
     * nothing.
     */
    record(ticket: SessionTicket): Promise<void>;
    /** All retained tickets, most-recently-recorded first. */
    claims(): Promise<readonly SessionTicket[]>;
}
