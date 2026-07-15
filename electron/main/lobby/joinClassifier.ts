/**
 * electron/main/lobby/joinClassifier.ts
 *
 * Pure host-policy decision function for classifying a JOIN once it is token +
 * profile valid: player, spectator, or reject. Kept side-effect-free and free
 * of transport/session state so it is exhaustively unit-testable — the host
 * gathers the live inputs (match phase, reconnect, game capability, toggle) in
 * index.ts and delegates the decision here, mirroring how ProfileGate isolates
 * the profile-admission decision.
 *
 * Architecture: §4.14 — LobbyServer JOIN handshake / spectator admission.
 * Prepares Invariant #114 — spectators are read-only session viewers, admitted
 * only in a running match when the game declares spectator capability AND the
 * host has enabled it, else REJECT `match_in_progress` (or `spectators_disabled`
 * when the capability exists but the host left the toggle off).
 */

import { gamePhase, type GamePhase } from '@chimera-engine/simulation/engine/types.js';
import type { GameSpectatorSupport } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import {
    REJECT_REASON_MATCH_IN_PROGRESS,
    REJECT_REASON_SPECTATORS_DISABLED,
} from '@chimera-engine/simulation/foundation/messages.js';
import type { JoinClassification } from '@chimera-engine/networking';

/** Inputs the host resolves for a single JOIN before classifying it. */
export interface JoinClassificationInput {
    /** Current authoritative match phase (`GameSnapshot.phase`). */
    readonly phase: GamePhase;
    /** The JOIN resolved to a retained/registered seat — a reconnect. */
    readonly reconnect: boolean;
    /** Resolved game spectator capability (`resolveSpectatorSupport(manifest)`). */
    readonly spectatorSupport: GameSpectatorSupport | undefined;
    /** Host `allowSpectators` match-setting (`readAllowSpectators(matchSettings)`). */
    readonly allowSpectators: boolean;
}

const LOBBY_PHASE = gamePhase('lobby');

/**
 * Decide how a token + profile-valid JOIN is admitted.
 *
 * - Lobby phase → `player` (unchanged; covers both fresh joins and reconnects).
 * - Reconnect in any phase → `player` (unchanged re-sync of a retained seat).
 * - Running-match fresh join → `spectator` when the game is spectator-capable
 *   AND the host toggle is on; otherwise a clean reject: `spectators_disabled`
 *   when the capability exists but the toggle is off, else `match_in_progress`.
 */
export function classifyJoin(input: JoinClassificationInput): JoinClassification {
    if (input.phase === LOBBY_PHASE) {
        return { role: 'player' };
    }
    if (input.reconnect) {
        return { role: 'player' };
    }
    if (input.spectatorSupport === undefined) {
        return { reject: REJECT_REASON_MATCH_IN_PROGRESS };
    }
    if (!input.allowSpectators) {
        return { reject: REJECT_REASON_SPECTATORS_DISABLED };
    }
    return { role: 'spectator' };
}
