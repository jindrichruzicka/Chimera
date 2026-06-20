/**
 * electron/main/ChatRelay.ts
 *
 * ChatRelay — the mandatory host-side gate between an inbound `CHAT` message and
 * its rebroadcast (architecture §4.29 — Chat System).
 *
 * Every inbound `CHAT` flows through `relay()`; there is no bypass path
 * (Invariant #73). Inside `relay()` the policy runs in order: empty/length
 * checks, scope validation, then a per-`PlayerId` token-bucket rate limit. On
 * acceptance the host assigns the authoritative `id` (UUID) and `serverTime`
 * (injected clock) — clients never author them — applies the optional profanity
 * filter, resolves the recipient set from `scope`, and emits via `deliver`.
 *
 * Chat is a cosmetic communication channel: the relay never advances `tick`,
 * never touches `ActionPipeline`, and is never recorded in `ActionHistory` /
 * replays / saves (Invariant #72). It imports nothing from those subsystems.
 *
 * Task: F45 / T02 (issue #680)
 *
 * Invariants upheld:
 *   #67 — Constructed with an injected `Logger` child; no `console.*`.
 *   #72 — Side-channel only; no tick advance, no ActionPipeline/ActionHistory.
 *   #73 — `relay()` is the single gate; length cap, rate limit, and scope
 *         validation all run inside it.
 */

import { randomUUID } from 'node:crypto';

import type { PlayerId } from '@chimera/simulation/engine/types.js';
import type { ChatMessage, ChatScope, RelayResult } from '@chimera/simulation/foundation/chat.js';

import type { Logger } from './logging/logger.js';
import type { PlayerDirectory } from './profile/PlayerDirectory.js';

const DEFAULT_MAX_BODY_LENGTH = 500;
const DEFAULT_MESSAGES_PER_MINUTE = 20;
const MILLIS_PER_MINUTE = 60_000;

/**
 * Tuning + collaborators for {@link ChatRelay}. All fields are optional so the
 * relay can be constructed with sensible production defaults.
 */
export interface ChatRelayOptions {
    /** Maximum `body` length, in Unicode code points, before rejection. Default 500. */
    readonly maxBodyLength?: number;
    /** Token-bucket capacity / replenishment ceiling, per `PlayerId`. Default 20. */
    readonly messagesPerMinute?: number;
    /** Optional transform applied to an accepted `body` before rebroadcast. */
    readonly profanityFilter?: (body: string) => string;
    /**
     * Resolves a connected player's `teamId` for `team`-scope routing. Returns
     * `undefined` when the player has no team (or teams are not modelled yet).
     * Defaults to `() => undefined`, so `team` messages reach no one until a
     * real resolver is wired in.
     */
    readonly teamOf?: (playerId: PlayerId) => string | undefined;
    /**
     * Injected clock (ms) driving token replenishment and `serverTime`.
     * Defaults to `Date.now`; declared so tests can drive time deterministically.
     */
    readonly now?: () => number;
}

/** A validated inbound chat submission. `from` is the transport-authenticated
 *  sender — never a client-supplied identity. */
export interface RelayInput {
    readonly from: PlayerId;
    readonly body: string;
    readonly scope: ChatScope;
}

/**
 * Side effect `relay()` invokes once, on acceptance, to rebroadcast the stamped
 * message to its resolved recipients. The wiring point supplies the concrete
 * transport send; tests supply a spy.
 */
export type ChatDeliver = (recipients: readonly PlayerId[], message: ChatMessage) => void;

interface TokenBucket {
    tokens: number;
    lastRefill: number;
}

/**
 * Host-side chat policy gate. Construct one per hosted session and inject the
 * `PlayerDirectory` so recipient resolution always reflects the live roster.
 */
export class ChatRelay {
    private readonly log: Logger;
    private readonly maxBodyLength: number;
    private readonly messagesPerMinute: number;
    private readonly profanityFilter: ((body: string) => string) | undefined;
    private readonly teamOf: (playerId: PlayerId) => string | undefined;
    private readonly now: () => number;

    /** Per-`PlayerId` token buckets; cleared on {@link reset}. */
    private readonly buckets = new Map<PlayerId, TokenBucket>();

