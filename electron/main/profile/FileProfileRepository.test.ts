/**
 * electron/main/profile/FileProfileRepository.test.ts
 *
 * Integration tests for FileProfileRepository (§4.24, invariant #60).
 *
 * Each test runs against a unique temp directory so tests never share state.
 * TDD: tests written before implementation — confirmed red.
 *
 * Task: F14-T04 (issue #341)
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localProfileId } from '@chimera/simulation/profile/ProfileSchema.js';
import type { PlayerProfile } from '@chimera/simulation/profile/ProfileSchema.js';

import { FileProfileRepository, InvalidLocalProfileIdError } from './FileProfileRepository.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'chimera-fileprofilerepo-test-'));
}

function makeProfile(id: string, displayName: string): PlayerProfile {
    return {
        localProfileId: localProfileId(id),
        displayName,
        avatar: { kind: 'builtin', ref: 'avatar/default' as never },
        locale: 'en-US',
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FileProfileRepository', () => {
    let tmpDir: string;
    let repo: FileProfileRepository;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
        repo = new FileProfileRepository(tmpDir);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // ── load on empty directory ──────────────────────────────────────────────

    it('load returns null when the profile file does not exist', async () => {
        const result = await repo.load(localProfileId('nobody'));
        expect(result).toBeNull();
    });

    it('listLocalSlots returns an empty array when the directory is empty', async () => {
        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(0);
    });

    it('listLocalSlots returns an empty array when the base directory does not exist', async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(0);
    });

    // ── save / load round-trip ────────────────────────────────────────────

    it('save then load round-trips a PlayerProfile', async () => {
        const profile = makeProfile('p1', 'Alice');
        await repo.save(profile);
        const loaded = await repo.load(localProfileId('p1'));
        expect(loaded).toEqual(profile);
    });

    it('save creates the base directory if it does not yet exist', async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
        const profile = makeProfile('p1', 'Alice');
        await repo.save(profile);
        const loaded = await repo.load(localProfileId('p1'));
        expect(loaded).toEqual(profile);
    });

    it('save overwrites an existing profile with the same localProfileId', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        await repo.save(makeProfile('p1', 'Alicia'));
        const loaded = await repo.load(localProfileId('p1'));
        expect(loaded?.displayName).toBe('Alicia');
    });

    // ── atomic write ──────────────────────────────────────────────────────

    it('save writes a .json file and does not leave a .tmp file behind', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        const entries = await fs.readdir(tmpDir);
        expect(entries).toContain('p1.json');
        expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
    });

    it('listLocalSlots ignores stale .tmp files left by a crashed write', async () => {
        // Simulate a crash mid-write: a .tmp file exists with no committed counterpart.
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(path.join(tmpDir, 'p1.json.tmp'), 'corrupt-partial');

        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(0);
    });

    it('load returns null for a profile that only has a stale .tmp file', async () => {
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(path.join(tmpDir, 'p1.json.tmp'), '{"corrupt":true}');

        const loaded = await repo.load(localProfileId('p1'));
        expect(loaded).toBeNull();
    });

    it('load returns null for a .json file with a schema-invalid payload (WARN-1)', async () => {
        // Simulate a hand-edited or partially migrated file that fails EngineProfileSchema.
        await fs.writeFile(
            path.join(tmpDir, 'p1.json'),
            JSON.stringify({ localProfileId: 'p1', displayName: 42 /* should be string */ }),
        );
        const loaded = await repo.load(localProfileId('p1'));
        expect(loaded).toBeNull();
    });

    // ── delete ────────────────────────────────────────────────────────────

    it('delete removes the file; subsequent load returns null', async () => {
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
        for (const slot of slots) {
            expect(Object.keys(slot).sort()).toEqual(['displayName', 'localProfileId']);
        }
    });

    it('listLocalSlots includes the correct values for each saved profile', async () => {
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

    it('listLocalSlots ignores non-.json files in the directory', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        await fs.writeFile(path.join(tmpDir, 'README.md'), 'docs');
        await fs.writeFile(path.join(tmpDir, 'stray.txt'), 'noise');
        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(1);
        expect(slots[0]?.localProfileId).toBe('p1');
    });

    it('listLocalSlots skips a schema-invalid .json file and returns the remaining valid slots (WARN-1)', async () => {
        await repo.save(makeProfile('p1', 'Alice'));
        // Write a corrupt file alongside a valid one.
        await fs.writeFile(
            path.join(tmpDir, 'corrupt.json'),
            JSON.stringify({ localProfileId: 'corrupt', displayName: 99 }),
        );
        const slots = await repo.listLocalSlots();
        expect(slots).toHaveLength(1);
        expect(slots[0]?.localProfileId).toBe('p1');
    });

    // ── path-traversal protection ────────────────────────────────────────

    it.each(['../escape', '..', '.', 'foo/bar', 'foo\\bar', '', 'a'.repeat(65), 'BAD!'])(
        'rejects illegal localProfileId %s on save',
        async (raw) => {
            const profile = makeProfile(raw, 'Mallory');
            await expect(repo.save(profile)).rejects.toBeInstanceOf(InvalidLocalProfileIdError);
        },
    );

    it('rejects illegal localProfileId on load', async () => {
        await expect(repo.load(localProfileId('../escape'))).rejects.toBeInstanceOf(
            InvalidLocalProfileIdError,
        );
    });

    it('rejects illegal localProfileId on delete', async () => {
        await expect(repo.delete(localProfileId('../escape'))).rejects.toBeInstanceOf(
            InvalidLocalProfileIdError,
        );
    });
});
