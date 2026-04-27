/**
 * simulation/profile/InMemoryProfileRepository.test.ts
 *
 * Unit tests for InMemoryProfileRepository.
 * Architecture: §4.24 — Player Profiles & Directory
 * Task: F14-T03 (issue #340)
 *
 * TDD: tests written before implementation — confirmed red.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryProfileRepository } from './InMemoryProfileRepository.js';
import { localProfileId } from './ProfileSchema.js';
import type { PlayerProfile } from './ProfileSchema.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeProfile(id: string, displayName: string): PlayerProfile {
    return {
        localProfileId: localProfileId(id),
        displayName,
        avatar: { kind: 'builtin', ref: 'avatar/default' as never },
        locale: 'en-US',
    };
}

// ─── InMemoryProfileRepository ────────────────────────────────────────────────

describe('InMemoryProfileRepository', () => {
    let repo: InMemoryProfileRepository;

    beforeEach(() => {
        repo = new InMemoryProfileRepository();
    });

    // ── Construction ──────────────────────────────────────────────────────────

    it('starts empty — load returns null for any id', async () => {
        const result = await repo.load(localProfileId('unknown'));
        expect(result).toBeNull();
    });

    it('starts empty — listLocalSlots returns an empty array', async () => {
        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(0);
    });

    // ── save / load round-trip ─────────────────────────────────────────────

    it('save then load round-trips a PlayerProfile without mutation', async () => {
        const profile = makeProfile('p1', 'Alice');
        await repo.save(profile);
        const loaded = await repo.load(localProfileId('p1'));
        expect(loaded).toEqual(profile);
    });

    it('loaded value is not the same reference as the saved value', async () => {
        const profile = makeProfile('p1', 'Alice');
        await repo.save(profile);
        const loaded = await repo.load(localProfileId('p1'));
        // Defensive copy: same shape but distinct reference
        expect(loaded).not.toBe(profile);
    });

    it('save overwrites an existing profile with the same localProfileId', async () => {
        const original = makeProfile('p1', 'Alice');
        const updated = makeProfile('p1', 'Alicia');
        await repo.save(original);
        await repo.save(updated);
        const loaded = await repo.load(localProfileId('p1'));
        expect(loaded?.displayName).toBe('Alicia');
    });

    it('load returns null for a non-existent profile after saving another', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        const result = await repo.load(localProfileId('p2'));
        expect(result).toBeNull();
    });

    // ── delete ─────────────────────────────────────────────────────────────

    it('delete removes the profile; subsequent load returns null', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        await repo.delete(localProfileId('p1'));
        const result = await repo.load(localProfileId('p1'));
        expect(result).toBeNull();
    });

    it('delete on a non-existent profile resolves without error', async () => {
        await expect(repo.delete(localProfileId('ghost'))).resolves.toBeUndefined();
    });

    // ── listLocalSlots ────────────────────────────────────────────────────

    it('listLocalSlots returns only localProfileId and displayName for each saved profile', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        await repo.save(makeProfile('p2', 'Bob'));
        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(2);
        // Each slot must only contain localProfileId and displayName
        for (const slot of slots) {
            expect(Object.keys(slot).sort()).toEqual(['displayName', 'localProfileId']);
        }
    });

    it('listLocalSlots includes the correct localProfileId and displayName values', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        await repo.save(makeProfile('p2', 'Bob'));
        const slots = await repo.listLocalSlots();
        const byId = Object.fromEntries(slots.map((s) => [s.localProfileId, s.displayName]));
        expect(byId['p1']).toBe('Alice');
        expect(byId['p2']).toBe('Bob');
    });

    it('listLocalSlots does not include deleted profiles', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        await repo.save(makeProfile('p2', 'Bob'));
        await repo.delete(localProfileId('p1'));
        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(1);
        expect(slots[0]?.localProfileId).toBe('p2');
    });

    it('listLocalSlots returns a readonly array', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        const slots = await repo.listLocalSlots();
        // The returned value must satisfy the readonly contract from ProfileRepository
        expect(Array.isArray(slots)).toBe(true);
    });
});
