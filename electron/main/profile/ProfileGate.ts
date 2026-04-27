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

import { admit } from '@chimera/simulation/profile/ProfileSanitizer.js';
import type { PlayerDirectory } from './PlayerDirectory.js';
import type { JoinGateResult, PlayerId } from '@chimera/networking/provider/MultiplayerProvider.js';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Minimal surface exposed to LobbyManager.
 *
 * - `check`       — called once per incoming JOIN; returned to HostTransport.setProfileGate().
 * - `onLobbyClose` — called by LobbyManager.closeLobby() to reset the directory.
 */
export interface ProfileGate {
    readonly check: (pid: PlayerId, rawProfile: unknown) => JoinGateResult;
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
 */
export function createProfileGate(directory: PlayerDirectory): ProfileGate {
    return {
        check(pid: PlayerId, rawProfile: unknown): JoinGateResult {
            const dirSnapshot = directory.snapshot();
            const existingLocalIds = new Set(
                // admit() takes ReadonlySet<string>; LocalProfileId is a branded string
                // alias — widening to string is safe here because the Set is consumed
                // only as an opaque membership check inside admit().
                Object.values(dirSnapshot).map((p) => p.localProfileId as string),
            );
            const result = admit(rawProfile, existingLocalIds);
            if (!result.ok) {
                return { admitted: false, reason: `profile:${result.reason}` };
            }
            directory.add(pid, result.profile);
            return { admitted: true, displayName: result.profile.displayName };
        },

        onLobbyClose(): void {
            // Clear stale profiles so they do not bleed into the next session
            // (Invariant #61 + architecture §4.24).
            directory.reset();
        },
    };
}
