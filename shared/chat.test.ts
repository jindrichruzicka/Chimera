/**
 * shared/chat.test.ts
 *
 * Tests for the canonical chat contract defined in shared/chat.ts.
 *
 * Architecture: §4.29 — Chat System
 * Task: F45 / T01 (issue #679)
 */

import { describe, it, expect } from 'vitest';
import type { PlayerId } from '@chimera/shared/engine-contract.js';
import type { ChatScope, ChatMessage, RelayResult } from './chat.js';

// shared/ is the foundation leaf, so its tests construct branded ids locally
// rather than importing the `playerId` factory from simulation/networking (#758).
const toPlayerId = (raw: string): PlayerId => raw as PlayerId;

// ─── ChatScope ──────────────────────────────────────────────────────────────

describe('shared/chat — ChatScope', () => {
    it('lobby scope narrows on kind', () => {
        const scope: ChatScope = { kind: 'lobby' };
        expect(scope.kind).toBe('lobby');
    });

    it('team scope carries a teamId', () => {
        const scope: ChatScope = { kind: 'team', teamId: 'red' };
        expect(scope.kind).toBe('team');
        if (scope.kind === 'team') expect(scope.teamId).toBe('red');
    });

    it('private scope carries a recipient PlayerId', () => {
        const scope: ChatScope = { kind: 'private', toPlayerId: toPlayerId('p2') };
        expect(scope.kind).toBe('private');
        if (scope.kind === 'private') expect(scope.toPlayerId).toBe(toPlayerId('p2'));
    });

    it('survives JSON serialise → parse for every variant', () => {
        const scopes: readonly ChatScope[] = [
            { kind: 'lobby' },
            { kind: 'team', teamId: 'blue' },
            { kind: 'private', toPlayerId: toPlayerId('p3') },
        ];
        for (const scope of scopes) {
            const round = JSON.parse(JSON.stringify(scope)) as ChatScope;
            expect(round).toEqual(scope);
        }
    });
});

// ─── ChatMessage ──────────────────────────────────────────────────────────────

describe('shared/chat — ChatMessage', () => {
    it('carries id, fromPlayerId, scope, body and serverTime', () => {
        const msg: ChatMessage = {
            id: 'msg-1',
            fromPlayerId: toPlayerId('p1'),
            scope: { kind: 'lobby' },
            body: 'hello',
            serverTime: 42,
        };
        expect(msg.id).toBe('msg-1');
        expect(msg.fromPlayerId).toBe(toPlayerId('p1'));
        expect(msg.scope.kind).toBe('lobby');
        expect(msg.body).toBe('hello');
        expect(msg.serverTime).toBe(42);
    });

    it('survives JSON serialise → parse', () => {
        const msg: ChatMessage = {
            id: 'msg-2',
            fromPlayerId: toPlayerId('p1'),
            scope: { kind: 'team', teamId: 'red' },
            body: 'team only',
            serverTime: 7,
        };
        const round = JSON.parse(JSON.stringify(msg)) as ChatMessage;
        expect(round).toEqual(msg);
    });
});

// ─── RelayResult ──────────────────────────────────────────────────────────────

describe('shared/chat — RelayResult', () => {
    it('ok result narrows to true', () => {
        const result: RelayResult = { ok: true };
        expect(result.ok).toBe(true);
    });

    it('failure result carries a reason for each rejection cause', () => {
        const reasons = [
            'too_long',
            'rate_limited',
            'empty',
            'invalid_scope',
            'no_session',
        ] as const;
        for (const reason of reasons) {
            const result: RelayResult = { ok: false, reason };
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe(reason);
        }
    });
});
