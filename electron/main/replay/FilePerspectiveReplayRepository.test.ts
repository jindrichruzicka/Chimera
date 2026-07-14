/**
 * electron/main/replay/FilePerspectiveReplayRepository.test.ts
 *
 * Integration tests for FilePerspectiveReplayRepository (§4.28, ADR F44b,
 * invariants #23/#41/#67/#98). Tests written first (RED before implementation).
 *
 * Uses a unique temp directory per test so suites never share state. Runs the
 * shared PerspectiveReplayRepository contract suite to guarantee parity with
 * InMemoryPerspectiveReplayRepository, plus atomic-write, path-traversal,
 * disjoint-root, and injected-logger checks.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ReplayNotFoundError } from '@chimera-engine/simulation/replay/index.js';
import type {
    PerspectiveReplayFile,
    PerspectiveReplaySerializer,
} from '@chimera-engine/simulation/replay/index.js';
import {
    makePerspectiveReplayFile,
    runPerspectiveReplayRepositoryContractTests,
} from '@chimera-engine/simulation/replay/__test-support__/perspectiveReplayRepositoryContractTests.js';
import { CompressedPerspectiveReplaySerializer } from './CompressedReplaySerializer.js';
import { ReplayPathError, InvalidGameIdError } from './FileReplayRepository.js';
import { FilePerspectiveReplayRepository } from './FilePerspectiveReplayRepository.js';
import { createLogger, createMemorySink } from '../logging/logger.js';
import type { MemorySink } from '../logging/logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'chimera-fileperspectivereplayrepo-test-'));
}

function makeLogger(): { logger: ReturnType<typeof createLogger>; sink: MemorySink } {
    const sink = createMemorySink();
    return { logger: createLogger({ source: { process: 'main', module: 'test' }, sink }), sink };
}

function makeRepo(baseDir: string, sink?: MemorySink): FilePerspectiveReplayRepository {
    const logger = createLogger({
        source: { process: 'main', module: 'test' },
        sink: sink ?? createMemorySink(),
    });
    return new FilePerspectiveReplayRepository(
        new CompressedPerspectiveReplaySerializer(),
        baseDir,
        logger,
    );
}

/** A serializer whose serialize always rejects — simulates a mid-write failure. */
class FailingPerspectiveReplaySerializer implements PerspectiveReplaySerializer {
    serialize(): Promise<Buffer> {
        return Promise.reject(new Error('serialize boom'));
    }
    deserialize(): Promise<PerspectiveReplayFile> {
        return Promise.reject(new Error('deserialize boom'));
    }
}

async function listDir(dir: string): Promise<string[]> {
    return fs.readdir(dir).catch(() => [] as string[]);
}

const FILE_EXT = '.chimera-perspective-replay';

// ── Shared contract tests ────────────────────────────────────────────────────

const contractDirs: string[] = [];

runPerspectiveReplayRepositoryContractTests('FilePerspectiveReplayRepository', () => {
    const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'chimera-perspective-contract-'));
    contractDirs.push(tmpBase);
    return makeRepo(tmpBase);
});

afterAll(() => {
    for (const dir of contractDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ── FilePerspectiveReplayRepository-specific integration tests ───────────────

describe('FilePerspectiveReplayRepository — integration', () => {
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

    it('save writes under <baseDir>/<gameId> with the perspective extension', async () => {
        const repo = makeRepo(tmpDir);

        const savedPath = await repo.save(makePerspectiveReplayFile('tactics'));

        expect(savedPath.startsWith(path.join(tmpDir, 'tactics'))).toBe(true);
        expect(savedPath.endsWith(FILE_EXT)).toBe(true);
        await expect(fs.access(savedPath)).resolves.toBeUndefined();
    });

    it('atomic write: a finalised save leaves exactly one file and no .tmp', async () => {
        const repo = makeRepo(tmpDir);

        await repo.save(makePerspectiveReplayFile('tactics'));
        const entries = await listDir(path.join(tmpDir, 'tactics'));

        expect(entries.filter((n) => n.endsWith(FILE_EXT))).toHaveLength(1);
        expect(entries.filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
    });

    it('atomic write: a mid-write failure leaves no perspective-replay file', async () => {
        const { logger } = makeLogger();
        const repo = new FilePerspectiveReplayRepository(
            new FailingPerspectiveReplaySerializer(),
            tmpDir,
            logger,
        );

        await expect(repo.save(makePerspectiveReplayFile('tactics'))).rejects.toThrow();

        const entries = await listDir(path.join(tmpDir, 'tactics'));
        expect(entries.filter((n) => n.endsWith(FILE_EXT))).toHaveLength(0);
    });

    it('list ignores stray .tmp artefacts left by an interrupted write', async () => {
        const repo = makeRepo(tmpDir);
        const savedPath = await repo.save(makePerspectiveReplayFile('tactics'));
        await fs.writeFile(`${savedPath}.tmp`, 'partial');

        const listed = await repo.list('tactics');

        expect(listed).toStrictEqual([{ path: savedPath }]);
    });

    it('delete rejects a path that escapes the perspective directory', async () => {
        const repo = makeRepo(tmpDir);
        const escaping = path.join(tmpDir, '..', 'escape.chimera-perspective-replay');

        await expect(repo.delete(escaping)).rejects.toBeInstanceOf(ReplayPathError);
    });

    it('load rejects a path that escapes the perspective directory', async () => {
        const repo = makeRepo(tmpDir);
        const escaping = path.join(tmpDir, '..', '..', 'etc', 'passwd');

        await expect(repo.load(escaping)).rejects.toBeInstanceOf(ReplayPathError);
    });

    it('load throws ReplayNotFoundError for a missing file inside the base', async () => {
        const repo = makeRepo(tmpDir);
        const missing = path.join(tmpDir, 'tactics', `missing${FILE_EXT}`);

        await expect(repo.load(missing)).rejects.toBeInstanceOf(ReplayNotFoundError);
    });

    it('save rejects an invalid gameId (path-traversal guard)', async () => {
        const repo = makeRepo(tmpDir);
        const bad = { ...makePerspectiveReplayFile('tactics'), gameId: '../evil' };

        await expect(repo.save(bad)).rejects.toBeInstanceOf(InvalidGameIdError);
    });

    it('stores under its own perspective root, disjoint from the deterministic replays root', async () => {
        const root = tmpDir;
        const perspectiveBase = path.join(root, 'perspective-replays');
        const repo = makeRepo(perspectiveBase);

        const savedPath = await repo.save(makePerspectiveReplayFile('tactics'));

        expect(savedPath.startsWith(perspectiveBase)).toBe(true);
        // Nothing was written to a sibling deterministic replays directory.
        expect(await listDir(path.join(root, 'replays'))).toStrictEqual([]);
    });

    it('emits a debug log under the file-perspective-replay-repository module', async () => {
        const sink = createMemorySink();
        const repo = makeRepo(tmpDir, sink);

        await repo.save(makePerspectiveReplayFile('tactics'));

        const debugEntries = sink.entries.filter(
            (e) => e.level === 'debug' && e.source.module === 'file-perspective-replay-repository',
        );
        expect(debugEntries.length).toBeGreaterThan(0);
    });
});
