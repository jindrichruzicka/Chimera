/**
 * electron/main/runtime/syntheticAgentId.ts
 *
 * The single spelling of an AI seat's synthetic player id.
 *
 * An AI seat has no profile and no connection, so the host mints its
 * `PlayerId` from the lobby slot index. Two independent paths must agree on
 * that id or a match ships setup for a seat that never exists: the seating path
 * (`HostedSessionAgents.collectGameStartAiPlayerSlots`, which registers the
 * agent) and the lobby→match setup builder
 * (`lobby/lobbySetupRegistry.buildSetupFromLobbyState`, which keys the seat's
 * attributes). It lives in its own leaf so the setup builder can share the
 * convention without pulling the AI engine into its module graph.
 *
 * Architecture reference: §4.6 / §4.9 / §4.14
 */

import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';
import { playerId } from '@chimera-engine/simulation/engine/types.js';

/** The `PlayerId` the host seats the AI at `slotIndex` under. */
export function createSyntheticAIPlayerId(slotIndex: number): PlayerId {
    return playerId(`ai-${slotIndex}`);
}
