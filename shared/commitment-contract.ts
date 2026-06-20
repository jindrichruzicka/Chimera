/**
 * shared/commitment-contract.ts
 *
 * Foundation contract types for the cryptographic commit/reveal protocol
 * (§4.6 / §8).
 *
 * The branded `CommitmentId` and the envelope/reveal payload shapes live in
 * `@chimera/shared` — the zero-dependency foundation leaf — so the foundation
 * can describe the projected snapshot and screen contracts (which carry
 * commitments) without importing *up* into `simulation`. The runtime scheme —
 * `toCommitmentId`, the `CommitmentScheme` interface and `DefaultCommitmentScheme`
 * implementation — stays in `simulation/projection/CommitmentScheme.ts`, which
 * re-exports these three types so `@chimera/simulation/projection` remains the
 * unchanged public import path.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code, zero workspace
 * imports. Relocated under issue #758.
 */

/**
 * Opaque commitment identifier. Branded to prevent mix-up with other
 * string-shaped identifiers.
 */
export type CommitmentId = string & { readonly __brand: 'CommitmentId' };

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
