/**
 * electron/main/saves/FileSaveRepository.reap.test.ts
 *
 * Integration tests for `FileSaveRepository.reapOrphanTempFiles()` — the sweep
 * that removes temp artefacts left by a process killed between a save's write
 * and its rename (§4.11, invariant #23).
 *
 * The temp path is per WRITE, so no later write ever reopens one: without a
 * reap, every crash mid-save leaves a full-size file that `list()` cannot show
 * and `delete()` cannot remove. The reap decides on AGE, because it cannot see
 * whether a temp belongs to a write in flight in a SECOND instance sharing the
 * same `userData` — so these tests drive both sides of that decision: an aged
 * artefact must go, and a write still in flight must survive the same pass.
 *
 * Tests written FIRST (red); implementation in `FileSaveRepository.ts`.
 *
 * Invariants verified:
 *   #23 — save() still writes to .tmp and renames atomically; the reap never
 *         takes a temp file out from under the write that owns it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { SaveFile, SaveSerializer } from '@chimera-engine/simulation/persistence/index.js';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
} from '@chimera-engine/simulation/persistence/index.js';
import { makeFile } from '@chimera-engine/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import { FileSaveRepository, ORPHAN_TEMP_MAX_AGE_MS } from './FileSaveRepository.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/**
 * A `JsonSaveSerializer` with a hook that runs — and can block — inside
 * `save()`, at the point where the temp file exists on disk but the rename has
 * not happened. That is the exact window a crash leaves an artefact in.
 */
class HookedSerializer implements SaveSerializer {
    private readonly inner = new JsonSaveSerializer();

    constructor(private readonly onSerialize: () => Promise<void>) {}

    async serialize(file: SaveFile): Promise<string | Buffer> {
        await this.onSerialize();
        return this.inner.serialize(file);
    }

    deserialize(raw: string | Buffer): Promise<SaveFile> {
        return this.inner.deserialize(raw);
    }
}

/** Backdate a file's mtime by `ageMs`, so the reaper reads it as that old. */
async function ageFile(filePath: string, ageMs: number): Promise<void> {
    const seconds = (Date.now() - ageMs) / 1000;
    await fs.utimes(filePath, seconds, seconds);
}

async function exists(filePath: string): Promise<boolean> {
    return fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
}

/** Plant a temp artefact of the given name, aged by `ageMs`. */
async function plantTemp(dir: string, name: string, ageMs: number): Promise<string> {
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, 'partial-write-bytes');
    await ageFile(filePath, ageMs);
    return filePath;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Fixture ages are ABSOLUTE, not derived from `ORPHAN_TEMP_MAX_AGE_MS`.
 *
 * Deriving them would make every fixture scale with the constant, leaving its
 * magnitude unmeasured — a window shrunk to a minute would keep the whole suite
 * green while taking any write in flight for sixty seconds. Fixed durations
 * straddling one hour fail in both directions instead: shrink the window and
 * the fresh artefact is taken, widen it and the aged one survives.
 */
