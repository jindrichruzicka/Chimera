/**
 * ChatHub — the main-side local-delivery sink for chat (architecture §4.29 —
 * Chat System). Where {@link ChatRelay} is the host-side *policy gate* between an
 * inbound CHAT and its rebroadcast, ChatHub is the *recipient-side* terminus for
 * the local player: it owns the bounded rolling history buffer, the local mute
 * set, and the push of delivered messages to the renderer.
 *
 * A message reaches `deliverLocal` once the relay has accepted it and resolved
 * the local player as a recipient (locally-originated or relayed from a remote
 * client). The hub then:
 *   - appends it to a rolling buffer capped at `capacity` (default 500), dropping
 *     the oldest entry from the head when full — chat history is not persisted
 *     and exists only for the session lifetime;
 *   - pushes it to `onMessage` unless its sender is muted.
 *
 * Mute is a reversible *view filter*: the full buffer always stores every
 * delivered message, and both `onMessage` delivery and `history()` apply the
 * current mute set. Unmuting therefore restores visibility of past messages.
 *
 * Chat is a cosmetic communication channel: ChatHub never advances `tick`, never
 * touches `ActionPipeline`, and is never recorded in replays / saves
 * (Invariant #72). It imports nothing from those subsystems.
 *
 * Invariants upheld:
 *   #67 — Constructed with an injected `Logger` child; no `console.*`.
 *   #72 — Side-channel only; no tick advance, no ActionPipeline/ActionHistory.
 */

import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { ChatMessage } from '@chimera-engine/simulation/foundation/chat.js';

import type { Logger } from './logging/logger.js';

/** Default rolling-buffer capacity — matches §4.29 (max 500 entries). */
const DEFAULT_CAPACITY = 500;

/** Collaborators + tuning for {@link ChatHub}. */
export interface ChatHubOptions {
    /** Injected logger (Invariant #67). */
    readonly logger: Logger;
    /**
     * Push a delivered, non-muted message to the local renderer. The wiring
     * point supplies the concrete `webContents.send`; tests supply a spy.
     */
    readonly onMessage: (message: ChatMessage) => void;
    /** Rolling-buffer capacity (max retained messages). Default 500. */
    readonly capacity?: number;
}

/**
 * Recipient-side chat sink for the local player. Construct one per process and
 * inject its `onMessage` push at the wiring point.
 */
export class ChatHub {
    private readonly log: Logger;
    private readonly onMessage: (message: ChatMessage) => void;
    private readonly capacity: number;

    /** Append-only rolling buffer (server-ordered); trimmed from the head. */
    private readonly buffer: ChatMessage[] = [];
    /** Locally-muted senders; a reversible view filter over delivery + history. */
    private readonly muted = new Set<PlayerId>();

    constructor(options: ChatHubOptions) {
        this.log = options.logger.child({ module: 'chat-hub' });
        this.onMessage = options.onMessage;
        this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    }

    /**
     * Record a message delivered to the local player and (unless its sender is
     * muted) push it to the renderer. Always buffered so that a later `unmute`
     * can reveal it.
     */
    deliverLocal(message: ChatMessage): void {
        this.buffer.push(message);
        if (this.buffer.length > this.capacity) {
            this.buffer.splice(0, this.buffer.length - this.capacity);
        }
        if (!this.muted.has(message.fromPlayerId)) {
            this.onMessage(message);
        }
    }

    /**
     * Return up to `maxEntries` of the most recent non-muted messages in
     * server order. Omitting `maxEntries` returns the whole (mute-filtered)
     * buffer. The result is a defensive copy.
     */
    history(maxEntries?: number): readonly ChatMessage[] {
        const visible = this.buffer.filter((message) => !this.muted.has(message.fromPlayerId));
        if (maxEntries === undefined) {
            return visible;
        }
        const bounded = Math.max(0, Math.min(maxEntries, visible.length));
        return visible.slice(visible.length - bounded);
    }

    /** Mute a sender: suppress future pushes and hide their history (reversible). */
    mute(playerId: PlayerId): void {
        this.muted.add(playerId);
        this.log.debug('chat:mute', { playerId });
    }

    /** Unmute a sender: restore delivery and history visibility. */
    unmute(playerId: PlayerId): void {
        this.muted.delete(playerId);
        this.log.debug('chat:unmute', { playerId });
    }
}
