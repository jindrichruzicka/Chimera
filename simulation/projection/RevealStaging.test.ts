/**
 * Unit tests for simulation/projection/RevealStaging.ts.
 *
 * The host-side reveal-staging store retains a player's committed bundle
 * ({ value, nonce }) between Commit and Reveal so the host can build a valid
 * CommitmentReveal later, and persists it alongside SaveFile.pendingCommitments
 * (Invariant #26). Game-agnostic: the staged value is opaque.
 */

import { describe, expect, it } from 'vitest';

import { playerId } from '../engine/types.js';
import { toCommitmentId } from './CommitmentScheme.js';
import { RevealStaging, RevealStagingError, type StagedReveal } from './RevealStaging.js';

const P1 = playerId('player-1');
const P2 = playerId('player-2');

function stagedReveal(
    player: ReturnType<typeof playerId>,
    options: { envelopeId?: string; nonce?: string; value?: unknown } = {},
): StagedReveal {
    return {
        envelopeId: toCommitmentId(options.envelopeId ?? `env-${player}`),
        playerId: player,
        nonce: options.nonce ?? 'a'.repeat(64),
        value: options.value ?? { turn: 1 },
    };
}

describe('RevealStaging.stage / hasCommitted', () => {
    it('marks a staged player as committed and leaves others uncommitted', () => {
        const staging = new RevealStaging();

        staging.stage(stagedReveal(P1));

        expect(staging.hasCommitted(P1)).toBe(true);
        expect(staging.hasCommitted(P2)).toBe(false);
    });

    it('keeps one entry per player when the same player re-commits (overwrite)', () => {
        const staging = new RevealStaging();

        staging.stage(stagedReveal(P1, { envelopeId: 'env-old' }));
        staging.stage(stagedReveal(P1, { envelopeId: 'env-new' }));

        expect(staging.committedPlayerIds()).toEqual([P1]);
        expect(staging.buildReveal(P1).id).toBe(toCommitmentId('env-new'));
        expect(Object.keys(staging.capture())).toEqual([toCommitmentId('env-new')]);
    });
});

describe('RevealStaging.committedPlayerIds', () => {
    it('lists every staged player in insertion order', () => {
        const staging = new RevealStaging();

        staging.stage(stagedReveal(P1, { envelopeId: 'e1' }));
        staging.stage(stagedReveal(P2, { envelopeId: 'e2' }));

        expect(staging.committedPlayerIds()).toEqual([P1, P2]);
    });
});

describe('RevealStaging.buildReveal', () => {
    it('returns the retained id, value, and nonce', () => {
        const staging = new RevealStaging();
        const entry = stagedReveal(P1, {
            envelopeId: 'e1',
            nonce: 'b'.repeat(64),
            value: { x: 9 },
        });
        staging.stage(entry);

        expect(staging.buildReveal(P1)).toEqual({
            id: toCommitmentId('e1'),
            value: { x: 9 },
            nonce: 'b'.repeat(64),
        });
    });

    it('throws RevealStagingError for a player with no staged commitment', () => {
        const staging = new RevealStaging();

        expect(() => staging.buildReveal(P1)).toThrow(RevealStagingError);
    });
});

describe('RevealStaging.clearTurn', () => {
    it('discards all staged reveals', () => {
        const staging = new RevealStaging();
        staging.stage(stagedReveal(P1));
        staging.stage(stagedReveal(P2));

        staging.clearTurn();

        expect(staging.hasCommitted(P1)).toBe(false);
        expect(staging.committedPlayerIds()).toEqual([]);
        expect(staging.capture()).toEqual({});
    });
});

describe('RevealStaging.capture / restore', () => {
    it('captures a null-prototype copy keyed by envelope id, isolated from the store', () => {
        const staging = new RevealStaging();
        staging.stage(stagedReveal(P1, { envelopeId: 'e1' }));

        const captured = staging.capture();

        expect(Object.getPrototypeOf(captured)).toBeNull();
        expect(Object.keys(captured)).toEqual([toCommitmentId('e1')]);

        delete (captured as Record<string, unknown>)[toCommitmentId('e1')];
        expect(staging.hasCommitted(P1)).toBe(true);
    });

    it('round-trips through capture/restore', () => {
        const source = new RevealStaging();
        source.stage(stagedReveal(P1, { envelopeId: 'e1' }));
        source.stage(stagedReveal(P2, { envelopeId: 'e2' }));

        const restored = new RevealStaging();
        restored.restore(source.capture());

        expect(restored.hasCommitted(P1)).toBe(true);
        expect(restored.hasCommitted(P2)).toBe(true);
        expect(restored.committedPlayerIds()).toEqual(source.committedPlayerIds());
        expect(restored.buildReveal(P1)).toEqual(source.buildReveal(P1));
    });

    it('does not pollute Object.prototype from a malicious __proto__ key on restore', () => {
        const staging = new RevealStaging();
        const malicious = JSON.parse('{"__proto__": {"polluted": true}}') as Record<
            string,
            StagedReveal
        >;

        staging.restore(malicious);

        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });
});
