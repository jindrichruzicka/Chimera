/**
 * electron/main/profile/PlayerDirectory.test.ts
 *
 * Unit tests for PlayerDirectory (§4.24 — host-only, invariant #60).
 *
 * Pure in-memory; no I/O, no mocks, no fakes required — the class is its own
 * test double.
 * TDD: tests written before implementation — confirmed red.
 *
 * Task: F14-T-342 (issue #342)
 */

import { describe, expect, it } from 'vitest';

import {
    localProfileId,
    type PlayerProfile,
} from '@chimera-engine/simulation/profile/ProfileSchema.js';
import { playerId } from '@chimera-engine/simulation/engine/types.js';

import {
    PlayerAlreadyExistsError,
    PlayerNotFoundError,
    PlayerDirectory,
} from './PlayerDirectory.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(id: string, displayName: string): PlayerProfile {
    return {
        localProfileId: localProfileId(id),
        displayName,
        avatar: { kind: 'builtin', ref: 'avatar/default' as never },
        locale: 'en-US',
    };
}

// ─── PlayerDirectory tests ────────────────────────────────────────────────────

describe('PlayerDirectory', () => {
    // ── snapshot on empty directory ───────────────────────────────────────────

    it('snapshot returns an empty record when no players have been added', () => {
        const dir = new PlayerDirectory();
        expect(dir.snapshot()).toEqual({});
    });

    // ── add ───────────────────────────────────────────────────────────────────

    it('add inserts a profile that is visible in the snapshot', () => {
        const dir = new PlayerDirectory();
        const p1 = playerId('p1');
        const profile = makeProfile('slot1', 'Alice');

        dir.add(p1, profile);

        expect(dir.snapshot()[p1]).toEqual(profile);
    });

    it('add throws PlayerAlreadyExistsError when the player is already in the directory', () => {
        const dir = new PlayerDirectory();
        const p1 = playerId('p1');
        dir.add(p1, makeProfile('slot1', 'Alice'));

        expect(() => dir.add(p1, makeProfile('slot1', 'Alice 2'))).toThrow(
            PlayerAlreadyExistsError,
        );
    });

    // ── update ────────────────────────────────────────────────────────────────

    it('update replaces an existing profile in the snapshot', () => {
        const dir = new PlayerDirectory();
        const p1 = playerId('p1');
        dir.add(p1, makeProfile('slot1', 'Alice'));

        const updated = makeProfile('slot1', 'Alice Updated');
        dir.update(p1, updated);

        expect(dir.snapshot()[p1]?.displayName).toBe('Alice Updated');
    });

    it('update throws PlayerNotFoundError when the player is not in the directory', () => {
        const dir = new PlayerDirectory();

        expect(() => dir.update(playerId('ghost'), makeProfile('slot1', 'Ghost'))).toThrow(
            PlayerNotFoundError,
        );
    });

    // ── remove ────────────────────────────────────────────────────────────────

    it('remove deletes the player from the snapshot', () => {
        const dir = new PlayerDirectory();
        const p1 = playerId('p1');
        dir.add(p1, makeProfile('slot1', 'Alice'));

        dir.remove(p1);

        expect(dir.snapshot()[p1]).toBeUndefined();
    });

    it('snapshot is empty after remove of the last entry', () => {
        const dir = new PlayerDirectory();
        const p1 = playerId('p1');
        dir.add(p1, makeProfile('slot1', 'Alice'));

        dir.remove(p1);

        expect(dir.snapshot()).toEqual({});
    });

    it('remove throws PlayerNotFoundError when the player is not in the directory', () => {
        const dir = new PlayerDirectory();

        expect(() => dir.remove(playerId('ghost'))).toThrow(PlayerNotFoundError);
    });

    // ── snapshot returns frozen record ────────────────────────────────────────

    it('snapshot returns a frozen record', () => {
        const dir = new PlayerDirectory();
        dir.add(playerId('p1'), makeProfile('slot1', 'Alice'));

        const snap = dir.snapshot();

        expect(Object.isFrozen(snap)).toBe(true);
    });

    it('mutating the snapshot record does not affect subsequent snapshots', () => {
        const dir = new PlayerDirectory();
        const p1 = playerId('p1');
        dir.add(p1, makeProfile('slot1', 'Alice'));

        const snap = dir.snapshot() as Record<string, PlayerProfile | undefined>;
        // Attempt to mutate the frozen object (will fail silently in non-strict or throw in strict)
        try {
            snap[p1] = makeProfile('slot1', 'Corrupted');
        } catch {
            // expected in strict mode
        }

        // The directory's internal state must be unchanged
        expect(dir.snapshot()[p1]?.displayName).toBe('Alice');
    });

    // ── multiple players ──────────────────────────────────────────────────────

    it('snapshot includes all added players', () => {
        const dir = new PlayerDirectory();
        const p1 = playerId('p1');
        const p2 = playerId('p2');
        dir.add(p1, makeProfile('slot1', 'Alice'));
        dir.add(p2, makeProfile('slot2', 'Bob'));

        const snap = dir.snapshot();
        expect(snap[p1]?.displayName).toBe('Alice');
        expect(snap[p2]?.displayName).toBe('Bob');
    });

    // ── reset ─────────────────────────────────────────────────────────────────

    it('reset clears all players from the directory', () => {
        const dir = new PlayerDirectory();
        dir.add(playerId('p1'), makeProfile('slot1', 'Alice'));
        dir.add(playerId('p2'), makeProfile('slot2', 'Bob'));

        dir.reset();

        expect(dir.snapshot()).toEqual({});
    });

    it('reset is idempotent on an already-empty directory', () => {
        const dir = new PlayerDirectory();

        expect(() => dir.reset()).not.toThrow();
        expect(dir.snapshot()).toEqual({});
    });
});
