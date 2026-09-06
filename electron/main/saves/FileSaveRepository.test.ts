/**
 * electron/main/saves/FileSaveRepository.test.ts
 *
 * Integration tests for FileSaveRepository (§4.11, invariant #23).
 *
 * Uses a temporary directory with a unique suffix so tests never share state.
 * Runs the shared SaveRepository contract test suite to guarantee interface
 * parity with InMemorySaveRepository (invariant #41).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
    JsonSaveSerializer,
    computeBodyChecksum,
    createDefaultMigrator,
    CURRENT_SCHEMA_VERSION,
    SaveNotFoundError,
    SaveIntegrityError,
    SaveSchemaTooNewError,
} from '@chimera-engine/simulation/persistence/index.js';
import type { SaveBody } from '@chimera-engine/simulation/persistence/index.js';
import {
    runSaveRepositoryContractTests,
    makeFile,
} from '@chimera-engine/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { FileSaveRepository, InvalidSlotIdError } from './FileSaveRepository.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'chimera-filesaverepository-test-'));
}

function makeRepo(baseDir: string): FileSaveRepository {
    return new FileSaveRepository(new JsonSaveSerializer(), createDefaultMigrator(), baseDir);
}

// ── Shared contract tests ────────────────────────────────────────────────────

const contractDirs: string[] = [];

runSaveRepositoryContractTests('FileSaveRepository', () => {
    const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'chimera-contract-'));
    contractDirs.push(tmpBase);
    return makeRepo(tmpBase);
});

afterAll(() => {
    for (const dir of contractDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ── FileSaveRepository-specific integration tests ────────────────────────────

describe('FileSaveRepository — integration', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('list returns [] when the gameId subdirectory does not exist', async () => {
        const repo = makeRepo(tmpDir);

        expect(await repo.list('no-such-game')).toStrictEqual([]);
    });

    it('save writes a .chimera file and does not leave a .tmp file', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave');

        await repo.save(file);

        const dir = path.join(tmpDir, 'tactics');
        const entries = await fs.readdir(dir);
        expect(entries).toContain('autosave.chimera');
        expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
    });

    it('survives two concurrent saves to ONE slot, leaving a whole file and no .tmp', async () => {
        // The autosave slot has two independent writers that are not
        // serialised against each other: `HostSessionPipeline` fires
        // `autoSave` after every accepted `engine:end_turn` and does not await
        // it, and an explicit `saves.save()` that names no slot ALSO lands on
        // the autosave slot (`SessionRuntime.captureSaveFile` defaults it).
        // With one shared temp path the second rename finds nothing and the
        // caller's save is rejected — with a file on disk that the OTHER
        // writer put there.
        const repo = makeRepo(tmpDir);

        await Promise.all([
            repo.save(makeFile('tactics', 'autosave')),
            repo.save(makeFile('tactics', 'autosave')),
        ]);

        const dir = path.join(tmpDir, 'tactics');
        const entries = await fs.readdir(dir);
        expect(entries).toContain('autosave.chimera');
        expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
        // Whole, not half: whichever write renamed last must be readable in
        // full, which a torn or truncated file would fail.
        await expect(repo.load('tactics/autosave')).resolves.toBeDefined();
    });

    it('list excludes stale .tmp files left by a crashed write', async () => {
        const repo = makeRepo(tmpDir);
        // Simulate a crash mid-write: .tmp files exist but no .chimera file
        // does. Two artefacts with DIFFERENT discriminators, because the temp
        // path now belongs to the write: `list()` filters on the `.chimera`
        // suffix, so what stands between the discriminator is irrelevant and
        // this test must not start depending on one particular value.
        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'autosave.chimera.1.tmp'), 'corrupt-partial');
        await fs.writeFile(path.join(dir, 'autosave.chimera.427.tmp'), 'corrupt-partial');

        const slots = await repo.list('tactics');

        expect(slots).toHaveLength(0);
    });

    it('load round-trips the full SaveFile through serialisation', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave', 2_000_000_000_000);

        await repo.save(file);
        const loaded = await repo.load('tactics/autosave');

        // FileSaveRepository attaches a checksum on save; verify the original
        // fields are preserved (toMatchObject) rather than strict equality.
        expect(loaded).toMatchObject(file);
        expect(typeof (loaded.header as { checksum?: string }).checksum).toBe('string');
    });

    it('list entry has sizeBytes > 0 matching the file on disk', async () => {
        const repo = makeRepo(tmpDir);
        await repo.save(makeFile('tactics', 'autosave'));

        const slots = await repo.list('tactics');
        expect(slots[0]?.sizeBytes).toBeGreaterThan(0);

        const filePath = path.join(tmpDir, 'tactics', 'autosave.chimera');
        const stat = await fs.stat(filePath);
        expect(slots[0]?.sizeBytes).toBe(stat.size);
    });

    it('delete throws SaveNotFoundError when the file is absent', async () => {
        const repo = makeRepo(tmpDir);

        await expect(repo.delete('tactics/missing')).rejects.toBeInstanceOf(SaveNotFoundError);
    });

    it('save cleans up the .tmp file and re-throws when rename fails', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave');

        // Ensure the game directory exists so the write succeeds.
        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });

        // Make the destination path a directory so rename() fails with EISDIR.
        const dest = path.join(dir, 'autosave.chimera');
        await fs.mkdir(dest, { recursive: true });

        await expect(repo.save(file)).rejects.toThrow();

        // The .tmp file must have been cleaned up.
        const entries = await fs.readdir(dir);
        expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
    });
});

// ── Path traversal hardening tests ───────────────────────────────────────────

describe('FileSaveRepository — path traversal hardening', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    const TRAVERSAL_SLOT_IDS = [
        '../etc/passwd/autosave',
        '../../etc/autosave',
        'tactics/../../etc/passwd',
        '/absolute/autosave',
        'tactics//autosave',
        'UPPERCASE/autosave',
        'tactics/UPPERCASE',
        'slot with spaces/autosave',
        'tactics/slot with spaces',
        '\0null/autosave',
        'tactics/\0null',
        '../autosave',
        'tactics/..',
        './autosave',
        'tactics/.',
        'a b/autosave',
    ];

    for (const slotId of TRAVERSAL_SLOT_IDS) {
        it(`load throws InvalidSlotIdError for slotId ${JSON.stringify(slotId)}`, async () => {
            const repo = makeRepo(tmpDir);
            await expect(repo.load(slotId)).rejects.toBeInstanceOf(InvalidSlotIdError);
        });

        it(`delete throws InvalidSlotIdError for slotId ${JSON.stringify(slotId)}`, async () => {
            const repo = makeRepo(tmpDir);
            await expect(repo.delete(slotId)).rejects.toBeInstanceOf(InvalidSlotIdError);
        });
    }

    it('save throws InvalidSlotIdError when file.header.gameId contains traversal', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('../evil', 'autosave');
        await expect(repo.save(file)).rejects.toBeInstanceOf(InvalidSlotIdError);
    });

    it('save throws InvalidSlotIdError when file.header.slotId contains traversal', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', '../evil');
        await expect(repo.save(file)).rejects.toBeInstanceOf(InvalidSlotIdError);
    });

    it('save accepts a valid gameId and slotId', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'slot-1');
        await expect(repo.save(file)).resolves.toBeUndefined();
    });

    it('load accepts a valid slotId', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'slot-1');
        await repo.save(file);
        await expect(repo.load('tactics/slot-1')).resolves.toMatchObject(file);
    });

    it('slotId with underscore is accepted', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('my-game', 'save_slot');
        await repo.save(file);
        await expect(repo.load('my-game/save_slot')).resolves.toMatchObject(file);
    });
});

// ── Integrity checksum tests ─────────────────────────────────────────────────

describe('FileSaveRepository — integrity checksum', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('save attaches a checksum to the header', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave');

        await repo.save(file);

        const filePath = path.join(tmpDir, 'tactics', 'autosave.chimera');
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { header: { checksum?: unknown } };
        expect(typeof parsed.header.checksum).toBe('string');
        expect((parsed.header.checksum as string).length).toBe(64);
    });

    it('load succeeds when the checksum matches', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave');

        await repo.save(file);

        await expect(repo.load('tactics/autosave')).resolves.toMatchObject(file);
    });

    it('load throws SaveIntegrityError when the checkpoint is tampered', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave');

        await repo.save(file);

        // Tamper: read the file, mutate the checkpoint, write it back
        const filePath = path.join(tmpDir, 'tactics', 'autosave.chimera');
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as {
            header: Record<string, unknown>;
            checkpoint: Record<string, unknown>;
            deltaActions: unknown[];
            pendingCommitments: Record<string, unknown>;
        };
        parsed.checkpoint['tick'] = 99999;
        await fs.writeFile(filePath, JSON.stringify(parsed, null, 2));

        await expect(repo.load('tactics/autosave')).rejects.toBeInstanceOf(SaveIntegrityError);
    });

    it('load throws SaveIntegrityError when deltaActions are tampered', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave');

        await repo.save(file);

        const filePath = path.join(tmpDir, 'tactics', 'autosave.chimera');
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as {
            header: Record<string, unknown>;
            checkpoint: Record<string, unknown>;
            deltaActions: unknown[];
            pendingCommitments: Record<string, unknown>;
        };
        // Inject a fake action
        parsed.deltaActions.push({ type: 'evil:action', payload: {} });
        await fs.writeFile(filePath, JSON.stringify(parsed, null, 2));

        await expect(repo.load('tactics/autosave')).rejects.toBeInstanceOf(SaveIntegrityError);
    });

    it('load succeeds for existing saves that have no checksum field (backwards-compatible)', async () => {
        const repo = makeRepo(tmpDir);
        const file = makeFile('tactics', 'autosave');

        // Write a save file WITHOUT a checksum field, simulating a legacy save
        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, 'autosave.chimera');
        const serializer = new JsonSaveSerializer();
        await fs.writeFile(filePath, await serializer.serialize(file));

        // Should load without throwing
        await expect(repo.load('tactics/autosave')).resolves.toMatchObject(file);
    });

    it('a v5 save with a valid stored checksum still verifies after the v5→v6 session backfill', async () => {
        const repo = makeRepo(tmpDir);

        // Build the exact on-disk v5 shape: no `session`, schemaVersion 5, and a
        // checksum computed over the v5 body. `session` stays out of the hash
        // entirely, so the digest matches whichever shape it is checked against.
        const current = makeFile('tactics', 'autosave');
        const widened = { ...current } as Record<string, unknown>;
        delete widened['session'];
        const checksum = await computeBodyChecksum(widened as unknown as SaveBody);
        widened['header'] = { ...current.header, schemaVersion: 5, checksum };

        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'autosave.chimera'), JSON.stringify(widened, null, 2));

        const loaded = await repo.load('tactics/autosave');

        expect(loaded.header.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(loaded.session).toBeDefined();
        expect(typeof loaded.session.matchId).toBe('string');
    });

    it('a v6 save with a valid stored checksum still verifies after the v6→v7 gameParams rename', async () => {
        const repo = makeRepo(tmpDir);

        // Build the exact on-disk v6 shape: `checkpoint.setup.matchSettings`,
        // schemaVersion 6, and a checksum computed over the v6 body. The rename
        // rewrites the checkpoint, which IS hashed — this only passes because
        // load() verifies the stored digest against the file AS STORED, never
        // against the object the migration chain returns.
        const v7 = makeFile('tactics', 'autosave');
        const legacyCheckpoint = {
            ...v7.checkpoint,
            setup: {
                matchSettings: { turnMode: 'commitment' },
                playerAttributes: {},
            },
        };
        const widened = {
            ...v7,
            checkpoint: legacyCheckpoint,
        } as unknown as Record<string, unknown>;
        const checksum = await computeBodyChecksum(widened as unknown as SaveBody);
        widened['header'] = { ...v7.header, schemaVersion: 6, checksum };

        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'autosave.chimera'), JSON.stringify(widened, null, 2));

        const loaded = await repo.load('tactics/autosave');

        expect(loaded.header.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(
            (loaded.checkpoint as unknown as Record<string, Record<string, unknown>>)['setup'],
        ).toEqual({ gameParams: { turnMode: 'commitment' }, playerAttributes: {} });
    });

    it('still rejects a v6 save whose stored checksum does not cover its checkpoint', async () => {
        const repo = makeRepo(tmpDir);

        // Same v6 shape, but the stored digest is computed over a DIFFERENT
        // checkpoint — verifying the body AS STORED must still catch it, so the
        // switch did not turn integrity checking off for legacy saves.
        const v7 = makeFile('tactics', 'autosave');
        const widened = {
            ...v7,
            checkpoint: {
                ...v7.checkpoint,
                setup: { matchSettings: { turnMode: 'commitment' }, playerAttributes: {} },
            },
        } as unknown as Record<string, unknown>;
        const foreignChecksum = await computeBodyChecksum(v7);
        widened['header'] = { ...v7.header, schemaVersion: 6, checksum: foreignChecksum };

        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'autosave.chimera'), JSON.stringify(widened, null, 2));

        await expect(repo.load('tactics/autosave')).rejects.toBeInstanceOf(SaveIntegrityError);
    });
});

// ── SaveSchemaTooNewError — propagated through load() (invariant #41) ─────────
//
// FileSaveRepository.load() calls SaveMigrator.migrate(); if the save file
// was written by a newer engine version, the migrator throws
// SaveSchemaTooNewError. Verify the repository propagates it rather than
// swallowing or re-wrapping it.

describe('FileSaveRepository — SaveSchemaTooNewError propagation', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('load throws SaveSchemaTooNewError when the save file has a future schema version', async () => {
        const repo = makeRepo(tmpDir);
        // Build a file whose schemaVersion is newer than this engine supports.
        const futureVersion = CURRENT_SCHEMA_VERSION + 1;
        const file = {
            ...makeFile('tactics', 'future-save'),
            header: { ...makeFile('tactics', 'future-save').header, schemaVersion: futureVersion },
        };

        // Bypass FileSaveRepository.save() (which attaches a checksum) and write
        // the file directly via the serializer so the raw future version is on disk.
        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, 'future-save.chimera');
        const serializer = new JsonSaveSerializer();
        await fs.writeFile(filePath, await serializer.serialize(file));

        await expect(repo.load('tactics/future-save')).rejects.toBeInstanceOf(
            SaveSchemaTooNewError,
        );
    });

    it('SaveSchemaTooNewError from load() carries fileVersion and engineVersion', async () => {
        const repo = makeRepo(tmpDir);
        const futureVersion = CURRENT_SCHEMA_VERSION + 3;
        const file = {
            ...makeFile('tactics', 'future-save'),
            header: { ...makeFile('tactics', 'future-save').header, schemaVersion: futureVersion },
        };

        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, 'future-save.chimera');
        const serializer = new JsonSaveSerializer();
        await fs.writeFile(filePath, await serializer.serialize(file));

        try {
            await repo.load('tactics/future-save');
            expect.fail('Expected SaveSchemaTooNewError');
        } catch (err) {
            expect(err).toBeInstanceOf(SaveSchemaTooNewError);
            const typed = err as SaveSchemaTooNewError;
            expect(typed.fileVersion).toBe(futureVersion);
            expect(typed.engineVersion).toBe(CURRENT_SCHEMA_VERSION);
        }
    });

    it('a future schema version wins over a mismatched checksum on the same file', async () => {
        const repo = makeRepo(tmpDir);

        // Both failure modes armed at once: a version this engine cannot read AND
        // a stored digest that does not cover the body. `load()` runs the migrator
        // before it verifies, so the version verdict is the one the caller sees —
        // "written by a newer engine", not "this file is corrupted". Hoisting the
        // checksum block above `migrate()` swaps the error and reds this case.
        const futureVersion = CURRENT_SCHEMA_VERSION + 1;
        const base = makeFile('tactics', 'future-save');
        const file = {
            ...base,
            header: {
                ...base.header,
                schemaVersion: futureVersion,
                checksum: 'f'.repeat(64),
            },
        };

        const dir = path.join(tmpDir, 'tactics');
        await fs.mkdir(dir, { recursive: true });
        const serializer = new JsonSaveSerializer();
        await fs.writeFile(path.join(dir, 'future-save.chimera'), await serializer.serialize(file));

        await expect(repo.load('tactics/future-save')).rejects.toBeInstanceOf(
            SaveSchemaTooNewError,
        );
    });
});
