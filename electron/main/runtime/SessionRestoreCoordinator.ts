/**
 * electron/main/runtime/SessionRestoreCoordinator.ts
 *
 * Menu-load restore orchestrator. When `chimera:saves:load` arrives with no
 * active session, the coordinator turns a v6 `SaveFile` into a live hosted
 * session: it sanitizes the saved `session` manifest, hosts a lobby
 * pre-seeded with the saved roster (`hostLobby({ restore })` seam), applies
 * the checkpoint through the composition root's single Invariant #24 entry
 * point (`SessionRuntime.applyRestoredFile`), seats the roster, and tracks
 * which remote human seats are still missing until the existing
 * `tryStartGame` gate can open. All-local rosters complete immediately;
 * rosters with remote seats park in `waiting-for-players` until every saved
 * remote id reconnects.
 *
 * The coordinator holds NO session objects — only restore status — so the
 * composition root remains the sole owner of session lifetime. It learns
 * about the outside world exclusively through explicit notifications
 * (`notePlayerJoined`, `noteSessionClosed`) and acts on it exclusively
 * through injected ports.
 *
 * The `onStatusChanged` subscription surface is the seam the restore-status
 * IPC push attaches to; this module itself has no IPC surface.
 *
 * Architecture reference: §4.11 / §4.14
 *
 * Invariants upheld:
 *   #24 — restores flow through the injected `applyRestoredFile` port, which
 *         the composition root binds to the one live-restore entry point;
 *         this module never touches `SessionRuntime` directly.
 *   #37/#67 — all collaborators (ports, logger) are constructor-injected.
 */

import type { PlayerId } from '@chimera-engine/networking';
import type {
    SaveFile,
    SaveSeat,
    SaveSessionManifest,
} from '@chimera-engine/simulation/persistence/SaveFile.js';
import { WIRE_MAX_JOIN_CLAIM_ID_LENGTH } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { Logger } from '../logging/logger.js';

/**
 * Defensive upper bound on restorable session size, tracking
 * `WIRE_MAX_JOIN_CLAIMS` (16, `simulation/foundation/messages-schemas.ts`) —
 * a session larger than the claim wire cap could never fully reclaim its
 * seats anyway. Primarily a corruption guard: a migrated v5 manifest derived
 * from a corrupted legacy key like `ai-1000000` would otherwise request a
 * million-slot lobby.
 */
export const MAX_RESTORED_SEATS = 16;

/**
 * Restore-specific failure with a renderer-friendly message: thrown out of
 * `restoreSession`, it propagates through the saves IPC rejection and is
 * surfaced verbatim by the saves screen.
 */
export class SessionRestoreError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionRestoreError';
    }
}

/** A `SaveSessionManifest` proven structurally sound for hosting a restore. */
export interface SanitizedRestoreManifest {
    readonly matchId: string;
    /** Effective lobby capacity — always the seat count, see below. */
    readonly maxPlayers: number;
    /** Full roster, slotIndex-ascending. */
    readonly seats: readonly SaveSeat[];
    /** The single `control: 'host'` seat. */
    readonly hostSeat: SaveSeat;
    /** Remote human seats, slotIndex-ascending — feeds `restore.humanSeats`. */
    readonly remoteSeats: readonly SaveSeat[];
}

/**
 * Validate and normalise a saved session manifest before any allocation
 * happens on its numbers.
 *
 * Rejects structural corruption (duplicate ids/slots, missing host, empty or
 * wire-overlong ids, slot indexes at or beyond {@link MAX_RESTORED_SEATS})
 * with a renderer-friendly {@link SessionRestoreError}. `maxPlayers` is
 * pinned to the seat count, IGNORING the manifest's own value: the start gate
 * compares `activePlayers.size >= maxPlayers`, so a value below the seat
 * count would start the game before every saved seat is filled, and a value
 * above it (sparse migrated v5 backfills record `highestSlot + 1`) would wait
 * forever for phantom seats no one can fill. The saved roster IS the session.
 */
