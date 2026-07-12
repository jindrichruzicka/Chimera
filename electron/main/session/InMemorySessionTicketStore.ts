/**
 * In-memory `SessionTicketStore` twin (invariant #41).
 *
 * Behaviourally identical to `FileSessionTicketStore` for the same inputs —
 * both run the shared contract suite in
 * `__test-support__/sessionTicketStoreContractTests.ts`. Used by unit and
 * integration tests that must not touch the real filesystem.
 *
 * Recency is the Map's insertion order: `record()` deletes then re-sets the
 * key, so the last entry is always the most recently recorded and eviction
 * removes the first (least-recent) key.
 */

import type { SessionTicket, SessionTicketStore } from './SessionTicketStore.js';
import { SESSION_TICKET_CAP, validateSessionTicket } from './SessionTicketStore.js';

export class InMemorySessionTicketStore implements SessionTicketStore {
    /** matchId → ticket; insertion order encodes recency (oldest first). */
    private readonly tickets = new Map<string, SessionTicket>();

    record(ticket: SessionTicket): Promise<void> {
        const invalid = validateSessionTicket(ticket);
        if (invalid !== null) {
            return Promise.reject(invalid);
        }
        this.tickets.delete(ticket.matchId);
        this.tickets.set(ticket.matchId, { ...ticket });

        while (this.tickets.size > SESSION_TICKET_CAP) {
            const oldest = this.tickets.keys().next().value;
            if (oldest === undefined) break;
            this.tickets.delete(oldest);
        }
        return Promise.resolve();
    }

    claims(): Promise<readonly SessionTicket[]> {
        return Promise.resolve([...this.tickets.values()].reverse());
    }
}
