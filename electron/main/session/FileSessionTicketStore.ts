/**
 * Filesystem-backed `SessionTicketStore` (§4.11/§4.14).
 *
 * All tickets live in a single JSON file — in production
 * `<userData>/session-tickets.json`, injected by the composition root
 * (`electron/main/index.ts`, invariant #37); this class never calls
 * `app.getPath` or imports Electron. Tests pass a temp path.
 *
 * Durability and recovery:
 *   - Writes are crash-atomic: `.tmp` + `fh.sync()` + rename, with the `.tmp`
 *     artefact unlinked on rename failure (invariant #23).
 *   - A missing, unreadable, corrupt, or future-versioned file degrades to an
 *     empty store with a warn log — losing tickets only costs a convenience
 *     reclaim; crashing the client would cost the session. Within a valid
 *     envelope, invalid ticket entries are skipped individually (warn log)
 *     so one bad entry never wipes the other remembered seats.
 *   - `record()` calls are serialised through an internal promise chain so
 *     concurrent fire-and-forget records cannot interleave the
 *     read-modify-write cycle and drop tickets.
 *
 * On-disk order is oldest-first (recency = position); loads clamp to the
 * newest `SESSION_TICKET_CAP` entries.
 *
 * Invariants upheld:
 *   #2      — zero imports from renderer/, games/*, or any DOM API.
 *   #59/#60 — opaque ids only, this machine's own tickets only.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

import type { Logger } from '../logging/logger.js';
import { createNoopLogger } from '../logging/logger.js';
import type { SessionTicket, SessionTicketStore } from './SessionTicketStore.js';
import {
    SESSION_TICKET_CAP,
    SessionTicketSchema,
    validateSessionTicket,
} from './SessionTicketStore.js';

/**
 * Versioned envelope so a future format change can migrate instead of guess.
 * Entries stay `unknown` here: each ticket is validated individually on load
 * so one invalid entry (hand-edited or written by a pre-hardening build)
 * costs only itself, never the whole store.
 */
const TicketsFileSchema = z.object({
    version: z.literal(1),
    tickets: z.array(z.unknown()),
});

export class FileSessionTicketStore implements SessionTicketStore {
    private readonly log: Logger;
    /** Serialises record() read-modify-write cycles (see class docs). */
    private queue: Promise<void> = Promise.resolve();

    constructor(
        private readonly filePath: string,
        logger: Logger = createNoopLogger(),
    ) {
        this.log = logger;
    }

    record(ticket: SessionTicket): Promise<void> {
        const invalid = validateSessionTicket(ticket);
        if (invalid !== null) {
            return Promise.reject(invalid);
        }
        const run = this.queue.then(async () => {
            const tickets = await this.load();
            tickets.delete(ticket.matchId);
            // Rebuild explicitly so stray properties never reach disk.
            tickets.set(ticket.matchId, {
                matchId: ticket.matchId,
                playerId: ticket.playerId,
                gameId: ticket.gameId,
                updatedAt: ticket.updatedAt,
            });
            while (tickets.size > SESSION_TICKET_CAP) {
                const oldest = tickets.keys().next().value;
                if (oldest === undefined) break;
                tickets.delete(oldest);
            }
            await this.write([...tickets.values()]);
        });
        // Keep the chain alive after a failure; the caller still observes the
        // rejection through `run`.
        this.queue = run.catch(() => undefined);
        return run;
    }

    async claims(): Promise<readonly SessionTicket[]> {
        // Drain in-flight records so a read after a record sees its effect.
        await this.queue;
        const tickets = await this.load();
        return [...tickets.values()].reverse();
    }

    // ── Private helpers ──────────────────────────────────────────────────

    /** matchId → ticket; insertion order encodes recency (oldest first). */
    private async load(): Promise<Map<string, SessionTicket>> {
        let raw: string;
        try {
            raw = await fs.readFile(this.filePath, 'utf8');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return new Map();
            }
            this.log.warn('session-tickets file unreadable — degrading to empty', {
                filePath: this.filePath,
                error: (err as Error).message,
            });
            return new Map();
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.log.warn('session-tickets file is not valid JSON — degrading to empty', {
                filePath: this.filePath,
            });
            return new Map();
        }

        const result = TicketsFileSchema.safeParse(parsed);
        if (!result.success) {
            this.log.warn(
                'session-tickets envelope failed schema validation — degrading to empty',
                {
                    filePath: this.filePath,
                },
            );
            return new Map();
        }

        // Validate per ticket: one bad entry costs only itself. Clamp AFTER
        // filtering so invalid entries cannot crowd out valid ones.
        const map = new Map<string, SessionTicket>();
        let skipped = 0;
        const valid: SessionTicket[] = [];
        for (const entry of result.data.tickets) {
            const ticket = SessionTicketSchema.safeParse(entry);
            if (ticket.success) {
                valid.push(ticket.data);
            } else {
                skipped += 1;
            }
        }
        if (skipped > 0) {
            this.log.warn('skipped invalid session-ticket entries on load', {
                filePath: this.filePath,
                skipped,
            });
        }
        for (const ticket of valid.slice(-SESSION_TICKET_CAP)) {
            map.delete(ticket.matchId);
            map.set(ticket.matchId, ticket);
        }
        return map;
    }

    private async write(tickets: readonly SessionTicket[]): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });

        const tmp = `${this.filePath}.tmp`;
        const payload = JSON.stringify({ version: 1, tickets });

        const fh = await fs.open(tmp, 'w');
        try {
            await fh.writeFile(payload, 'utf8');
            await fh.sync();
        } finally {
            await fh.close();
        }

        try {
            await fs.rename(tmp, this.filePath);
        } catch (err) {
            await fs.unlink(tmp).catch(() => undefined); // best-effort cleanup
            throw err;
        }
    }
}
