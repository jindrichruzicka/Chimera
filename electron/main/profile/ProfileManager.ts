/**
 * electron/main/profile/ProfileManager.ts
 *
 * Manages the local player's profile: loads from disk, builds candidates for
 * mid-lobby attestation updates, and persists only after the host ACKs.
 *
 * Architecture: §4.24 — Player Profiles & Directory
 * Task: F14-T-342 (issue #342)
 *
 * Attest-first / persist-on-ACK protocol:
 *   1. `getLocal(id)` loads from disk; sets the active profile.
 *   2. `updateLocal(patch)` builds a **candidate** (no disk write).
 *   3. The IPC handler sends the candidate over the wire.
 *   4. On host ACK  → call `acknowledgeUpdate()` to persist to disk.
 *      On host REJECT → call `discardCandidate()` to throw away the candidate.
 *
 * Invariants upheld:
 *   #2  — zero imports from renderer/, games/*, or any DOM API.
 *   #60 — Only the local machine's profiles are ever persisted here.
 */

import type {
    LocalProfileId,
    PlayerProfile,
    ProfileRepository,
} from '@chimera/simulation/profile/ProfileSchema.js';

// Convenience type: every PlayerProfile field except the immutable primary key.
type PlayerProfilePatch = Partial<Omit<PlayerProfile, 'localProfileId'>>;

// ─── Error types ──────────────────────────────────────────────────────────────

/** Thrown when `getLocal` cannot find the requested profile in the repository. */
export class ProfileNotFoundError extends Error {
    constructor(localProfileId: LocalProfileId) {
        super(`Profile not found: ${localProfileId}`);
        this.name = 'ProfileNotFoundError';
    }
}

/** Thrown when `currentAttestation` or `updateLocal` is called before a profile has been loaded. */
export class NoActiveProfileError extends Error {
    constructor() {
        super('No active profile — call getLocal() first');
        this.name = 'NoActiveProfileError';
    }
}

/** Thrown when `acknowledgeUpdate` is called but there is no pending candidate. */
export class NoPendingCandidateError extends Error {
    constructor() {
        super('No pending candidate — call updateLocal() first');
        this.name = 'NoPendingCandidateError';
    }
}

/** Thrown when `updateLocal` is called while a previous candidate is still awaiting ACK/REJECT. */
export class PendingUpdateAlreadyActiveError extends Error {
    constructor() {
        super(
            'A candidate update is already pending — call acknowledgeUpdate() or discardCandidate() first',
        );
        this.name = 'PendingUpdateAlreadyActiveError';
    }
}

// ─── ProfileManager ───────────────────────────────────────────────────────────

/**
 * Manages the local player's profile lifecycle and the attest-first update
 * protocol.
 *
 * Holds two optional in-memory slots:
 *  - `_current`   — the last successfully committed profile (loaded or ACK'd)
 *  - `_candidate` — a pending update built by `updateLocal()`, cleared on
 *                   ACK (`acknowledgeUpdate`) or REJECT (`discardCandidate`)
 */
export class ProfileManager {
    private current: PlayerProfile | null = null;
    private candidate: PlayerProfile | null = null;

    constructor(private readonly repository: ProfileRepository) {}

    /**
     * Loads a profile from the injected repository and activates it as the
     * current profile.  Throws `ProfileNotFoundError` if the profile does not
     * exist.
     */
    async getLocal(id: LocalProfileId): Promise<PlayerProfile> {
        const profile = await this.repository.load(id);
        if (profile === null) {
            throw new ProfileNotFoundError(id);
        }
        this.current = profile;
        this.candidate = null;
        return profile;
    }

    /**
     * Returns the profile that should be sent in a JOIN or PROFILE_UPDATE
     * attestation.
     *
     * If a candidate is pending (built by `updateLocal` but not yet ACK'd)
     * the candidate is returned; otherwise the committed profile is returned.
     *
     * Throws `NoActiveProfileError` when no profile has been loaded.
     */
    currentAttestation(): PlayerProfile {
        if (this.current === null) {
            throw new NoActiveProfileError();
        }
        return this.candidate ?? this.current;
    }

    /**
     * Applies `patch` to the current profile and stores the result as a
     * **candidate** — the repository is NOT written to.
     *
     * `patch` may not include `localProfileId` — the primary key is immutable.
     *
     * Throws `NoActiveProfileError` when no profile has been loaded.
     * Throws `PendingUpdateAlreadyActiveError` if a previous candidate has not
     * yet been ACK'd or REJECT'd — prevents overlapping in-flight updates.
     *
     * The caller (IPC handler) must follow up with either `acknowledgeUpdate`
     * (on host ACK) or `discardCandidate` (on host REJECT).
     *
     * Returns the candidate so the caller can transmit it over the wire.
     */
    updateLocal(patch: PlayerProfilePatch): PlayerProfile {
        if (this.current === null) {
            throw new NoActiveProfileError();
        }
        if (this.candidate !== null) {
            throw new PendingUpdateAlreadyActiveError();
        }
        this.candidate = { ...this.current, ...patch };
        return this.candidate;
    }

    /**
     * Persists the pending candidate to the repository (called after host ACK).
     *
     * Promotes the candidate to the committed profile and clears the pending
     * slot.  Throws `NoPendingCandidateError` when there is nothing to commit.
     */
    async acknowledgeUpdate(): Promise<PlayerProfile> {
        if (this.candidate === null) {
            throw new NoPendingCandidateError();
        }
        await this.repository.save(this.candidate);
        this.current = this.candidate;
        this.candidate = null;
        return this.current;
    }

    /**
     * Discards the pending candidate without writing to disk (called after
     * host REJECT).  After this call `currentAttestation()` returns the last
     * committed profile.
     */
    discardCandidate(): void {
        this.candidate = null;
    }

    /**
     * Lists all local profile slots available on this machine.
     *
     * Delegates directly to the repository — no candidate or current-profile
     * state is involved.  Returns an empty array when the repository has no
     * profiles yet.
     */
    listLocalSlots(): Promise<
        readonly { readonly localProfileId: string; readonly displayName: string }[]
    > {
        return this.repository.listLocalSlots();
    }

    /**
     * Loads the profile identified by `id` and activates it as the current
     * profile slot (§4.24).
     *
     * Identical to `getLocal` in effect — exists as a separate method so call
     * sites that mean "switch local profile" are distinguishable from call
     * sites that mean "load profile on boot".
     *
     * Throws `ProfileNotFoundError` when the requested profile does not exist.
     */
    async switchLocalSlot(id: LocalProfileId): Promise<PlayerProfile> {
        return this.getLocal(id);
    }
}
