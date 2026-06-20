/**
 * electron/main/ChatRelay.test.ts
 *
 * Unit tests for ChatRelay — the mandatory host-side gate (§4.29, Invariant #73)
 * between an inbound CHAT message and its rebroadcast.
 *
 * TDD: tests written before implementation — confirmed red.
 *
 * Task: F45 / T02 (issue #680)
 *
 * The relay is pure policy + routing: it consumes an injected clock (`now`) and
 * a fake `teamOf` resolver, reads connected players from a real PlayerDirectory,
 * and emits to a captured `deliver` callback. No transport, network, or IPC.
 */

import { describe, expect, it } from 'vitest';

import { playerId, type PlayerId } from '@chimera/simulation/engine/types.js';
import { localProfileId, type PlayerProfile } from '@chimera/simulation/profile/ProfileSchema.js';
import type { ChatMessage } from '@chimera/simulation/foundation/chat.js';

import { ChatRelay, type ChatDeliver, type ChatRelayOptions } from './ChatRelay.js';
import { PlayerDirectory } from './profile/PlayerDirectory.js';
import { createNoopLogger } from './logging/logger.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeProfile(id: string, displayName: string): PlayerProfile {
    return {
        localProfileId: localProfileId(id),
        displayName,
        avatar: { kind: 'builtin', ref: 'avatar/default' as never },
        locale: 'en-US',
    };
}

const P1 = playerId('p1');
const P2 = playerId('p2');
const P3 = playerId('p3');

/** team membership for tests: p1/p2 → 'red', p3 → 'blue'. */
function teamOf(id: PlayerId): string | undefined {
    if (id === P1 || id === P2) return 'red';
    if (id === P3) return 'blue';
    return undefined;
}

interface DeliverCall {
    readonly recipients: readonly PlayerId[];
    readonly message: ChatMessage;
}

interface Harness {
    readonly relay: ChatRelay;
    readonly calls: DeliverCall[];
    readonly deliver: ChatDeliver;
    setNow(ms: number): void;
}

function makeHarness(opts: Partial<ChatRelayOptions> = {}): Harness {
    const directory = new PlayerDirectory();
    directory.add(P1, makeProfile('slot1', 'Alice'));
    directory.add(P2, makeProfile('slot2', 'Bob'));
    directory.add(P3, makeProfile('slot3', 'Carol'));

    let nowMs = 1_000;
    const calls: DeliverCall[] = [];
    const deliver: ChatDeliver = (recipients, message) => {
        calls.push({ recipients, message });
    };

    const relay = new ChatRelay(createNoopLogger(), directory, {
        teamOf,
        now: () => nowMs,
        ...opts,
    });

    return {
        relay,
        calls,
        deliver,
        setNow: (ms: number) => {
            nowMs = ms;
        },
    };
}

// ─── Rejection branches ───────────────────────────────────────────────────────

