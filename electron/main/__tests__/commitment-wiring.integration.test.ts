/**
 * electron/main/__tests__/commitment-wiring.integration.test.ts
 *
 * Integration test for the full commitment-envelope delivery pipeline.
 *
 * Covers the end-to-end flow described in BLOCK-1 (F27 bug):
 *   1. commit(value)          — host calls commit; envelope stored in pendingCommitments
 *   2. snapshot delivery      — projected PlayerSnapshot.commitments contains the envelope
 *   3. REVEAL verification    — client restores from snapshot; verifyReveal() succeeds
 *   4. renderer forwarding    — after verify() the caller receives the trusted reveal value
 *
 * Note: the index.ts `registerClientRevealForwarding` wiring is covered by
 * electron/main/index.test.ts. This test focuses on Phases 1–4 of the pipeline
 * using only `SessionCommitmentRuntime` and `DefaultStateProjector` (no Electron
 * module imports) to avoid the binary-path requirement that full index.ts imports bring.
 *
 * Architecture: §4.6 (StateProjector), §8 (Cryptographic Commitment)
 * Invariants verified:
 *   #3  — Only PlayerSnapshot crosses boundaries; GameSnapshot stays in main
 *   #8  — StateProjector.project() is the mandatory gate for outbound snapshots
 *   #9  — CommitmentScheme.verify() is called client-side before trusting a REVEAL
 *
 * Tests written first (red confirmed before implementation).
 */

import { describe, expect, it, vi } from 'vitest';

import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import { gamePhase, playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import { DefaultStateProjector } from '@chimera/simulation/projection/StateProjector.js';
import type { CommitmentEnvelope } from '@chimera/simulation/projection/index.js';
import { toCommitmentId } from '@chimera/simulation/projection/index.js';
import type { VisibilityRules } from '@chimera/simulation/projection/types.js';

import { SessionCommitmentRuntime } from '../runtime/SessionRuntime.js';
import type { CommitmentReveal } from '@chimera/simulation/projection/CommitmentScheme.js';
import { CommitmentVerificationError } from '@chimera/simulation/projection/CommitmentScheme.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');

