---
title: 'Chat System'
description: 'ChatScope (lobby/team/private), ChatMessage, ChatRelay (token-bucket rate limiting, maxBodyLength, profanityFilter), RelayResult, ChatAPI IPC, chatStore (500-entry buffer), ChatPanel.tsx — not persisted in 1.0.0.'
tags: [chat, lobby, messaging, rate-limiting, zustand, renderer]
---

# Chat System

> §4.29 of the Chimera architecture.
> Related: [WebSocket Message Protocol](websocket-message-protocol.md) · [Multiplayer Provider](multiplayer-provider-websocket.md) · [Player Profiles & Directory](player-profiles-directory.md) · [Electron Shell](electron-shell-ipc-bridge.md)

---

## Overview

A bounded, rate-limited chat layer for in-match and lobby communication. All messages route through the host. The host assigns IDs, timestamps, and applies policy — clients are untrusted.

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

export type ChatRejectReason = 'too_long' | 'rate_limited' | 'empty' | 'invalid_scope';

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

The renderer side: `renderer/components/shell/ChatPanel.tsx`. Reads from `chatStore`, filters muted players at render time. Mounted by `GameShell` as engine chrome (§4.33). No game-specific code.

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
