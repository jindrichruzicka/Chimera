/**
 * Unit tests for simulation/projection/CommitmentScheme.ts.
 *
 * Written first (TDD red) per issue #439.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
    CommitmentVerificationError,
    DefaultCommitmentScheme,
    toCommitmentId,
} from './CommitmentScheme.js';
import type { CommitmentEnvelope, CommitmentReveal } from './CommitmentScheme.js';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const KNOWN_ID = toCommitmentId('commitment-1');
const KNOWN_NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const COMMITTED_VALUE = Object.freeze({ deck: ['alpha', 'bravo', 'charlie'], drawIndex: 1 });

function sha256Commitment(value: unknown, nonce: string): string {
    return createHash('sha256')
        .update(`${JSON.stringify(value)}${nonce}`)
        .digest('hex');
}

function makeEnvelope(value: unknown, nonce: string): CommitmentEnvelope {
    return {
        id: KNOWN_ID,
        commitment: sha256Commitment(value, nonce),
    };
}

describe('DefaultCommitmentScheme.commit()', () => {
    it('returns a CommitmentEnvelope with a valid SHA-256 hex commitment', () => {
        const scheme = new DefaultCommitmentScheme();

        const envelope = scheme.commit(COMMITTED_VALUE);

        expect(envelope.id.length).toBeGreaterThan(0);
        expect(envelope.commitment).toMatch(SHA256_HEX_PATTERN);
        expect(Object.hasOwn(envelope, 'nonce')).toBe(false);
    });
});

describe('DefaultCommitmentScheme.verify()', () => {
    it('returns true when the reveal value and nonce reproduce the commitment hash', () => {
        const scheme = new DefaultCommitmentScheme();
        const envelope = makeEnvelope(COMMITTED_VALUE, KNOWN_NONCE);
        const reveal: CommitmentReveal = {
            id: KNOWN_ID,
            value: COMMITTED_VALUE,
            nonce: KNOWN_NONCE,
        };

        expect(scheme.verify(reveal, envelope)).toBe(true);
    });

    it('throws CommitmentVerificationError for a tampered value', () => {
        const scheme = new DefaultCommitmentScheme();
        const envelope = makeEnvelope(COMMITTED_VALUE, KNOWN_NONCE);
        const reveal: CommitmentReveal = {
            id: KNOWN_ID,
            value: { deck: ['alpha', 'charlie', 'bravo'], drawIndex: 1 },
            nonce: KNOWN_NONCE,
        };

        expect(() => scheme.verify(reveal, envelope)).toThrow(CommitmentVerificationError);
    });

    it('throws CommitmentVerificationError for a tampered nonce', () => {
        const scheme = new DefaultCommitmentScheme();
        const envelope = makeEnvelope(COMMITTED_VALUE, KNOWN_NONCE);
        const reveal: CommitmentReveal = {
            id: KNOWN_ID,
            value: COMMITTED_VALUE,
            nonce: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        };

        expect(() => scheme.verify(reveal, envelope)).toThrow(CommitmentVerificationError);
    });
});

describe('CommitmentVerificationError', () => {
    it('is an Error subclass', () => {
        const error = new CommitmentVerificationError('verification failed');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(CommitmentVerificationError);
        expect(error.name).toBe('CommitmentVerificationError');
    });
});
