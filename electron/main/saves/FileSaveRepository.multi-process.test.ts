/**
 * electron/main/saves/FileSaveRepository.multi-process.test.ts
 *
 * Drives two PROCESSES writing the same slot in one `userData` (§4.11,
 * invariant #23).
 *
 * The per-write temp name that removed the two-writers-one-slot race inside a
 * process was a module-level counter, and module state starts over in every
 * process: two instances sharing a `userData` both opened
 * `<slot>.chimera.1.tmp` for their first save, wrote it over each other, and
 * the second rename failed with `ENOENT` and rejected its caller's save — the
 * exact failure the per-write name was introduced to remove. Nothing refuses a
 * second instance: no production call requests a single-instance lock.
 *
 * A second process is modelled by re-importing the module under a different
 * `process.pid`: `vi.resetModules()` gives the fresh module state a new
 * process has, and the pid is what tells the two apart. That works because the
 * repository reads `process.pid` once, when the module loads.
 *
 * Tests written FIRST (red); implementation in `FileSaveRepository.ts`.
 *
 * Invariants verified:
 *   #23 — save() writes to .tmp and renames atomically, for both processes.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { SaveFile, SaveSerializer } from '@chimera-engine/simulation/persistence/index.js';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
} from '@chimera-engine/simulation/persistence/index.js';
import { makeFile } from '@chimera-engine/simulation/persistence/__test-support__/saveRepositoryContractTests.js';
import type { FileSaveRepository } from './FileSaveRepository.js';

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
 * A serializer that parks inside `save()` — after the temp file is open, before
 * the rename. Holding both writes in that window is what lets the test read
 * the two temp paths off disk at the same moment.
 */
class ParkedSerializer implements SaveSerializer {
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

const REAL_PID = process.pid;

/** `process.pid` is a configurable data property, so a test can stand in for it. */
function setPid(pid: number): void {
    Object.defineProperty(process, 'pid', {
        value: pid,
        writable: false,
        enumerable: true,
        configurable: true,
    });
}

/**
 * Load a fresh copy of the repository module under `pid` — a stand-in for a
 * second instance: its own module state, its own process identity.
 */
async function loadRepositoryAsProcess(pid: number): Promise<typeof FileSaveRepository> {
    vi.resetModules();
    setPid(pid);
    const mod = await import('./FileSaveRepository.js');
    return mod.FileSaveRepository;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FileSaveRepository — two instances sharing one userData', () => {
    let baseDir: string;

    beforeEach(async () => {
        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-save-two-instances-test-'));
    });

    afterEach(async () => {
        setPid(REAL_PID);
        vi.resetModules();
        await fs.rm(baseDir, { recursive: true, force: true });
    });

    it('gives each process its own temp path for the first save of one slot', async () => {
        const dir = path.join(baseDir, 'tactics');

        const enteredA = deferred<void>();
        const releaseA = deferred<void>();
        const RepositoryA = await loadRepositoryAsProcess(4242);
        const repoA = new RepositoryA(
            new ParkedSerializer(async () => {
                enteredA.resolve(undefined);
                await releaseA.promise;
            }),
            createDefaultMigrator(),
            baseDir,
        );

        const enteredB = deferred<void>();
        const releaseB = deferred<void>();
        const RepositoryB = await loadRepositoryAsProcess(9999);
        const repoB = new RepositoryB(
            new ParkedSerializer(async () => {
                enteredB.resolve(undefined);
                await releaseB.promise;
            }),
            createDefaultMigrator(),
            baseDir,
        );

        // Both are the FIRST save of their process, which is when the counters
        // agree and the collision happens.
        const pendingA = repoA.save(makeFile('tactics', 'autosave'));
        await enteredA.promise;
        const pendingB = repoB.save(makeFile('tactics', 'autosave'));
        await enteredB.promise;

        // Both temp files are open and unrenamed right now. The names read off
        // disk, not a count of them: two distinct names would also come out of
        // a discriminator that tells the writes apart by something OTHER than
        // the process — and the process id in that position is what the reaper
        // and the docs describe. Released in `finally`, so a failed assertion
        // does not strand the two parked writes.
        try {
            const temps = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
            expect(temps.sort()).toEqual([
                'autosave.chimera.4242.1.tmp',
                'autosave.chimera.9999.1.tmp',
            ]);
        } finally {
            releaseA.resolve(undefined);
            releaseB.resolve(undefined);
        }

        // Neither save is rejected, and the file left behind is whole rather
        // than two writes interleaved into one temp.
        await expect(pendingA).resolves.toBeUndefined();
        await expect(pendingB).resolves.toBeUndefined();
        await expect(repoA.load('tactics/autosave')).resolves.toBeDefined();
        expect((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
    });

    it('still separates two writes made by one process', async () => {
        // The pid alone would not: within a process it is the counter that
        // tells one in-flight write from the next.
        const dir = path.join(baseDir, 'tactics');

        const entered: Deferred<void>[] = [deferred<void>(), deferred<void>()];
        const release = deferred<void>();
        let call = 0;
        const Repository = await loadRepositoryAsProcess(4242);
        const repo = new Repository(
            new ParkedSerializer(async () => {
                // Two saves, so a third `serialize()` is the test's premise
                // breaking rather than something to park silently.
                const gate = entered[call++];
                expect(gate).toBeDefined();
                gate?.resolve(undefined);
                await release.promise;
            }),
            createDefaultMigrator(),
            baseDir,
        );

        const pending = [
            repo.save(makeFile('tactics', 'autosave')),
            repo.save(makeFile('tactics', 'autosave')),
        ];
        await Promise.all(entered.map((d) => d.promise));

        // One process id across both, and the counter is what moves.
        try {
            const temps = (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
            expect(temps.sort()).toEqual([
                'autosave.chimera.4242.1.tmp',
                'autosave.chimera.4242.2.tmp',
            ]);
        } finally {
            release.resolve(undefined);
        }

        await expect(Promise.all(pending)).resolves.toEqual([undefined, undefined]);
    });
});