function makeBaseSnapshot(): BaseGameSnapshot {
    return {
        tick: 1,
        seed: 42,
        players: { [P1]: { id: P1 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        matchResult: null,
    };
}

/** All-visible, no masking — simplest possible rules for projection testing. */
const trivialRules: VisibilityRules = {
    isEntityVisible: () => true,
    maskEntity: (e) => e,
    maskPlayerState: (p) => p,
    filterEvents: (evs) => evs,
};

// ── Integration tests ──────────────────────────────────────────────────────────

describe('commitment envelope delivery pipeline (BLOCK-1 / F27)', () => {
    describe('Phase 1 — commit(value) → snapshot envelope delivery', () => {
        it('committed envelope appears in PlayerSnapshot.commitments after project()', () => {
            const hostCommitments = new SessionCommitmentRuntime();
            const projector = new DefaultStateProjector(trivialRules, {
                getPendingCommitments: () => hostCommitments.capturePendingCommitments(),
            });

            const envelope = hostCommitments.commit({ card: 'ace-of-stars', drawIndex: 2 });
            const snapshot = projector.project(makeBaseSnapshot(), P1);

            expect(snapshot.commitments[envelope.id]).toEqual(envelope);
        });

        it('multiple committed envelopes are all present in the snapshot', () => {
            const hostCommitments = new SessionCommitmentRuntime();
            const projector = new DefaultStateProjector(trivialRules, {
                getPendingCommitments: () => hostCommitments.capturePendingCommitments(),
            });

            const e1 = hostCommitments.commit({ die: 4 });
            const e2 = hostCommitments.commit({ die: 6 });
            const snapshot = projector.project(makeBaseSnapshot(), P1);

            expect(snapshot.commitments[e1.id]).toEqual(e1);
            expect(snapshot.commitments[e2.id]).toEqual(e2);
        });

        it('PlayerSnapshot.commitments uses a null-prototype map', () => {
            const hostCommitments = new SessionCommitmentRuntime();
            const projector = new DefaultStateProjector(trivialRules, {
                getPendingCommitments: () => hostCommitments.capturePendingCommitments(),
            });

            hostCommitments.commit({ x: 1 });
            const snapshot = projector.project(makeBaseSnapshot(), P1);

            expect(Object.getPrototypeOf(snapshot.commitments)).toBeNull();
        });
    });

    describe('Phase 2 — client receives snapshot → REVEAL verification', () => {
        it('client can verify a REVEAL after restoring snapshot commitments', () => {
            // Use a deterministic commitment scheme so we can construct a valid reveal
            const FIXED_ID = toCommitmentId('fixed-id');
            const FIXED_NONCE = 'aabbcc';
            const VALUE = { card: 'ace' };
            const fakeScheme = {
                commit(_v: unknown) {
                    return { id: FIXED_ID, commitment: 'fake-commitment-hash' };
                },
                verify(_reveal: CommitmentReveal, _envelope: CommitmentEnvelope): boolean {
                    return true; // deterministic accept in this integration test
                },
            };

            const hostCommitments = new SessionCommitmentRuntime(fakeScheme);
            const projector = new DefaultStateProjector(trivialRules, {
                getPendingCommitments: () => hostCommitments.capturePendingCommitments(),
            });

            // Host commits
            const envelope = hostCommitments.commit(VALUE);
            // Host broadcasts snapshot with the envelope
            const snapshot = projector.project(makeBaseSnapshot(), P1);

            // Client side: restore envelopes from received snapshot
            const clientCommitments = new SessionCommitmentRuntime(fakeScheme);
            clientCommitments.restorePendingCommitments(snapshot.commitments);

            // Host reveals; client verifies before trusting the value
            const reveal: CommitmentReveal = { id: envelope.id, value: VALUE, nonce: FIXED_NONCE };
            let trustedValue: unknown;
            expect(() => {
                trustedValue = clientCommitments.verifyReveal(reveal);
            }).not.toThrow();
            expect(trustedValue).toEqual(VALUE);
        });

        it('verifyReveal throws when envelope is missing (never broadcast)', () => {
            const clientCommitments = new SessionCommitmentRuntime();
            // No restore — no envelopes known to the client
            const reveal: CommitmentReveal = {
                id: toCommitmentId('unknown-id'),
                value: { card: 'ace' },
                nonce: 'nonce',
            };

            expect(() => clientCommitments.verifyReveal(reveal)).toThrow(
                CommitmentVerificationError,
            );
        });
    });

    describe('Phase 3 — renderer forwarding after verifyReveal()', () => {
        it('verified reveal value is returned and can be forwarded to renderer', () => {
            const VALUE = { card: 'ace-of-stars' };
            const FIXED_ID = toCommitmentId('renderer-fwd-id');
            const FIXED_NONCE = 'fwd-nonce';
            const fakeScheme = {
                commit(_v: unknown) {
                    return { id: FIXED_ID, commitment: 'hash' };
                },
                verify(_r: CommitmentReveal, _e: CommitmentEnvelope): boolean {
                    return true;
                },
            };

            const hostCommitments = new SessionCommitmentRuntime(fakeScheme);
            const projector = new DefaultStateProjector(trivialRules, {
                getPendingCommitments: () => hostCommitments.capturePendingCommitments(),
            });

            // Host commits and broadcasts
            const envelope = hostCommitments.commit(VALUE);
            const snapshot = projector.project(makeBaseSnapshot(), P1);

            // Client restores from snapshot
            const clientCommitments = new SessionCommitmentRuntime(fakeScheme);
            clientCommitments.restorePendingCommitments(snapshot.commitments);

            // Host sends REVEAL; client verifies and forwards
            const reveal: CommitmentReveal = { id: envelope.id, value: VALUE, nonce: FIXED_NONCE };
            const sendRevealToRenderer = vi.fn<(r: CommitmentReveal) => void>();
            const trustedValue = clientCommitments.verifyReveal(reveal);
            // Only forward when verification succeeds (no throw)
            sendRevealToRenderer(reveal);

            expect(sendRevealToRenderer).toHaveBeenCalledOnce();
            expect(sendRevealToRenderer).toHaveBeenCalledWith(
                expect.objectContaining({ id: FIXED_ID, value: VALUE }),
            );
            expect(trustedValue).toEqual(VALUE);
        });

        it('verifyReveal() throws CommitmentVerificationError for a tampered REVEAL', () => {
            // Default scheme uses real SHA-256; the commitment won't match
            const hostCommitments = new SessionCommitmentRuntime();
            const projector = new DefaultStateProjector(trivialRules, {
                getPendingCommitments: () => hostCommitments.capturePendingCommitments(),
            });

            const envelope = hostCommitments.commit({ original: true });
            const snapshot = projector.project(makeBaseSnapshot(), P1);

            const clientCommitments = new SessionCommitmentRuntime();
            clientCommitments.restorePendingCommitments(snapshot.commitments);

            // Tampered reveal — different value; real SHA-256 will not match
            const tamperedReveal: CommitmentReveal = {
                id: envelope.id,
                value: { tampered: true },
                nonce: 'wrong-nonce',
            };
            const sendRevealToRenderer = vi.fn();
            expect(() => {
                clientCommitments.verifyReveal(tamperedReveal);
                sendRevealToRenderer(tamperedReveal); // should never reach here
            }).toThrow(CommitmentVerificationError);

            expect(sendRevealToRenderer).not.toHaveBeenCalled();
        });
    });
});
