/**
 * shared/lobby-contract.ts
 *
 * Foundation contract types for the lobby roster (§4.14).
 *
 * The full lobby state and its nested entries live in `@chimera-engine/simulation/foundation` — the
 * zero-dependency foundation leaf — so the foundation wire protocol
 * (`shared/messages.ts`) can describe the `WELCOME` / `LOBBY_STATE` frames
 * without importing *up* into `networking` (Invariant #1). The
 * `networking/provider/MultiplayerProvider.ts` module re-exports every name here,
 * keeping `@chimera-engine/networking/provider/MultiplayerProvider.js` the unchanged
 * public import path for the lobby/transport contracts that build on it.
 *
 * Note: `shared/messages-schemas.ts` carries a *separate*, Zod-inferred
 * `LobbyState` whose ids are plain `string` (its wire-validation view). That
 * pre-existing structural divergence is intentional and left untouched — this
 * module owns the branded view used by the message-type layer and networking.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code.
 */

import type { PlayerId } from './engine-contract.js';

/** Configurable controller kind for a hosted lobby player slot. */
export type LobbyAgentKind = 'human' | 'ai';

/** Player-slot controller metadata supplied when hosting a lobby. */
export interface LobbyAgentSlot {
    readonly slotIndex: number;
    readonly kind: LobbyAgentKind;
    readonly omniscient?: boolean;
}

/** Metadata returned when a lobby is successfully hosted or joined. */
export interface LobbyInfo {
    readonly sessionId: string;
    readonly hostId: PlayerId;
    readonly gameId: string;
}

/** One player's entry in the live lobby roster. */
export interface LobbyPlayerEntry {
    readonly playerId: PlayerId;
    readonly displayName: string;
    readonly ready: boolean;
    /**
     * Owner-authored per-player match attributes (e.g. unit colour): each player
     * writes its own seat. Optional and backward-compatible: absent on games
     * with no lobby setup and on older clients.
     */
    readonly attributes?: Record<string, string>;
}

/** Full lobby state pushed to all clients. */
export interface LobbyState {
    readonly info: LobbyInfo;
    readonly players: readonly LobbyPlayerEntry[];
    /**
     * Host-authored match settings (e.g. board colour) synced to all clients on
     * every LobbyState broadcast. Optional and backward-compatible.
     */
    readonly matchSettings?: Record<string, string>;
    /**
     * Host-configured AI agent slots, synced to all clients so every peer sees
     * the AI roster. Optional and backward-compatible: absent on games with no
     * AI and on older clients.
     */
    readonly agentSlots?: readonly LobbyAgentSlot[];
}
