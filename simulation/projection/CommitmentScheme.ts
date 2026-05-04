/**
 * simulation/projection/CommitmentScheme.ts
 *
 * SHA-256 cryptographic commitment scheme for values that must be fixed before
 * they are revealed to clients.
 *
 * Architecture references: §4.6, §8
 * Invariants upheld:
 *   #1 — simulation/ has zero runtime dependencies on React, DOM, or networking.
 *   #9 — CommitmentScheme.verify() is the client-side trust gate for REVEAL.
 */

// @chimera-review: node:crypto is permitted here per architecture §8 commitment mandate.
import { createHash, randomBytes } from 'node:crypto';

const NONCE_BYTE_LENGTH = 32;
const COMMITMENT_ID_BYTE_LENGTH = 16;

/**
 * Opaque commitment identifier. Branded to prevent mix-up with other
 * string-shaped identifiers.
 */
export type CommitmentId = string & { readonly __brand: 'CommitmentId' };

/**
 * Constructs a branded {@link CommitmentId} from a raw string.
 *
 * This is the single authorised cast site for the CommitmentId brand.
 */
export function toCommitmentId(raw: string): CommitmentId {
    return raw as CommitmentId;
}

/**
 * Commitment envelope broadcast during Phase 1 of the commit/reveal protocol
 * (§4.6 / §8). Save files persist pending envelopes so verification can resume
 * after reload.
 *
 * Invariant #44: `revealedAt` is a tick integer — never a float.
 */
export interface CommitmentEnvelope {
    readonly id: CommitmentId;
    readonly commitment: string;
    readonly revealedAt?: number;
}

/**
 * Reveal payload broadcast by the host during Phase 2 of the commit/reveal
 * protocol (§4.6 / §8). Clients call `CommitmentScheme.verify()` with this
 * before trusting the revealed `value`.
 */
export interface CommitmentReveal {
    readonly id: CommitmentId;
    readonly value: unknown;
    readonly nonce: string;
}

export interface CommitmentScheme {
    commit(value: unknown): CommitmentEnvelope;
    verify(reveal: CommitmentReveal, envelope: CommitmentEnvelope): boolean;
}

export class CommitmentVerificationError extends Error {
    constructor(message = 'Commitment verification failed') {
        super(message);
        this.name = 'CommitmentVerificationError';
    }
}

export class DefaultCommitmentScheme implements CommitmentScheme {
    commit(value: unknown): CommitmentEnvelope {
        const nonce = randomBytes(NONCE_BYTE_LENGTH).toString('hex');
        const id = toCommitmentId(randomBytes(COMMITMENT_ID_BYTE_LENGTH).toString('hex'));

        return {
            id,
            commitment: computeCommitment(value, nonce),
        };
    }

    verify(reveal: CommitmentReveal, envelope: CommitmentEnvelope): boolean {
        const expectedCommitment = computeCommitment(reveal.value, reveal.nonce);
        if (reveal.id !== envelope.id || expectedCommitment !== envelope.commitment) {
            throw new CommitmentVerificationError();
        }

        return true;
    }
}

function computeCommitment(value: unknown, nonce: string): string {
    return createHash('sha256')
        .update(`${JSON.stringify(value)}${nonce}`)
        .digest('hex');
}
