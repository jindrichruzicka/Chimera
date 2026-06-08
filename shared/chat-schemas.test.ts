/**
 * shared/chat-schemas.test.ts
 *
 * Tests for the runtime Zod scope schema that mirrors the canonical chat
 * contract in shared/chat.ts. This is the single scope definition reused by the
 * wire-protocol `CHAT` frame and the main-process IPC `chimera:chat:send`
 * request validation.
 *
 * Architecture: §4.29 — Chat System
 * Task: F45 / T03 (issue #681)
 */

import { describe, it, expect } from 'vitest';

import { ChatScopeSchema } from './chat-schemas.js';

describe('ChatScopeSchema', () => {
    it('accepts a lobby scope', () => {
        expect(ChatScopeSchema.safeParse({ kind: 'lobby' }).success).toBe(true);
    });

    it('accepts a team scope with a teamId', () => {
        expect(ChatScopeSchema.safeParse({ kind: 'team', teamId: 'red' }).success).toBe(true);
    });

    it('accepts a private scope with a toPlayerId', () => {
        expect(ChatScopeSchema.safeParse({ kind: 'private', toPlayerId: 'p2' }).success).toBe(true);
    });

    it('rejects an unknown discriminant', () => {
        expect(ChatScopeSchema.safeParse({ kind: 'global' }).success).toBe(false);
    });

    it('rejects a team scope missing teamId', () => {
        expect(ChatScopeSchema.safeParse({ kind: 'team' }).success).toBe(false);
    });

    it('rejects a private scope missing toPlayerId', () => {
        expect(ChatScopeSchema.safeParse({ kind: 'private' }).success).toBe(false);
    });

    it('rejects unknown extra keys (strict)', () => {
        expect(ChatScopeSchema.safeParse({ kind: 'lobby', extra: 1 }).success).toBe(false);
    });

    it('rejects a non-object', () => {
        expect(ChatScopeSchema.safeParse('lobby').success).toBe(false);
    });
});
