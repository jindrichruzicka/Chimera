/**
 * Public contract surface of `@chimera-engine/networking`.
 *
 * The package root (`.`) exposes the pluggable multiplayer abstraction's
 * provider/transport INTERFACES plus the supporting contract types consumers
 * annotate against — the curated surface `electron/main` orchestration depends
 * on. Concrete providers (`LocalWebSocketProvider`, `SteamNetworkProvider`) and
 * the `InMemoryMultiplayerProvider` test double are deliberately NOT reachable
 * through this barrel (Invariant #47); the host reaches a concrete provider
 * through the `./*.js` subpath escape hatch, never the curated root.
 *
 * Importing `@chimera-engine/networking` evaluates NO concrete-provider runtime — no
 * `provider/local/`, `provider/steam/`, or `ws` module is pulled in. The barrel
 * does carry three small runtime VALUES that are part of the provider contract
 * and live in the otherwise type-only contract module: the `playerId` brand
 * factory, the `JoinRejectedError` error class consumers branch on, and the
 * `isBrowsable` type-narrowing guard. Asserted by
 * `networking/__tests__/contract-barrel-side-effects.test.ts`.
 *
 * `@chimera-engine/networking` depends on `@chimera-engine/simulation` only (+ `ws`) and
 * carries no React or DOM (Invariant #1).
 */
export type {
    PlayerId,
    GameResult,
    PlayerSnapshot,
    LobbyAgentKind,
    LobbyAgentSlot,
    LobbyInfo,
    LobbyPlayerEntry,
    LobbyState,
    HostLobbyParams,
    JoinLobbyParams,
    SeatClaim,
    LobbyListEntry,
    DisconnectReason,
    WireChatPayload,
    PlayerProfilePayload,
    SideChannelMessage,
    Unsubscribe,
    JoinGateResult,
    HostedSession,
    HostTransport,
    JoinedSession,
    ClientTransport,
    MultiplayerProvider,
    BrowsableProvider,
} from './provider/MultiplayerProvider.js';
export { playerId, JoinRejectedError, isBrowsable } from './provider/MultiplayerProvider.js';