describe('ChatRelay.relay — rejection branches', () => {
    it('rejects an empty body with reason "empty" and does not deliver', () => {
        const h = makeHarness();
        const result = h.relay.relay({ from: P1, body: '', scope: { kind: 'lobby' } }, h.deliver);

        expect(result).toEqual({ ok: false, reason: 'empty' });
        expect(h.calls).toHaveLength(0);
    });

    it('treats a whitespace-only body as empty', () => {
        const h = makeHarness();
        const result = h.relay.relay(
            { from: P1, body: '   \t\n', scope: { kind: 'lobby' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: false, reason: 'empty' });
        expect(h.calls).toHaveLength(0);
    });

    it('rejects an over-length body with reason "too_long" and does not deliver', () => {
        const h = makeHarness({ maxBodyLength: 5 });
        const result = h.relay.relay(
            { from: P1, body: '123456', scope: { kind: 'lobby' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: false, reason: 'too_long' });
        expect(h.calls).toHaveLength(0);
    });

    it('accepts a body exactly at the length cap', () => {
        const h = makeHarness({ maxBodyLength: 5 });
        const result = h.relay.relay(
            { from: P1, body: '12345', scope: { kind: 'lobby' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: true });
        expect(h.calls).toHaveLength(1);
    });

    it('measures the length cap in Unicode code points, not UTF-16 units', () => {
        // '😀' is one code point but two UTF-16 units. Three of them is 3 code
        // points (within a cap of 5) yet 6 UTF-16 units — a naive `.length`
        // would wrongly reject this.
        const h = makeHarness({ maxBodyLength: 5 });
        const result = h.relay.relay(
            { from: P1, body: '😀😀😀', scope: { kind: 'lobby' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: true });
        expect(h.calls).toHaveLength(1);
    });

    it('rejects a body over the cap when counted in code points', () => {
        const h = makeHarness({ maxBodyLength: 2 });
        const result = h.relay.relay(
            { from: P1, body: '😀😀😀', scope: { kind: 'lobby' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: false, reason: 'too_long' });
        expect(h.calls).toHaveLength(0);
    });

    it('rejects a private scope whose toPlayerId is not connected with "invalid_scope"', () => {
        const h = makeHarness();
        const result = h.relay.relay(
            { from: P1, body: 'hi', scope: { kind: 'private', toPlayerId: playerId('ghost') } },
            h.deliver,
        );

        expect(result).toEqual({ ok: false, reason: 'invalid_scope' });
        expect(h.calls).toHaveLength(0);
    });

    it('rejects a team scope with an empty teamId with "invalid_scope"', () => {
        const h = makeHarness();
        const result = h.relay.relay(
            { from: P1, body: 'hi', scope: { kind: 'team', teamId: '' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: false, reason: 'invalid_scope' });
        expect(h.calls).toHaveLength(0);
    });
});

// ─── Rate limiting (token bucket) ──────────────────────────────────────────────

describe('ChatRelay.relay — token-bucket rate limiting', () => {
    it('exhausts the bucket then returns "rate_limited"', () => {
        const h = makeHarness({ messagesPerMinute: 2 });

        expect(h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
        expect(h.relay.relay({ from: P1, body: 'b', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
        expect(h.relay.relay({ from: P1, body: 'c', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: false, reason: 'rate_limited' },
        );
        expect(h.calls).toHaveLength(2);
    });

    it('blocks every message when messagesPerMinute is 0', () => {
        const h = makeHarness({ messagesPerMinute: 0 });

        expect(h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: false, reason: 'rate_limited' },
        );
        expect(h.calls).toHaveLength(0);
    });

    it('preserves the sub-minute remainder when refilling tokens', () => {
        const h = makeHarness({ messagesPerMinute: 1 });

        // Consume the only token (harness clock starts at t=1_000), then exhaust.
        expect(h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
        expect(h.relay.relay({ from: P1, body: 'b', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: false, reason: 'rate_limited' },
        );

        // +90s grants exactly one token (floor(90/60)) and carries 30s of credit.
        h.setNow(91_000);
        expect(h.relay.relay({ from: P1, body: 'c', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
        expect(h.relay.relay({ from: P1, body: 'd', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: false, reason: 'rate_limited' },
        );

        // Only 30 more seconds (not a full minute) are needed for the next token,
        // proving the earlier remainder was retained rather than discarded.
        h.setNow(121_000);
        expect(h.relay.relay({ from: P1, body: 'e', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
    });

    it('replenishes one token per minute', () => {
        const h = makeHarness({ messagesPerMinute: 1 });

        expect(h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
        expect(h.relay.relay({ from: P1, body: 'b', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: false, reason: 'rate_limited' },
        );

        h.setNow(61_000); // +60s → +1 token
        expect(h.relay.relay({ from: P1, body: 'c', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
    });

    it('meters tokens per PlayerId independently', () => {
        const h = makeHarness({ messagesPerMinute: 1 });

        expect(h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
        // P1 is now exhausted, but P2 still has a full bucket.
        expect(h.relay.relay({ from: P2, body: 'b', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
    });

    it('does not consume a token when the message is rejected by validation', () => {
        const h = makeHarness({ messagesPerMinute: 1 });

        // Rejected (empty) → must not burn the single token.
        expect(h.relay.relay({ from: P1, body: '', scope: { kind: 'lobby' } }, h.deliver)).toEqual({
            ok: false,
            reason: 'empty',
        });
        // The valid send still succeeds because the bucket is untouched.
        expect(h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
    });

    it('clears all buckets on reset()', () => {
        const h = makeHarness({ messagesPerMinute: 1 });

        h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver);
        expect(h.relay.relay({ from: P1, body: 'b', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: false, reason: 'rate_limited' },
        );

        h.relay.reset();
        expect(h.relay.relay({ from: P1, body: 'c', scope: { kind: 'lobby' } }, h.deliver)).toEqual(
            { ok: true },
        );
    });
});

// ─── Scope routing (recipient sets) ────────────────────────────────────────────

describe('ChatRelay.relay — scope routing', () => {
    it('routes lobby scope to every connected player', () => {
        const h = makeHarness();
        const result = h.relay.relay({ from: P1, body: 'hi', scope: { kind: 'lobby' } }, h.deliver);

        expect(result).toEqual({ ok: true });
        expect(h.calls).toHaveLength(1);
        expect(new Set(h.calls[0]!.recipients)).toEqual(new Set([P1, P2, P3]));
    });

    it('routes team scope to players with the matching teamId', () => {
        const h = makeHarness();
        const result = h.relay.relay(
            { from: P1, body: 'hi', scope: { kind: 'team', teamId: 'red' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: true });
        expect(new Set(h.calls[0]!.recipients)).toEqual(new Set([P1, P2]));
    });

    it('delivers a valid team message with no connected teammates to nobody, still consuming a token', () => {
        const h = makeHarness({ messagesPerMinute: 1 });

        // 'green' is a valid, non-empty teamId that matches no connected player,
        // so the well-formed message resolves to an empty recipient set.
        const result = h.relay.relay(
            { from: P1, body: 'anyone?', scope: { kind: 'team', teamId: 'green' } },
            h.deliver,
        );

        expect(result).toEqual({ ok: true });
        expect(h.calls).toHaveLength(1);
        expect(h.calls[0]!.recipients).toEqual([]);

        // The well-formed send consumed the single token even though it reached no one.
        expect(
            h.relay.relay(
                { from: P1, body: 'still here?', scope: { kind: 'team', teamId: 'green' } },
                h.deliver,
            ),
        ).toEqual({ ok: false, reason: 'rate_limited' });
    });

    it('routes private scope to sender + toPlayerId only', () => {
        const h = makeHarness();
        const result = h.relay.relay(
            { from: P1, body: 'hi', scope: { kind: 'private', toPlayerId: P2 } },
            h.deliver,
        );

        expect(result).toEqual({ ok: true });
        expect(new Set(h.calls[0]!.recipients)).toEqual(new Set([P1, P2]));
    });

    it('dedupes a private message addressed to the sender', () => {
        const h = makeHarness();
        h.relay.relay(
            { from: P1, body: 'note to self', scope: { kind: 'private', toPlayerId: P1 } },
            h.deliver,
        );

        expect(h.calls[0]!.recipients).toEqual([P1]);
    });
});

// ─── Host-assigned fields & filtering ──────────────────────────────────────────

describe('ChatRelay.relay — host-assigned fields', () => {
    it('assigns a non-empty id and the injected serverTime, preserving sender + scope', () => {
        const h = makeHarness();
        h.setNow(42_000);
        h.relay.relay({ from: P1, body: 'hi', scope: { kind: 'lobby' } }, h.deliver);

        const { message } = h.calls[0]!;
        expect(message.id).toBeTypeOf('string');
        expect(message.id.length).toBeGreaterThan(0);
        expect(message.id).not.toBe(''); // never the client placeholder
        expect(message.serverTime).toBe(42_000);
        expect(message.fromPlayerId).toBe(P1);
        expect(message.scope).toEqual({ kind: 'lobby' });
        expect(message.body).toBe('hi');
    });

    it('reads the clock once per relay so serverTime matches the rate-limit instant', () => {
        // A clock that advances on every read. If relay() reads `now()` more than
        // once, the rate-limit bucket and the message's serverTime would observe
        // two different instants — splitting one relay across two wall-clock reads.
        let reads = 0;
        const tickingClock = (): number => {
            reads += 1;
            return 1_000 + reads; // 1001 on the 1st read, 1002 on the 2nd, ...
        };
        const directory = new PlayerDirectory();
        directory.add(P1, makeProfile('slot1', 'Alice'));
        const calls: DeliverCall[] = [];
        const deliver: ChatDeliver = (recipients, message) => {
            calls.push({ recipients, message });
        };
        const relay = new ChatRelay(createNoopLogger(), directory, { now: tickingClock });

        relay.relay({ from: P1, body: 'hi', scope: { kind: 'lobby' } }, deliver);

        expect(reads).toBe(1);
        expect(calls[0]!.message.serverTime).toBe(1_001);
    });

    it('assigns a fresh id per message', () => {
        const h = makeHarness();
        h.relay.relay({ from: P1, body: 'a', scope: { kind: 'lobby' } }, h.deliver);
        h.relay.relay({ from: P2, body: 'b', scope: { kind: 'lobby' } }, h.deliver);

        expect(h.calls[0]!.message.id).not.toBe(h.calls[1]!.message.id);
    });

    it('applies the profanity filter to the delivered body', () => {
        const h = makeHarness({
            profanityFilter: (body) => body.replace('damn', '****'),
        });
        h.relay.relay({ from: P1, body: 'oh damn', scope: { kind: 'lobby' } }, h.deliver);

        expect(h.calls[0]!.message.body).toBe('oh ****');
    });
});
