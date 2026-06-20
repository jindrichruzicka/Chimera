/**
 * electron/main/ChatHub.test.ts
 *
 * Unit tests for ChatHub — the main-side local-delivery sink for chat (§4.29).
 * It owns the bounded rolling history buffer, the local mute set, and the push
 * of delivered messages to the renderer. Pure state + one injected `onMessage`
 * callback; no transport, network, or IPC.
 *
 * TDD: tests written before implementation — confirmed red.
 *
 * Task: F45 / T03 (issue #681)
 */

import { describe, expect, it } from 'vitest';

import { playerId } from '@chimera/simulation/engine/types.js';
import type { ChatMessage } from '@chimera/simulation/foundation/chat.js';

import { ChatHub } from './ChatHub.js';
import { createNoopLogger } from './logging/logger.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const P1 = playerId('p1');
const P2 = playerId('p2');

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: 'msg-1',
        fromPlayerId: P1,
        scope: { kind: 'lobby' },
        body: 'hello',
        serverTime: 1,
        ...overrides,
    };
}

interface Harness {
    readonly hub: ChatHub;
    readonly delivered: ChatMessage[];
}

function makeHarness(capacity?: number): Harness {
    const delivered: ChatMessage[] = [];
    const hub = new ChatHub({
        logger: createNoopLogger(),
        onMessage: (message) => {
            delivered.push(message);
        },
        ...(capacity !== undefined ? { capacity } : {}),
    });
    return { hub, delivered };
}

// ─── Local delivery ─────────────────────────────────────────────────────────

describe('ChatHub.deliverLocal', () => {
    it('pushes a delivered message to the onMessage callback', () => {
        const h = makeHarness();
        const message = makeMessage();

        h.hub.deliverLocal(message);

        expect(h.delivered).toEqual([message]);
    });

    it('records delivered messages in history in server order', () => {
        const h = makeHarness();
        h.hub.deliverLocal(makeMessage({ id: 'a', serverTime: 1 }));
        h.hub.deliverLocal(makeMessage({ id: 'b', serverTime: 2 }));

        expect(h.hub.history().map((m) => m.id)).toEqual(['a', 'b']);
    });
});

// ─── Rolling buffer ────────────────────────────────────────────────────────

describe('ChatHub history buffer', () => {
    it('drops the oldest entries once capacity is exceeded', () => {
        const h = makeHarness(3);
        for (let i = 0; i < 5; i += 1) {
            h.hub.deliverLocal(makeMessage({ id: `m${i.toString()}`, serverTime: i }));
        }

        // Only the last 3 survive, oldest dropped from the head.
        expect(h.hub.history().map((m) => m.id)).toEqual(['m2', 'm3', 'm4']);
    });

    it('history(maxEntries) returns at most the requested number, newest-biased', () => {
        const h = makeHarness();
        for (let i = 0; i < 5; i += 1) {
            h.hub.deliverLocal(makeMessage({ id: `m${i.toString()}`, serverTime: i }));
        }

        expect(h.hub.history(2).map((m) => m.id)).toEqual(['m3', 'm4']);
    });

    it('history(maxEntries) clamps to the available count', () => {
        const h = makeHarness();
        h.hub.deliverLocal(makeMessage({ id: 'only' }));

        expect(h.hub.history(50).map((m) => m.id)).toEqual(['only']);
    });

    it('history(0) returns an empty list', () => {
        const h = makeHarness();
        h.hub.deliverLocal(makeMessage());

        expect(h.hub.history(0)).toEqual([]);
    });

    it('history() returns a defensive copy', () => {
        const h = makeHarness();
        h.hub.deliverLocal(makeMessage({ id: 'a' }));
        const first = h.hub.history() as ChatMessage[];
        first.push(makeMessage({ id: 'injected' }));

        expect(h.hub.history().map((m) => m.id)).toEqual(['a']);
    });
});

// ─── Mute ──────────────────────────────────────────────────────────────────

describe('ChatHub mute / unmute', () => {
    it('suppresses the onMessage push for a muted sender', () => {
        const h = makeHarness();
        h.hub.mute(P1);

        h.hub.deliverLocal(makeMessage({ fromPlayerId: P1 }));

        expect(h.delivered).toEqual([]);
    });

    it('still pushes messages from non-muted senders', () => {
        const h = makeHarness();
        h.hub.mute(P1);

        const fromP2 = makeMessage({ fromPlayerId: P2, id: 'p2-msg' });
        h.hub.deliverLocal(fromP2);

        expect(h.delivered).toEqual([fromP2]);
    });

    it('excludes a muted sender from history()', () => {
        const h = makeHarness();
        h.hub.deliverLocal(makeMessage({ id: 'a', fromPlayerId: P1 }));
        h.hub.deliverLocal(makeMessage({ id: 'b', fromPlayerId: P2 }));

        h.hub.mute(P1);

        expect(h.hub.history().map((m) => m.id)).toEqual(['b']);
    });

    it('restores a sender to history() and delivery after unmute', () => {
        const h = makeHarness();
        h.hub.mute(P1);
        h.hub.deliverLocal(makeMessage({ id: 'a', fromPlayerId: P1 }));

        // While muted: not delivered, not in history.
        expect(h.delivered).toEqual([]);
        expect(h.hub.history()).toEqual([]);

        h.hub.unmute(P1);

        // After unmute: the stored message reappears in history (reversible view
        // filter); a new message is delivered live.
        expect(h.hub.history().map((m) => m.id)).toEqual(['a']);
        const live = makeMessage({ id: 'b', fromPlayerId: P1 });
        h.hub.deliverLocal(live);
        expect(h.delivered).toEqual([live]);
    });

    it('muting is idempotent and unmuting an un-muted player is a no-op', () => {
        const h = makeHarness();
        const fromP1 = makeMessage({ fromPlayerId: P1 });

        h.hub.unmute(P1); // no-op
        h.hub.mute(P1);
        h.hub.mute(P1); // idempotent
        h.hub.deliverLocal(fromP1);

        expect(h.delivered).toEqual([]);
    });
});
