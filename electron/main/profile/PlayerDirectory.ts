/**
 * electron/main/profile/PlayerDirectory.ts
 *
 * Host-only, in-memory aggregation of all connected clients' sanitised
 * profiles.  Session-scoped: cleared on lobby close via `reset()`.
 *
 * Architecture: §4.24 — Player Profiles & Directory
 * Task: F14-T-342 (issue #342)
 *
 * Design constraints:
 *   - Profiles must have already passed `ProfileSanitizer.admit()` before
 *     being passed to `add()` or `update()` (invariant #61).
 *   - Remote profiles live ONLY in this in-memory store; they are never
 *     written to `ProfileRepository` (invariant #60).
 *
 * Invariants upheld:
 *   #2  — zero imports from renderer/, games/*, or any DOM API.
 *   #60 — Remote clients' profiles never reach ProfileRepository.
 *   #61 — PlayerDirectory trusts its callers to only pass sanitised profiles.
 */

import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';
import { EngineProfileSchema } from '@chimera-engine/simulation/profile/ProfileSchema.js';
import type { PlayerProfile } from '@chimera-engine/simulation/profile/ProfileSchema.js';

// ─── Error types ──────────────────────────────────────────────────────────────

/** Thrown when `add` is called for a player that is already in the directory. */
export class PlayerAlreadyExistsError extends Error {
    constructor(id: PlayerId) {
        super(`Player already in directory: ${id}`);
        this.name = 'PlayerAlreadyExistsError';
    }
}

/** Thrown when `update` or `remove` is called for a player not in the directory. */
export class PlayerNotFoundError extends Error {
    constructor(id: PlayerId) {
        super(`Player not found in directory: ${id}`);
        this.name = 'PlayerNotFoundError';
    }
}

// ─── PlayerDirectory ──────────────────────────────────────────────────────────

/**
 * Host-only, session-scoped registry of all lobby participants' profiles.
 *
 * `snapshot()` returns a frozen copy — callers cannot mutate the internal
 * state through the returned reference.
 *
 * Must be created fresh per lobby session (or `reset()` called on lobby close)
 * so that profiles do not bleed across sessions.
 */
export class PlayerDirectory {
    private readonly profiles = new Map<PlayerId, PlayerProfile>();

    /**
     * Validates `profile` structurally using `EngineProfileSchema`.
     *
     * This is a runtime guard for invariant #61: only profiles that have
     * already passed `ProfileSanitizer.admit()` should reach this class.
     * A branded `SanitisedProfile` type would give compile-time enforcement;
     * this Zod parse catches accidental bypasses at runtime.
     */
    private static validate(profile: PlayerProfile): void {
        EngineProfileSchema.parse(profile);
    }

    /**
     * Registers a pre-sanitised profile for a newly connected player.
     *
     * @throws {PlayerAlreadyExistsError} if the player is already in the
     *   directory.  Use `update()` to replace an existing entry.
     */
    add(id: PlayerId, profile: PlayerProfile): void {
        PlayerDirectory.validate(profile);
        if (this.profiles.has(id)) {
            throw new PlayerAlreadyExistsError(id);
        }
        // Freeze the top-level profile object so snapshot() returns immutable
        // references — prevents callers from mutating directory state through
        // the snapshot.  Note: this is a shallow freeze; nested objects (e.g.
        // avatar) are protected at the TypeScript level via readonly fields.
        this.profiles.set(id, Object.freeze({ ...profile }));
    }

    /**
     * Replaces the profile for an existing player (e.g. after a mid-lobby
     * profile update is ACK'd).
     *
     * @throws {PlayerNotFoundError} if the player is not in the directory.
     */
    update(id: PlayerId, profile: PlayerProfile): void {
        PlayerDirectory.validate(profile);
        if (!this.profiles.has(id)) {
            throw new PlayerNotFoundError(id);
        }
        this.profiles.set(id, Object.freeze({ ...profile }));
    }

    /**
     * Removes a player from the directory (e.g. on disconnect).
     *
     * @throws {PlayerNotFoundError} if the player is not in the directory.
     */
    remove(id: PlayerId): void {
        if (!this.profiles.has(id)) {
            throw new PlayerNotFoundError(id);
        }
        this.profiles.delete(id);
    }

    /**
     * Returns a frozen snapshot of the current directory keyed by `PlayerId`.
     *
     * The container object is frozen and each individual profile was already
     * frozen on insert, so no entry can be mutated through the snapshot.
     * Each call returns a new shallow copy of the container.
     */
    snapshot(): Readonly<Record<PlayerId, PlayerProfile>> {
        return Object.freeze(Object.fromEntries(this.profiles));
    }

    /**
     * Clears all entries.  Call this on lobby close to prevent stale profiles
     * from persisting into the next session.
     */
    reset(): void {
        this.profiles.clear();
    }
}
