/**
 * electron/main/replay/FilePerspectiveReplayRepository.reap.test.ts
 *
 * Integration tests for `FilePerspectiveReplayRepository.reapOrphanTempFiles()`
 * — the sweep that removes temp artefacts left by a process killed between a
 * perspective replay's write and its rename (§4.28).
 *
 * `save()` names every replay with a fresh UUID, so its temp path is per write
 * and no later write ever reopens one. These cases pin what this repository
 * calls a temp file, and that a write still in flight survives the pass that
 * takes an aged artefact. The sweep's other cases are in
 * `orphan-temp-reap.test.ts`.
 *
 * Tests written FIRST (red); implementation in
 * `FilePerspectiveReplayRepository.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type {
    PerspectiveReplayFile,
    PerspectiveReplaySerializer,
} from '@chimera-engine/simulation/replay/index.js';
import { makePerspectiveReplayFile } from '@chimera-engine/simulation/replay/__test-support__/perspectiveReplayRepositoryContractTests.js';
import { CompressedPerspectiveReplaySerializer } from './CompressedReplaySerializer.js';
import { FilePerspectiveReplayRepository } from './FilePerspectiveReplayRepository.js';
import { createLogger, createMemorySink } from '../logging/logger.js';

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
 * The serializer `main()` wires, with a hook that runs — and can block —
 * inside `save()`, at the point where the temp file exists on disk but the
 * rename has not happened. That is the exact window a crash leaves an
 * artefact in.
 */
class HookedSerializer implements PerspectiveReplaySerializer {
    private readonly inner = new CompressedPerspectiveReplaySerializer();

    constructor(private readonly onSerialize: () => Promise<void>) {}

    async serialize(file: PerspectiveReplayFile): Promise<string | Buffer> {
        await this.onSerialize();
        return this.inner.serialize(file);
    }

    deserialize(raw: string | Buffer): Promise<PerspectiveReplayFile> {
        return this.inner.deserialize(raw);
    }
}

function makeRepo(
    baseDir: string,
    serializer: PerspectiveReplaySerializer = new CompressedPerspectiveReplaySerializer(),
): FilePerspectiveReplayRepository {
    const logger = createLogger({
        source: { process: 'main', module: 'test' },
        sink: createMemorySink(),
    });
    return new FilePerspectiveReplayRepository(serializer, baseDir, logger);
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

/** Plant a file of the given name, aged by `ageMs`. */
async function plant(dir: string, name: string, ageMs: number): Promise<string> {
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, 'partial-write-bytes');
    await ageFile(filePath, ageMs);
    return filePath;
}

/**
 * Absolute ages straddling the sweep's one-hour window, never derived from it:
 * a write in flight for half an hour must survive, an artefact six hours old
 * must go.
 */
const AGED = 6 * 60 * 60 * 1000;
const IN_FLIGHT = 30 * 60 * 1000;

const ORPHAN_NAME = '0b5e8f7a-3c1d-4e2f-9a6b-7c8d9e0f1a2b.chimera-perspective-replay.tmp';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FilePerspectiveReplayRepository — reapOrphanTempFiles()', () => {
    let baseDir: string;

    beforeEach(async () => {
        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-perspective-reap-test-'));
    });

    afterEach(async () => {
        await fs.rm(baseDir, { recursive: true, force: true });
    });

    it('reaps an artefact carrying the exact name save() gives its temp file', async () => {
        // No temp spelling is written down here. The name comes from a real
        // save(), read off disk at the moment the temp exists — so the
        // reaper's pattern is pinned to what the writer produces rather than
        // to a literal this test would have to keep in step.
        const dir = path.join(baseDir, 'tactics');
        let midWrite: string[] = [];
        const repo = makeRepo(
            baseDir,
            new HookedSerializer(async () => {
                midWrite = await fs.readdir(dir);
            }),
        );

        await repo.save(makePerspectiveReplayFile('tactics'));

        expect(midWrite).toHaveLength(1);
        const planted = await plant(dir, midWrite[0]!, AGED);

        await expect(repo.reapOrphanTempFiles()).resolves.toBe(1);
        expect(await exists(planted)).toBe(false);
    });

    it('leaves an in-flight write untouched while reaping an aged artefact in the same pass', async () => {
        const dir = path.join(baseDir, 'tactics');
        const orphan = await plant(dir, ORPHAN_NAME, AGED);

        const entered = deferred<void>();
        const release = deferred<void>();
        const repo = makeRepo(
            baseDir,
            new HookedSerializer(async () => {
                entered.resolve(undefined);
                await release.promise;
            }),
        );

        const pending = repo.save(makePerspectiveReplayFile('tactics'));
        await entered.promise;

        // The write's temp file is on disk now. Backdated half an hour it is
        // still inside the window — and a window shrunk below that would take
        // it out from under the rename, which then rejects the save. Released
        // in `finally`, so a reap that throws does not strand the write's open
        // file handle.
        const inFlight = (await fs.readdir(dir)).filter((name) => name !== ORPHAN_NAME);
        expect(inFlight).toHaveLength(1);
        await ageFile(path.join(dir, inFlight[0]!), IN_FLIGHT);

        let reaped: number;
        try {
            reaped = await repo.reapOrphanTempFiles();
        } finally {
            release.resolve(undefined);
        }
        const saved = await pending;

        expect(reaped).toBe(1);
        expect(await exists(orphan)).toBe(false);
        await expect(repo.list('tactics')).resolves.toStrictEqual([{ path: saved }]);
    });

    it('leaves aged replays, foreign temp files and names that only contain the temp shape alone', async () => {
        const repo = makeRepo(baseDir);
        const saved = await repo.save(makePerspectiveReplayFile('tactics'));
        await ageFile(saved, AGED);

        const dir = path.join(baseDir, 'tactics');
        // A `.tmp` that is not this repository's: no
        // `.chimera-perspective-replay` before it. Another writer's temp file
        // is not the reaper's to take.
        const foreignTemp = await plant(dir, 'thumbnails.tmp', AGED);
        // The temp name has to END the file name. This one CONTAINS it — a
        // backup someone made by hand — and the reaper unlinks what it
        // matches, so matching a substring would destroy it.
        const backup = await plant(dir, `${ORPHAN_NAME}.bak`, AGED);

        await expect(repo.reapOrphanTempFiles()).resolves.toBe(0);
        expect(await exists(foreignTemp)).toBe(true);
        expect(await exists(backup)).toBe(true);
        await expect(repo.list('tactics')).resolves.toStrictEqual([{ path: saved }]);
    });
});