export function sanitizeRestoreManifest(session: SaveSessionManifest): SanitizedRestoreManifest {
    if (session.matchId === '' || session.matchId.length > WIRE_MAX_JOIN_CLAIM_ID_LENGTH) {
        throw new SessionRestoreError(
            'saves:load: the save has an empty or invalid session matchId.',
        );
    }
    if (session.seats.length === 0) {
        throw new SessionRestoreError('saves:load: the save lists no session seats to restore.');
    }
    if (session.seats.length > MAX_RESTORED_SEATS) {
        throw new SessionRestoreError(
            `saves:load: the save lists ${session.seats.length} seats — ` +
                `at most ${MAX_RESTORED_SEATS} are restorable.`,
        );
    }

    const seenSlots = new Set<number>();
    const seenPlayers = new Set<PlayerId>();
    for (const seatEntry of session.seats) {
        // The v6 serializer schema only requires a string here, so a corrupted
        // file can carry empty or oversized ids; anything beyond the JOIN-claim
        // wire bound could never be reclaimed by its returning player anyway.
        if (
            seatEntry.playerId === '' ||
            seatEntry.playerId.length > WIRE_MAX_JOIN_CLAIM_ID_LENGTH
        ) {
            throw new SessionRestoreError(
                `saves:load: seat at slotIndex ${seatEntry.slotIndex} has an empty or ` +
                    `invalid playerId; the save file is corrupted.`,
            );
        }
        if (
            !Number.isInteger(seatEntry.slotIndex) ||
            seatEntry.slotIndex < 0 ||
            seatEntry.slotIndex >= MAX_RESTORED_SEATS
        ) {
            throw new SessionRestoreError(
                `saves:load: seat "${seatEntry.playerId}" has an invalid slotIndex ` +
                    `(${seatEntry.slotIndex}); the save file is corrupted.`,
            );
        }
        if (seenSlots.has(seatEntry.slotIndex)) {
            throw new SessionRestoreError(
                `saves:load: duplicate slotIndex ${seatEntry.slotIndex} in the saved roster.`,
            );
        }
        if (seenPlayers.has(seatEntry.playerId)) {
            throw new SessionRestoreError(
                `saves:load: duplicate playerId "${seatEntry.playerId}" in the saved roster.`,
            );
        }
        seenSlots.add(seatEntry.slotIndex);
        seenPlayers.add(seatEntry.playerId);
    }

    const hostSeats = session.seats.filter((seatEntry) => seatEntry.control === 'host');
    if (hostSeats.length !== 1) {
        throw new SessionRestoreError(
            `saves:load: the saved roster must contain exactly one host seat ` +
                `(found ${hostSeats.length}).`,
        );
    }

    const seats = [...session.seats].sort((a, b) => a.slotIndex - b.slotIndex);
    const remoteSeats = seats.filter((seatEntry) => seatEntry.control === 'remote');

    return {
        matchId: session.matchId,
        maxPlayers: seats.length,
        seats,
        hostSeat: hostSeats[0]!,
        remoteSeats,
    };
}

// ─── Coordinator ──────────────────────────────────────────────────────────────

/** Observable restore progress; pushed to every `onStatusChanged` listener. */
export type SessionRestoreStatus =
    | { readonly state: 'idle' }
    | { readonly state: 'hosting'; readonly matchId: string }
    | {
          readonly state: 'waiting-for-players';
          readonly matchId: string;
          /** Join code of the restored lobby — the waiting overlay shows it. */
          readonly lobbyCode: string;
          /** Saved remote seats that have not reconnected yet, slotIndex order. */
          readonly missingSeats: readonly PlayerId[];
      }
    | { readonly state: 'complete'; readonly matchId: string }
    | { readonly state: 'aborted'; readonly matchId: string }
    | {
          readonly state: 'failed';
          /** `''` when the failure precedes a validated matchId (sanitize) — an unvalidated id must never surface. */
          readonly matchId: string;
          readonly reason: string;
      };

/**
 * Everything the coordinator may do to the outside world. The composition
 * root (`electron/main/index.ts`) binds these to the real lobby manager and
 * session wiring; tests bind vi.fn stubs.
 */
