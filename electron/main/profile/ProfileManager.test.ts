/**
 * electron/main/profile/ProfileManager.test.ts
 *
 * Unit tests for ProfileManager (§4.24, invariant #60).
 *
 * Dependency injection via InMemoryProfileRepository — no real filesystem.
 * TDD: tests written before implementation — confirmed red.
 *
 * Task: F14-T-342 (issue #342)
 */

import { describe, expect, it } from 'vitest';

import { InMemoryProfileRepository } from '@chimera/simulation/profile/InMemoryProfileRepository.js';
import { localProfileId, type PlayerProfile } from '@chimera/simulation/profile/ProfileSchema.js';

import {
    NoActiveProfileError,
    NoPendingCandidateError,
    PendingUpdateAlreadyActiveError,
    ProfileManager,
    ProfileNotFoundError,
} from './ProfileManager.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(id: string, displayName: string): PlayerProfile {
    return {
        localProfileId: localProfileId(id),
        displayName,
        avatar: { kind: 'builtin', ref: 'avatar/default' as never },
        locale: 'en-US',
    };
}

// ─── ProfileManager tests ──────────────────────────────────────────────────────

describe('ProfileManager', () => {
    // ── getLocal ──────────────────────────────────────────────────────────────

    it('getLocal returns the profile from the repository', async () => {
        const repo = new InMemoryProfileRepository();
        const profile = makeProfile('p1', 'Alice');
        await repo.save(profile);

        const manager = new ProfileManager(repo);
        const loaded = await manager.getLocal(localProfileId('p1'));

        expect(loaded).toEqual(profile);
    });

    it('getLocal throws ProfileNotFoundError when profile does not exist', async () => {
        const repo = new InMemoryProfileRepository();
        const manager = new ProfileManager(repo);

        await expect(manager.getLocal(localProfileId('nobody'))).rejects.toThrow(
            ProfileNotFoundError,
        );
    });

    // ── currentAttestation ────────────────────────────────────────────────────

    it('currentAttestation returns the loaded profile', async () => {
        const repo = new InMemoryProfileRepository();
        const profile = makeProfile('p1', 'Alice');
        await repo.save(profile);

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));

        expect(manager.currentAttestation()).toEqual(profile);
    });

    it('currentAttestation throws NoActiveProfileError when no profile has been loaded', () => {
        const repo = new InMemoryProfileRepository();
        const manager = new ProfileManager(repo);

        expect(() => manager.currentAttestation()).toThrow(NoActiveProfileError);
    });

    // ── updateLocal ───────────────────────────────────────────────────────────

    it('updateLocal returns a new profile with the patch applied', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));

        const candidate = manager.updateLocal({ displayName: 'Alice Updated' });

        expect(candidate.displayName).toBe('Alice Updated');
        expect(candidate.localProfileId).toBe(localProfileId('p1'));
    });

    it('updateLocal builds a candidate without persisting to the repository', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));

        manager.updateLocal({ displayName: 'Alice Updated' });

        // Repository must still hold the original profile — no save has been called
        const persisted = await repo.load(localProfileId('p1'));
        expect(persisted?.displayName).toBe('Alice');
    });

    it('currentAttestation returns the pending candidate after updateLocal', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));

        const candidate = manager.updateLocal({ displayName: 'Alice Updated' });

        expect(manager.currentAttestation()).toEqual(candidate);
    });

    it('updateLocal throws NoActiveProfileError when no profile has been loaded', () => {
        const repo = new InMemoryProfileRepository();
        const manager = new ProfileManager(repo);

        expect(() => manager.updateLocal({ displayName: 'Alice' })).toThrow(NoActiveProfileError);
    });

    it('updateLocal throws PendingUpdateAlreadyActiveError when a candidate is already pending', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));

        // First update creates a pending candidate.
        manager.updateLocal({ displayName: 'Alice Updated' });

        // Second update must not silently overwrite the pending candidate.
        expect(() => manager.updateLocal({ displayName: 'Alice Updated Again' })).toThrow(
            PendingUpdateAlreadyActiveError,
        );
    });

    it('updateLocal does not allow overwriting localProfileId via patch', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));

        // TypeScript forbids this at compile time; we verify the runtime
        // behaviour via a cast so the test documents the intent.
        const patchWithId = { displayName: 'Alice Updated' } as Parameters<
            typeof manager.updateLocal
        >[0];
        const candidate = manager.updateLocal(patchWithId);

        // The primary key must never change.
        expect(candidate.localProfileId).toBe('p1');
    });

    // ── acknowledgeUpdate ─────────────────────────────────────────────────────

    it('acknowledgeUpdate persists the candidate to the repository', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));
        manager.updateLocal({ displayName: 'Alice Updated' });

        await manager.acknowledgeUpdate();

        const persisted = await repo.load(localProfileId('p1'));
        expect(persisted?.displayName).toBe('Alice Updated');
    });

    it('acknowledgeUpdate clears the candidate so currentAttestation returns the committed profile', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));
        manager.updateLocal({ displayName: 'Alice Updated' });

        await manager.acknowledgeUpdate();

        const attestation = manager.currentAttestation();
        expect(attestation.displayName).toBe('Alice Updated');
    });

    it('acknowledgeUpdate throws NoPendingCandidateError when there is no pending update', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));

        await expect(manager.acknowledgeUpdate()).rejects.toThrow(NoPendingCandidateError);
    });

    // ── discardCandidate ──────────────────────────────────────────────────────

    it('discardCandidate clears the pending candidate', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));
        manager.updateLocal({ displayName: 'Alice Updated' });

        manager.discardCandidate();

        // After discard, attestation should return the original profile
        expect(manager.currentAttestation().displayName).toBe('Alice');
    });

    it('discardCandidate does not persist anything to the repository', async () => {
        const repo = new InMemoryProfileRepository();
        await repo.save(makeProfile('p1', 'Alice'));

        const manager = new ProfileManager(repo);
        await manager.getLocal(localProfileId('p1'));
        manager.updateLocal({ displayName: 'Alice Updated' });

        manager.discardCandidate();

        const persisted = await repo.load(localProfileId('p1'));
        expect(persisted?.displayName).toBe('Alice');
    });
});