const AGED = 6 * HOUR_MS;
const FRESH = 30 * MINUTE_MS;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FileSaveRepository — reapOrphanTempFiles()', () => {
    let baseDir: string;

    beforeEach(async () => {
        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-save-reap-test-'));
    });

    afterEach(async () => {
        await fs.rm(baseDir, { recursive: true, force: true });
    });

    function makeRepo(serializer: SaveSerializer = new JsonSaveSerializer()): FileSaveRepository {
        return new FileSaveRepository(serializer, createDefaultMigrator(), baseDir);
    }

    it('sets the orphan window to one hour', () => {
        expect(ORPHAN_TEMP_MAX_AGE_MS).toBe(HOUR_MS);
    });

    it('reaps an artefact carrying the exact name save() gives its temp file', async () => {
        // No temp spelling is written down here. The name comes from a real
        // save(), read off disk at the moment the temp exists — so the
        // reaper's pattern is pinned to what the writer produces rather than
        // to a literal this test would have to keep in step.
        const dir = path.join(baseDir, 'tactics');
        let midWrite: string[] = [];
        const repo = makeRepo(
            new HookedSerializer(async () => {
                midWrite = await fs.readdir(dir);
            }),
        );

        await repo.save(makeFile('tactics', 'autosave'));

        const tempNames = midWrite.filter((name) => !name.endsWith('.chimera'));
        expect(tempNames).toHaveLength(1);

        const planted = await plantTemp(dir, tempNames[0]!, AGED);

        await expect(repo.reapOrphanTempFiles()).resolves.toBe(1);
        expect(await exists(planted)).toBe(false);
    });

    it('leaves an in-flight write untouched while reaping an aged artefact in the same pass', async () => {
        const dir = path.join(baseDir, 'tactics');
        const orphan = await plantTemp(dir, 'quicksave.chimera.99.tmp', AGED);

        const entered = deferred<void>();
        const release = deferred<void>();
        const repo = makeRepo(
            new HookedSerializer(async () => {
                entered.resolve(undefined);
                await release.promise;
            }),
        );

        const pending = repo.save(makeFile('tactics', 'autosave'));
        await entered.promise;

        // The in-flight write's temp file is on disk right now, and its mtime
        // is seconds old. Reaping must skip it and take the aged one.
        const reaped = await repo.reapOrphanTempFiles();

        release.resolve(undefined);
        await expect(pending).resolves.toBeUndefined();

        expect(reaped).toBe(1);
        expect(await exists(orphan)).toBe(false);
        await expect(repo.load('tactics/autosave')).resolves.toBeDefined();
    });

    it('leaves an artefact younger than the window in place', async () => {
        const dir = path.join(baseDir, 'tactics');
        const fresh = await plantTemp(dir, 'autosave.chimera.4.tmp', FRESH);

        await expect(makeRepo().reapOrphanTempFiles()).resolves.toBe(0);
        expect(await exists(fresh)).toBe(true);
    });

    it('reaps the older per-slot temp name as well as the per-write one', async () => {
        // An install upgrading from the per-slot scheme can be carrying
        // `<slot>.chimera.tmp`. It was self-healing then — the next write to
        // that slot truncated it — and is inert now, so the reap owns it too.
        const dir = path.join(baseDir, 'tactics');
        const legacy = await plantTemp(dir, 'autosave.chimera.tmp', AGED);
        const perWrite = await plantTemp(dir, 'autosave.chimera.12.tmp', AGED);

        await expect(makeRepo().reapOrphanTempFiles()).resolves.toBe(2);
        expect(await exists(legacy)).toBe(false);
        expect(await exists(perWrite)).toBe(false);
    });

    it('leaves aged save files and aged foreign files alone', async () => {
        const repo = makeRepo();
        await repo.save(makeFile('tactics', 'autosave'));

        const dir = path.join(baseDir, 'tactics');
        const save = path.join(dir, 'autosave.chimera');
        await ageFile(save, AGED);
        // A `.tmp` that is not this repository's: no `.chimera` before the
        // discriminator. Another writer's temp file is not the reaper's to take.
        const foreignTemp = await plantTemp(dir, 'thumbnails.tmp', AGED);
        const note = await plantTemp(dir, 'readme.txt', AGED);
        // The temp name has to END the file name. These two CONTAIN it — a
        // backup and a rename someone made by hand — and the reaper unlinks
        // what it matches, so matching a substring would destroy them.
        const backup = await plantTemp(dir, 'autosave.chimera.1.tmp.bak', AGED);
        const renamed = await plantTemp(dir, 'autosave.chimera.tmp.old', AGED);

        await expect(repo.reapOrphanTempFiles()).resolves.toBe(0);
        expect(await exists(save)).toBe(true);
        expect(await exists(foreignTemp)).toBe(true);
        expect(await exists(note)).toBe(true);
        expect(await exists(backup)).toBe(true);
        expect(await exists(renamed)).toBe(true);
        await expect(repo.load('tactics/autosave')).resolves.toBeDefined();
    });

    it('sweeps every game directory under the base, not just the first', async () => {
        const tactics = await plantTemp(
            path.join(baseDir, 'tactics'),
            'autosave.chimera.1.tmp',
            AGED,
        );
        const action = await plantTemp(path.join(baseDir, 'action'), 'slot-1.chimera.2.tmp', AGED);

        await expect(makeRepo().reapOrphanTempFiles()).resolves.toBe(2);
        expect(await exists(tactics)).toBe(false);
        expect(await exists(action)).toBe(false);
    });

    // chmod cannot stop root from unlinking, so the refusal below is not
    // reachable there. Skipped rather than silently vacuous.
    it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
        'leaves an unlink the OS refuses out of the count, and does not throw',
        async () => {
            // A read-only game directory is the reachable stand-in for every
            // reason an unlink can fail — a permission the user changed, a file
            // another reaper took first. The sweep reports what it actually
            // removed, so a refused unlink must not be counted, and must not end
            // the pass either: the aged artefact in the OTHER directory still
            // has to go.
            const locked = path.join(baseDir, 'tactics');
            const kept = await plantTemp(locked, 'autosave.chimera.1.tmp', AGED);
            const reachable = await plantTemp(
                path.join(baseDir, 'action'),
                'slot-1.chimera.1.tmp',
                AGED,
            );

            await fs.chmod(locked, 0o555);
            try {
                await expect(makeRepo().reapOrphanTempFiles()).resolves.toBe(1);
                expect(await exists(kept)).toBe(true);
                expect(await exists(reachable)).toBe(false);
            } finally {
                // Restore before the afterEach rm, which cannot remove a file
                // from a directory it may not write to.
                await fs.chmod(locked, 0o755);
            }
        },
    );

    it('resolves 0 when the saves directory does not exist yet', async () => {
        const repo = new FileSaveRepository(
            new JsonSaveSerializer(),
            createDefaultMigrator(),
            path.join(baseDir, 'never-created'),
        );

        await expect(repo.reapOrphanTempFiles()).resolves.toBe(0);
    });

    it('ignores a plain file sitting directly in the saves directory', async () => {
        // `.DS_Store` is the everyday case on macOS: readdir returns it beside
        // the game directories, and reading it as one throws ENOTDIR. The sweep
        // has to carry on past it to the directory that does hold an artefact.
        await fs.writeFile(path.join(baseDir, '.DS_Store'), 'finder');
        const orphan = await plantTemp(
            path.join(baseDir, 'tactics'),
            'autosave.chimera.1.tmp',
            AGED,
        );

        await expect(makeRepo().reapOrphanTempFiles()).resolves.toBe(1);
        expect(await exists(orphan)).toBe(false);
    });
});