export interface SessionRestorePorts {
    /**
     * Host a lobby pre-seeded for the restore. The composition root's
     * implementation also raises the start-suppression gate before hosting so
     * `tryStartGame` cannot fire on the pre-restore lobby snapshot.
     */
    readonly hostLobby: (params: {
        readonly maxPlayers: number;
        readonly restore: {
            readonly matchId: string;
            readonly hostPlayerId: PlayerId;
            readonly humanSeats: readonly PlayerId[];
        };
    }) => Promise<{ readonly lobbyCode: string }>;
    /**
     * Apply the loaded file to the freshly hosted session. Bound to the
     * composition root's single Invariant #24 apply helper — the coordinator
     * never touches `SessionRuntime` directly.
     */
    readonly applyRestoredFile: (file: SaveFile) => void;
    /**
     * Seat the saved roster into the hosted session (registers agents, seeds
     * the seating sets, re-adds local seats, and re-opens the start gate).
     */
    readonly seatRestoredRoster: (seats: readonly SaveSeat[]) => Promise<void>;
    /** Fully unwind the hosted session (lobby, server, port). */
    readonly closeLobby: () => Promise<void>;
}

export interface SessionRestoreCoordinatorOptions {
    readonly ports: SessionRestorePorts;
    readonly logger: Logger;
}

export type Unsubscribe = () => void;

export class SessionRestoreCoordinator {
    private readonly ports: SessionRestorePorts;
    private readonly logger: Logger;
    private readonly listeners = new Set<(status: SessionRestoreStatus) => void>();
    /** Saved remote seats still absent; insertion order = slotIndex order. */
    private readonly missing = new Set<PlayerId>();
    private current: SessionRestoreStatus = { state: 'idle' };
    private abortRequested = false;
    /**
     * True while the coordinator itself is driving `closeLobby`. The hosted
     * teardown fires `noteSessionClosed` from inside that call, which would
     * otherwise flip an in-flight unwind to a transient `aborted` before the
     * real terminal state (`failed`/`aborted`) is set by the caller.
     */
    private unwinding = false;

    constructor(options: SessionRestoreCoordinatorOptions) {
        this.ports = options.ports;
        this.logger = options.logger.child({ module: 'session-restore' });
    }

    /**
     * Orchestrate a menu-load restore. Resolves once the restore reaches
     * `complete` (all-local roster) or `waiting-for-players` (remote seats
     * outstanding — the session is hosted and the checkpoint applied; the
     * start gate opens when the last saved remote seat reconnects).
     */
    async restoreSession(file: SaveFile): Promise<void> {
        if (this.current.state === 'hosting' || this.current.state === 'waiting-for-players') {
            throw new SessionRestoreError('saves:load: a session restore is already in progress.');
        }
        if (this.current.state === 'complete') {
            throw new SessionRestoreError(
                'saves:load: a restored session is already active — close it before loading again.',
            );
        }
        this.abortRequested = false;
        this.missing.clear();

        let manifest: SanitizedRestoreManifest;
        try {
            manifest = sanitizeRestoreManifest(file.session);
        } catch (error) {
            // No validated matchId exists yet — publish '' rather than an
            // unvalidated (possibly corrupt/oversized) id.
            this.setStatus({ state: 'failed', matchId: '', reason: describeError(error) });
            throw error;
        }

        this.setStatus({ state: 'hosting', matchId: manifest.matchId });
        let lobbyCode: string;
        try {
            ({ lobbyCode } = await this.ports.hostLobby({
                maxPlayers: manifest.maxPlayers,
                restore: {
                    matchId: manifest.matchId,
                    hostPlayerId: manifest.hostSeat.playerId,
                    humanSeats: manifest.remoteSeats.map((seatEntry) => seatEntry.playerId),
                },
            }));
        } catch (error) {
            this.setStatus({
                state: 'failed',
                matchId: manifest.matchId,
                reason: describeError(error),
            });
            throw error;
        }
        if (await this.abortIfRequested(manifest.matchId)) {
            throw new SessionRestoreError('saves:load: the session restore was cancelled.');
        }

        try {
            // Apply BEFORE seating: AI agents capture their initial snapshot at
            // registration, and seating re-opens the start gate — both must see
            // the restored checkpoint, never the pre-restore lobby snapshot.
            this.ports.applyRestoredFile(file);
            await this.ports.seatRestoredRoster(manifest.seats);
        } catch (error) {
            await this.closeLobbyBestEffort();
            this.setStatus({
                state: 'failed',
                matchId: manifest.matchId,
                reason: describeError(error),
            });
            throw error;
        }
        if (await this.abortIfRequested(manifest.matchId)) {
            throw new SessionRestoreError('saves:load: the session restore was cancelled.');
        }

        for (const seatEntry of manifest.remoteSeats) {
            this.missing.add(seatEntry.playerId);
        }
        if (this.missing.size === 0) {
            this.setStatus({ state: 'complete', matchId: manifest.matchId });
        } else {
            this.setStatus({
                state: 'waiting-for-players',
                matchId: manifest.matchId,
                lobbyCode,
                missingSeats: [...this.missing],
            });
        }
    }