    constructor(
        logger: Logger,
        private readonly directory: PlayerDirectory,
        opts: ChatRelayOptions = {},
    ) {
        this.log = logger.child({ module: 'chat-relay' });
        this.maxBodyLength = opts.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
        this.messagesPerMinute = opts.messagesPerMinute ?? DEFAULT_MESSAGES_PER_MINUTE;
        this.profanityFilter = opts.profanityFilter;
        this.teamOf = opts.teamOf ?? (() => undefined);
        this.now = opts.now ?? Date.now;
    }

    /**
     * The mandatory gate. Validates policy, assigns host-authoritative `id` +
     * `serverTime`, resolves recipients by `scope`, and (on acceptance) calls
     * `deliver` exactly once. Returns the outcome; never throws for policy
     * rejections.
     *
     * Validation precedence (an earlier failure short-circuits and does **not**
     * consume a token): empty → too_long → invalid_scope → rate_limited.
     */
    relay(input: RelayInput, deliver: ChatDeliver): RelayResult {
        const { from, body, scope } = input;

        if (body.trim().length === 0) {
            return { ok: false, reason: 'empty' };
        }
        // Count Unicode code points (not UTF-16 units) so the cap matches the
        // documented "characters" contract — astral-plane glyphs (emoji) count
        // once, not twice.
        if ([...body].length > this.maxBodyLength) {
            return { ok: false, reason: 'too_long' };
        }

        const recipients = this.resolveRecipients(from, scope);
        if (recipients === null) {
            return { ok: false, reason: 'invalid_scope' };
        }

        // A single wall-clock read for the whole relay: the rate-limit bucket and
        // the message's `serverTime` observe the same instant, so an accepted
        // message is never split across two divergent `now()` reads.
        const now = this.now();

        if (!this.consumeToken(from, now)) {
            this.log.debug('relay:rate-limited', { from });
            return { ok: false, reason: 'rate_limited' };
        }

        const message: ChatMessage = {
            id: randomUUID(),
            fromPlayerId: from,
            scope,
            body: this.profanityFilter !== undefined ? this.profanityFilter(body) : body,
            serverTime: now,
        };

        deliver(recipients, message);
        return { ok: true };
    }

    /** Clear all token buckets. Call on lobby close so rate-limit state does not
     *  bleed across sessions. */
    reset(): void {
        this.buckets.clear();
    }

    /**
     * Resolve the recipient set for `scope`, or `null` when the scope is
     * semantically invalid (unknown recipient, empty teamId, unknown
     * discriminant). The connected universe is the `PlayerDirectory` roster.
     */
    private resolveRecipients(from: PlayerId, scope: ChatScope): readonly PlayerId[] | null {
        const connected = Object.keys(this.directory.snapshot()) as PlayerId[];

        switch (scope.kind) {
            case 'lobby':
                return connected;
            case 'team': {
                if (scope.teamId.length === 0) {
                    return null;
                }
                return connected.filter((id) => this.teamOf(id) === scope.teamId);
            }
            case 'private': {
                if (!connected.includes(scope.toPlayerId)) {
                    return null;
                }
                return from === scope.toPlayerId ? [from] : [from, scope.toPlayerId];
            }
            default:
                // Defensive: the wire schema already constrains `kind`, but an
                // unknown discriminant must never be silently rebroadcast.
                return null;
        }
    }

    /**
     * Refill and consume one token for `playerId` at the caller-supplied `now`
     * (the single per-relay clock read). Buckets start full and replenish one
     * token per minute up to `messagesPerMinute`. Returns `false` when the bucket
     * is empty — including `messagesPerMinute: 0`, which blocks every message
     * (capacity zero can never hold a token).
     */
    private consumeToken(playerId: PlayerId, now: number): boolean {
        let bucket = this.buckets.get(playerId);

        if (bucket === undefined) {
            // First send: a full bucket, refilled/consumed by the shared path below.
            bucket = { tokens: this.messagesPerMinute, lastRefill: now };
            this.buckets.set(playerId, bucket);
        } else {
            const elapsed = now - bucket.lastRefill;
            if (elapsed >= MILLIS_PER_MINUTE) {
                const refill = Math.floor(elapsed / MILLIS_PER_MINUTE);
                bucket.tokens = Math.min(this.messagesPerMinute, bucket.tokens + refill);
                bucket.lastRefill += refill * MILLIS_PER_MINUTE;
            }
        }

        if (bucket.tokens < 1) {
            return false;
        }
        bucket.tokens -= 1;
        return true;
    }
}
