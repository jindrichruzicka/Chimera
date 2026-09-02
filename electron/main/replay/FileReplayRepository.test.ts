/**
 * electron/main/replay/FileReplayRepository.test.ts
 *
 * Integration tests for FileReplayRepository (§4.28, invariants #23/#41).
 * Tests written first (RED before implementation).
 *
 * Uses a unique temp directory per test so suites never share state. Runs the
 * shared ReplayRepository contract suite to guarantee parity with
 * InMemoryReplayRepository, plus atomic-write and path-traversal checks.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
    JsonReplaySerializer,
    ReplayNotFoundError,
} from '@chimera-engine/simulation/replay/index.js';
import type { ReplayFile, ReplaySerializer } from '@chimera-engine/simulation/replay/index.js';
import {
    makeReplayFile,
    runReplayRepositoryContractTests,
} from '@chimera-engine/simulation/replay/__test-support__/replayRepositoryContractTests.js';
import {
    FileReplayRepository,
    ReplayPathError,
    InvalidGameIdError,
} from './FileReplayRepository.js';
import { CompressedReplaySerializer } from './CompressedReplaySerializer.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'chimera-filereplayrepo-test-'));
}

function makeRepo(baseDir: string): FileReplayRepository {
    return new FileReplayRepository(new JsonReplaySerializer(), baseDir);
}

/** A serializer whose serialize always rejects — simulates a mid-write failure. */
class FailingReplaySerializer implements ReplaySerializer {
    serialize(): Promise<Buffer> {
        return Promise.reject(new Error('serialize boom'));
    }
    deserialize(): Promise<ReplayFile> {
        return Promise.reject(new Error('deserialize boom'));
    }
}

async function listDir(dir: string): Promise<string[]> {
    return fs.readdir(dir).catch(() => [] as string[]);
}

// ── Shared contract tests ────────────────────────────────────────────────────

const contractDirs: string[] = [];

runReplayRepositoryContractTests('FileReplayRepository', () => {
    const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'chimera-replay-contract-'));
    contractDirs.push(tmpBase);
    return makeRepo(tmpBase);
});