    /**
     * Abort an in-flight restore. While waiting, unwinds the hosted session
     * via `closeLobby`; while hosting/seating, defers the abort until the
     * pending step settles (the in-flight `restoreSession` call rejects).
     * A no-op once the restore completed — the live session is not touched.
     */
    async cancel(): Promise<void> {
        if (this.current.state === 'hosting') {
            this.abortRequested = true;
            return;
        }
        if (this.current.state !== 'waiting-for-players') {
            return;
        }
        const { matchId } = this.current;
        await this.closeLobbyBestEffort();
        this.setStatus({ state: 'aborted', matchId });
    }

    status(): SessionRestoreStatus {
        return this.current;
    }

    /**
     * Composition-root seam: called from the hosted transport's
     * `onPlayerJoined` wiring. Fills a missing saved remote seat; the last
     * fill flips the restore to `complete`. Ignored outside the waiting
     * state and for players that are not part of the saved roster.
     */
    notePlayerJoined(playerId: PlayerId): void {
        if (this.current.state !== 'waiting-for-players') {
            return;
        }
        if (!this.missing.delete(playerId)) {
            return;
        }
        if (this.missing.size === 0) {
            this.setStatus({ state: 'complete', matchId: this.current.matchId });
        } else {
            this.setStatus({
                state: 'waiting-for-players',
                matchId: this.current.matchId,
                lobbyCode: this.current.lobbyCode,
                missingSeats: [...this.missing],
            });
        }
    }

    /**
     * Composition-root seam: called from the hosted-session teardown block.
     * The session is already gone, so no `closeLobby` here — an in-flight
     * restore flips to `aborted`, a completed one back to `idle` so a later
     * menu-load can restore again.
     */
    noteSessionClosed(): void {
        // A coordinator-driven closeLobby is mid-flight: its caller sets the
        // terminal state (`failed`/`aborted`) right after; reacting here would
        // publish a transient bogus `aborted` to status listeners.
        if (this.unwinding) {
            return;
        }
        if (this.current.state === 'hosting' || this.current.state === 'waiting-for-players') {
            this.setStatus({ state: 'aborted', matchId: this.current.matchId });
            return;
        }
        if (this.current.state === 'complete') {
            this.setStatus({ state: 'idle' });
        }
    }

    /** Subscribe to status transitions (the restore-status IPC push wires here). */
    onStatusChanged(listener: (status: SessionRestoreStatus) => void): Unsubscribe {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Honour a deferred `cancel()`: unwind and mark aborted. */
    private async abortIfRequested(matchId: string): Promise<boolean> {
        if (!this.abortRequested) {
            return false;
        }
        this.abortRequested = false;
        await this.closeLobbyBestEffort();
        this.setStatus({ state: 'aborted', matchId });
        return true;
    }

    private async closeLobbyBestEffort(): Promise<void> {
        this.unwinding = true;
        try {
            await this.ports.closeLobby();
        } catch (error) {
            this.logger.warn('session-restore: closeLobby failed during unwind', {
                reason: describeError(error),
            });
        } finally {
            this.unwinding = false;
        }
    }

    private setStatus(next: SessionRestoreStatus): void {
        // Skip no-op transitions (e.g. the teardown's noteSessionClosed firing
        // after cancel() already marked the restore aborted) so listeners see
        // each state exactly once.
        if (JSON.stringify(next) === JSON.stringify(this.current)) {
            return;
        }
        this.current = next;
        for (const listener of this.listeners) {
            try {
                listener(next);
            } catch (error) {
                this.logger.warn('session-restore: status listener threw', {
                    reason: describeError(error),
                });
            }
        }
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
