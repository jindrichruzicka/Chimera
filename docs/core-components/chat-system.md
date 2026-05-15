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
    readonly serverTime: number; // Host's sim tick
}
```

---

## Message Flow

```
Client sends  { type: 'CHAT', body, scope }
     │ WebSocket (client → host)
     ▼
[ChatRelay on host]
  1. Validate scope & sender
  2. Apply rate limit (token bucket per PlayerId)
  3. Trim body to maxBodyLength
  4. Apply profanity filter if configured
  5. Assign id (UUID) + serverTime (sim tick)
     │ if RelayResult.ok = false → send rejection back to sender only
     │ if ok = true ↓
     ▼
  Rebroadcast ChatMessage to recipients based on scope:
    lobby   → all connected players
    team    → players with matching teamId
    private → sender + toPlayerId only
```

---

## ChatRelay

```typescript
// electron/main/chat-relay.ts

export interface ChatRelayOptions {
    maxBodyLength?: number; // Default: 500 characters
    messagesPerMinute?: number; // Default: 20 (token-bucket per PlayerId)
    profanityFilter?: (body: string) => string;
}

export type RelayResult =
    | { ok: true }
    | { ok: false; reason: 'too_long' | 'rate_limited' | 'empty' | 'invalid_scope' };

export class ChatRelay {
    constructor(
        private readonly logger: Logger,
        private readonly directory: PlayerDirectory,
        private readonly opts: ChatRelayOptions = {},
    ) {}
}
```

Token bucket: every `PlayerId` starts with `messagesPerMinute` tokens; tokens replenish at 1/minute rate. Sending a message consumes 1 token. When bucket is empty, `RelayResult` returns `{ ok: false, reason: 'rate_limited' }`. On exhaustion, a toast is sent to the offending client via `ToastAPI` rather than a visible error message.

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

| #   | Rule                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #72 | All chat messages are routed through the host's `ChatRelay`. Clients never send messages directly to each other, even for `private` scope.                           |
| #73 | `chatStore` is a rolling buffer with a hard cap of 500 entries. Message ordering is server-assigned (serverTime). Client-local timestamps are not used for ordering. |

---

## Cross-References

- [WebSocket Message Protocol](websocket-message-protocol.md) — `CHAT` message type on the wire
- [Multiplayer Provider](multiplayer-provider-websocket.md) — `MessageRouter` routes `CHAT` to `ChatRelay`
- [Player Profiles & Directory](player-profiles-directory.md) — `PlayerDirectory` checked for mute status
- [Electron Shell](electron-shell-ipc-bridge.md) — `ChatAPI` IPC namespace