afterAll(() => {
    for (const dir of contractDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ── FileReplayRepository-specific integration tests ──────────────────────────

describe('FileReplayRepository — integration', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('list returns [] when the gameId subdirectory does not exist', async () => {
        const repo = makeRepo(tmpDir);

        expect(await repo.list('tactics')).toStrictEqual([]);
    });

    it('save writes a .chimera-replay file under <baseDir>/<gameId> and returns its path', async () => {
        const repo = makeRepo(tmpDir);

        const savedPath = await repo.save(makeReplayFile('tactics'));

        expect(savedPath.startsWith(path.join(tmpDir, 'tactics'))).toBe(true);
        expect(savedPath.endsWith('.chimera-replay')).toBe(true);
        await expect(fs.access(savedPath)).resolves.toBeUndefined();
    });

    it('atomic write: a finalised save leaves exactly one .chimera-replay and no .tmp', async () => {
        const repo = makeRepo(tmpDir);

        await repo.save(makeReplayFile('tactics'));
        const entries = await listDir(path.join(tmpDir, 'tactics'));

        expect(entries.filter((n) => n.endsWith('.chimera-replay'))).toHaveLength(1);
        expect(entries.filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
    });

    it('atomic write: a mid-write failure leaves no .chimera-replay file', async () => {
        const repo = new FileReplayRepository(new FailingReplaySerializer(), tmpDir);

        await expect(repo.save(makeReplayFile('tactics'))).rejects.toThrow();

        const entries = await listDir(path.join(tmpDir, 'tactics'));
        expect(entries.filter((n) => n.endsWith('.chimera-replay'))).toHaveLength(0);
    });

    it('list ignores stray .tmp artefacts left by an interrupted write', async () => {
        const repo = makeRepo(tmpDir);
        const savedPath = await repo.save(makeReplayFile('tactics'));
        // Simulate a crashed write: a leftover .tmp next to the valid file.
        await fs.writeFile(`${savedPath}.tmp`, 'partial');

        const listed = await repo.list('tactics');

        expect(listed).toStrictEqual([savedPath]);
    });

    it('delete rejects a path that escapes the replay directory', async () => {
        const repo = makeRepo(tmpDir);
        const escaping = path.join(tmpDir, '..', 'escape.chimera-replay');

        await expect(repo.delete(escaping)).rejects.toBeInstanceOf(ReplayPathError);
    });

    it('load rejects a path that escapes the replay directory', async () => {
        const repo = makeRepo(tmpDir);
        const escaping = path.join(tmpDir, '..', '..', 'etc', 'passwd');

        await expect(repo.load(escaping)).rejects.toBeInstanceOf(ReplayPathError);
    });

    it('load throws ReplayNotFoundError for a missing file inside the base', async () => {
        const repo = makeRepo(tmpDir);
        const missing = path.join(tmpDir, 'tactics', 'missing.chimera-replay');

        await expect(repo.load(missing)).rejects.toBeInstanceOf(ReplayNotFoundError);
    });

    it('save rejects an invalid gameId (path-traversal guard)', async () => {
        const repo = makeRepo(tmpDir);
        const bad = { ...makeReplayFile('tactics'), gameId: '../evil' };

        await expect(repo.save(bad)).rejects.toBeInstanceOf(InvalidGameIdError);
    });
});

// ── Wired encoding (§4.28) ───────────────────────────────────────────────────

describe('FileReplayRepository — with the serializer main() wires', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await makeTmpDir();
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    /** The repository as `main()` constructs it. */
    function makeWiredRepo(baseDir: string): FileReplayRepository {
        return new FileReplayRepository(new CompressedReplaySerializer(), baseDir);
    }

    it('writes gzip bytes to disk and round-trips them back', async () => {
        const repo = makeWiredRepo(tmpDir);
        const file = makeReplayFile('tactics');

        const savedPath = await repo.save(file);

        // Read as raw bytes, not through the serializer: the point is the
        // ON-DISK encoding, which a round trip alone cannot see.
        const bytes = await fs.readFile(savedPath);
        expect([bytes[0], bytes[1]]).toStrictEqual([0x1f, 0x8b]);
        expect(await repo.load(savedPath)).toStrictEqual(file);
    });

    it('keeps the .chimera-replay extension, so listings still find it', async () => {
        const repo = makeWiredRepo(tmpDir);

        const savedPath = await repo.save(makeReplayFile('tactics'));

        expect(savedPath.endsWith('.chimera-replay')).toBe(true);
        expect(await repo.list('tactics')).toStrictEqual([savedPath]);
    });

    it('loads and lists a replay left on disk by the uncompressed serializer', async () => {
        const legacy = new FileReplayRepository(new JsonReplaySerializer(), tmpDir);
        const file = makeReplayFile('tactics');
        const legacyPath = await legacy.save(file);

        // Same directory, same extension — the wired repository has to read what
        // the previous one wrote, and the listing has no per-file tolerance, so
        // one unreadable replay would take the whole list rather than its own row.
        const repo = makeWiredRepo(tmpDir);
        expect(await repo.load(legacyPath)).toStrictEqual(file);
        expect((await repo.listItems('tactics')).map((e) => e.path)).toStrictEqual([legacyPath]);
    });

    it('lists a mixed directory of compressed and uncompressed replays', async () => {
        const legacyPath = await new FileReplayRepository(new JsonReplaySerializer(), tmpDir).save(
            makeReplayFile('tactics'),
        );
        const repo = makeWiredRepo(tmpDir);
        const compressedPath = await repo.save(makeReplayFile('tactics'));

        expect((await repo.listItems('tactics')).map((e) => e.path).sort()).toStrictEqual(
            [legacyPath, compressedPath].sort(),
        );
    });
});
