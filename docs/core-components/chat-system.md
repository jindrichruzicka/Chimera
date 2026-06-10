---
title: 'Chat System'
description: 'ChatScope (lobby/team/private), ChatMessage, ChatRelay (token-bucket rate limiting, maxBodyLength, profanityFilter), RelayResult, ChatAPI IPC, chatStore (500-entry buffer), ChatPanel (shared renderer chat component, mounted by game HUDs only) — not persisted in 1.0.0.'
tags: [chat, lobby, messaging, rate-limiting, zustand, renderer]
---

# Chat System

> §4.29 of the Chimera architecture.
> Related: [WebSocket Message Protocol](websocket-message-protocol.md) · [Multiplayer Provider](multiplayer-provider-websocket.md) · [Player Profiles & Directory](player-profiles-directory.md) · [Electron Shell](electron-shell-ipc-bridge.md)

---

## Overview

A bounded, rate-limited chat layer for in-match communication. All messages route through the host. The host assigns IDs, timestamps, and applies policy — clients are untrusted. The `lobby` _scope_ names the recipient set ("all connected players"), not the lobby screen — the lobby page mounts no chat UI.

---

## Core Types

```typescript
// shared/chat.ts

export type ChatScope =
    | { kind: 'lobby' }
    | { kind: 'team'; teamId: string }
    | { kind: 'private'; toPlayerId: PlayerId };

export interface ChatMessage {
    readonly id: string; // Assigned by host
    readonly fromPlayerId: PlayerId;
    readonly scope: ChatScope;
    readonly body: string;
    readonly serverTime: number; // Host wall-clock at relay (ordering only, not sim time)
}
```

---

## Message Flow

```
Client sends  { type: 'CHAT', body, scope }
     │ WebSocket (client → host)
     │ ClientMessageSchema rejects a body over WIRE_MAX_CHAT_BODY_LENGTH (4096
     │   code units) as a malformed frame — a coarse DoS bound so a hostile client
     │   cannot force the host to materialize an unbounded string before the relay.
     ▼
[ChatRelay.relay() on host]   ← mandatory gate, no bypass (Invariant #73)
  1. Reject empty / whitespace-only body            → reason 'empty'
  2. Reject over-length body (> maxBodyLength)       → reason 'too_long'
  3. Validate scope & recipient                      → reason 'invalid_scope'
       (private toPlayerId must be connected; team teamId must be non-empty)
  4. Rate limit (token bucket per PlayerId)          → reason 'rate_limited'
       (rejected messages above do NOT consume a token)
  5. Apply profanity filter if configured
  6. Assign id (UUID) + serverTime (host wall-clock, ordering only)
     │ if RelayResult.ok = false → drop, and send a `chat_reject` side-channel
     │     frame back to the sender carrying the `ChatRejectReason` (parallel to
     │     `profile_reject`). The renderer toast that consumes it is a follow-on
     │     IPC task; like `profile_reject`, the dedicated WS wire frame is still
     │     pending, so today `chat_reject` is delivered only over the in-process
     │     provider (TODO(F14) in WsHostTransport adds the ServerMessage frame).
     │ if ok = true ↓
     ▼
  Rebroadcast ChatMessage to recipients based on scope:
    lobby   → all connected players
    team    → players with matching teamId
    private → sender + toPlayerId only
```

The relay is the authoritative source of `id` and `serverTime`. The host
transport forwards both verbatim to recipients — it does **not** re-stamp
`serverTime` — so ordering is the relay's single wall-clock read.

The relay's recipient universe is the `PlayerDirectory` snapshot — players with a
registered profile (admitted via `ProfileGate` on JOIN / `PROFILE_UPDATE`) — not
the lobby `players` roster. A seat that has connected but not yet registered a
profile is therefore not a chat recipient and gets no `lobby`-scope echo;
`private` scope still always includes the sender regardless of directory
membership.

