/**
 * electron/main/profile/ProfileGate.ts
 *
 * Collaborator that wraps ProfileSanitizer.admit() + PlayerDirectory so that
 * LobbyManager remains a pure orchestrator and does not import domain logic
 * from simulation/.
 *
 * Invariant #61 — admit() is the mandatory gate between inbound JOIN attestation
 * and PlayerDirectory.  This is the ONLY place that may call admit().
 *
 * Wiring point: electron/main/index.ts constructs a ProfileGate via
 * createProfileGate() and injects it into LobbyManager.
 */

import { admit } from '@chimera-engine/simulation/profile/ProfileSanitizer.js';
import type { PlayerDirectory } from './PlayerDirectory.js';
import type { JoinGateResult, PlayerId } from '@chimera-engine/networking';
import type { PlayerProfile } from '@chimera-engine/simulation/profile/ProfileSchema.js';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Result returned by ProfileGate.update().
 *
 * - `ok: true`  → the profile was admitted and PlayerDirectory was updated.
 * - `ok: false` → admission failed; `reason` is `'profile:<AdmissionRejection>'`.
 */
export type ProfileUpdateResult =
    | { readonly ok: true; readonly profile: PlayerProfile }
    | { readonly ok: false; readonly reason: string };

/**
 * Minimal surface exposed to LobbyManager.
 *
 * - `check`        — called once per incoming JOIN; returned to HostTransport.setProfileGate().
 * - `update`       — called for mid-lobby PROFILE_UPDATE side-channel messages.
 * - `onLobbyClose` — called by LobbyManager.closeLobby() to reset the directory.
 */
export interface ProfileGate {
    readonly check: (pid: PlayerId, rawProfile: unknown) => JoinGateResult;
    /**
     * Validates a mid-lobby PROFILE_UPDATE attestation and, on success, calls
     * PlayerDirectory.update() with the sanitised profile.
     *
     * Invariant #61 — this is the only authorised caller of ProfileSanitizer.admit()
     * for PROFILE_UPDATE messages.
     *
     * @param pid        - PlayerId of the updating player (from transport 'from' param).
     * @param rawProfile - Raw payload from the PROFILE_UPDATE side-channel message.
     */
    readonly update: (pid: PlayerId, rawProfile: unknown) => ProfileUpdateResult;
    readonly onLobbyClose: () => void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build a ProfileGate backed by the given PlayerDirectory.
 *
 * The returned `check` function:
 *   1. Snapshots the current directory to derive the set of existing local IDs.
 *   2. Delegates to ProfileSanitizer.admit() for all structural, size, and
 *      namespace checks.
 *   3. On admission, adds the sanitised profile to the directory and returns
 *      the canonicalised displayName for the lobby roster.
 *   4. On rejection, returns the reason string so the transport can send REJECT.
 *
 * The returned `update` function:
 *   1. Excludes the updating player's own localProfileId from the collision set.
 *   2. Delegates to ProfileSanitizer.admit() for all checks.
 *   3. On admission, replaces the directory entry via PlayerDirectory.update().
 *   4. On rejection, returns the reason string so LobbyManager can send REJECT.
 */
export function createProfileGate(directory: PlayerDirectory): ProfileGate {
    return {
        check(pid: PlayerId, rawProfile: unknown): JoinGateResult {
            const dirSnapshot = directory.snapshot();
            const existingLocalIds = new Set(
                // admit() takes ReadonlySet<string>; LocalProfileId is a branded string
                // alias — widening to string is safe here because the Set is consumed
                // only as an opaque membership check inside admit().
                Object.entries(dirSnapshot)
                    .filter(([p]) => p !== pid)
                    .map(([, profile]) => profile.localProfileId as string),
            );
            const result = admit(rawProfile, existingLocalIds);
            if (!result.ok) {
                return { admitted: false, reason: `profile:${result.reason}` };
            }
            if (dirSnapshot[pid] === undefined) {
                directory.add(pid, result.profile);
            } else {
                directory.update(pid, result.profile);
            }
            return { admitted: true, displayName: result.profile.displayName };
        },

        update(pid: PlayerId, rawProfile: unknown): ProfileUpdateResult {
            const dirSnapshot = directory.snapshot();
            // Exclude the updating player's own localProfileId so they can keep
            // their existing ID without triggering a NAMESPACE_COLLISION.
            const existingLocalIds = new Set(
                Object.entries(dirSnapshot)
                    .filter(([p]) => p !== pid)
                    // admit() takes ReadonlySet<string>; LocalProfileId is a branded
                    // string alias — widening to string is safe here because the Set
                    // is consumed only as an opaque membership check inside admit().
                    .map(([, profile]) => profile.localProfileId as string),
            );
            const result = admit(rawProfile, existingLocalIds);
            if (!result.ok) {
                return { ok: false, reason: `profile:${result.reason}` };
            }
            directory.update(pid, result.profile);
            return { ok: true, profile: result.profile };
        },

        onLobbyClose(): void {
            // Clear stale profiles so they do not bleed into the next session
            // (Invariant #61 + architecture §4.24).
            directory.reset();
        },
    };
}