The **host is not in the directory** (it never JOINs, and self-registering it
would collide with a client sharing the host's `localProfileId` —
`NAMESPACE_COLLISION`). So the host is added as a `lobby`-scope recipient at the
_delivery_ layer (`LobbyManager.deliverChat`), not by the relay's recipient
resolution: lobby means "every connected player" and the host is one, so it
always sees its own and clients' lobby messages on its own machine. The relay
remains the sole acceptance gate (Invariant #73); delivery-layer inclusion does
not bypass it. `team`-scope routing stays relay-resolved (inert until team
membership is modelled).

---

## ChatRelay

```typescript
// electron/main/ChatRelay.ts

export interface ChatRelayOptions {
    maxBodyLength?: number; // Default: 500 (Unicode code points)
    messagesPerMinute?: number; // Default: 20 (token-bucket per PlayerId)
    profanityFilter?: (body: string) => string;
    teamOf?: (playerId: PlayerId) => string | undefined; // team-scope routing; default () => undefined (team msgs reach no one until wired)
    now?: () => number; // injected clock (ms) for token replenishment + serverTime; default Date.now
}

export type ChatRejectReason =
    | 'too_long'
    | 'rate_limited'
    | 'empty'
    | 'invalid_scope'
    | 'no_session';

export type RelayResult = { ok: true } | { ok: false; reason: ChatRejectReason };

export class ChatRelay {
    constructor(
        private readonly logger: Logger,
        private readonly directory: PlayerDirectory,
        private readonly opts: ChatRelayOptions = {},
    ) {}
}
```

Token bucket: every `PlayerId` starts with `messagesPerMinute` tokens; tokens replenish at 1/minute rate. Sending a message consumes 1 token. When bucket is empty, `RelayResult` returns `{ ok: false, reason: 'rate_limited' }`. On any rejection the host sends the offending client a `chat_reject` side-channel frame carrying the `ChatRejectReason`; the renderer is expected to surface this as a toast (the toast wiring is a follow-on IPC task).

---

## ChatAPI IPC

```typescript
interface ChatAPI {
    send(body: string, scope: ChatScope): Promise<RelayResult>;
    onMessage(cb: (msg: ChatMessage) => void): Unsubscribe;
    history(maxEntries?: number): Promise<ReadonlyArray<ChatMessage>>;
    mute(playerId: PlayerId): void;
    unmute(playerId: PlayerId): void;
}
```

`send` is wired for **both roles** over the `LocalWebSocketProvider` side-channel.
On the **host**, `LobbyManager.sendLocalChat` runs the relay synchronously and
returns the authoritative `RelayResult` (so the host sees `rate_limited` etc.).
On a **joined client**, `sendLocalChat` forwards a `CHAT` frame to the host and
returns `{ ok: true }` optimistically — the host relay is authoritative, assigns
`id`/`serverTime`, and echoes accepted messages back over the side-channel, which
the client surfaces via `onMessage`. Per-send rejection feedback to a client (the
wire `chat_reject` frame + a toast) is a follow-on; until then a client's rejected
message is simply not echoed. `no_session` is returned only when there is no
active session at all.

---

## chatStore (Zustand)

```typescript
// renderer/state/chatStore.ts

interface ChatStore {
    readonly messages: ReadonlyArray<ChatMessage>; // Rolling buffer, max 500 entries
    readonly muted: ReadonlySet<PlayerId>;
    addMessage(msg: ChatMessage): void;
    mute(id: PlayerId): void;
    unmute(id: PlayerId): void;
}
```

Rolling buffer: when size exceeds 500, the oldest entry is dropped from the head.

---

## ChatPanel.tsx

The renderer side: `renderer/components/chat/ChatPanel.tsx`. Reads from `chatStore`, filters muted players at render time. No game-specific code.

Mute/unmute is **dual-written**: the renderer `chatStore` provides the instant local view filter (and reveals already-buffered messages on unmute), and the same action is mirrored to the host-side `ChatHub` via `window.__chimera.chat.mute` / `unmute`, so the main process also suppresses delivery of that sender and filters them from `history()` backfill. The two layers are complementary, not redundant: the store is the immediate render filter, the `ChatHub` is the authoritative delivery/history gate.

`ChatPanel` is the shared **chat component** (§4.35.1), exported from the public barrel `@chimera/renderer/components/chat`. It is an **in-match-only UI**: the engine never mounts it — no engine shell surface (lobby included) renders chat — and a game mounts it from its own renderer surfaces. Tactics renders it inside `TacticsGameHud` (a sibling of the HUD footer) within a drawer that is **collapsed by default** — a corner toggle expands it on demand, so chat never occludes board interaction behind it. The dock owns its own positioning. Games that do not mount it get no chat.

---

## Persistence Note

Chat history is **not persisted** in 1.0.0. Messages exist only for the session lifetime. Persisted chat history is a post-1.0 extension.

---

## Invariants

| #   | Rule                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #72 | `CHAT` messages are not `EngineAction`s. They must not advance `tick`, invoke `ActionPipeline`, or be recorded in `ActionHistory` / replays / saves. Chat is a cosmetic communication channel, parallel to `PROFILE_UPDATE`. |
| #73 | `ChatRelay.relay()` is the mandatory gate between an inbound `CHAT` message and rebroadcast. Length cap, rate limit, and scope validation all run inside `relay()` — no bypass path exists.                                  |

All chat is routed through the host's `ChatRelay`; clients never message each
other directly, even for `private` scope. Message ordering is server-assigned
(`serverTime`); client-local timestamps are never used for ordering. The
renderer `chatStore` is a rolling buffer with a hard cap of 500 entries.

---

## Cross-References

- [WebSocket Message Protocol](websocket-message-protocol.md) — `CHAT` message type on the wire
- [Multiplayer Provider](multiplayer-provider-websocket.md) — `MessageRouter` routes `CHAT` to `ChatRelay`
- [Player Profiles & Directory](player-profiles-directory.md) — `PlayerDirectory` checked for mute status
- [Electron Shell](electron-shell-ipc-bridge.md) — `ChatAPI` IPC namespace
