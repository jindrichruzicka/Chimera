/**
 * electron/main/orphan-temp-reap.test.ts
 *
 * Tests for `sweepOrphanTempFiles()` — the age-gated sweep a repository owes
 * once its temp file name is per write (§4.11, §4.28). Which names are temp
 * files is each repository's to say, and is pinned in that repository's own
 * `*.reap.test.ts`, beside a write in flight surviving the pass that takes an
 * aged artefact. These cases pin what the sweep does with the repository's
 * answer, and how `logOrphanTempReap()` reports a reap nothing awaits.
 *
 * Tests written FIRST (red); implementation in `orphan-temp-reap.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createLogger, createMemorySink } from './logging/logger.js';
import type { MemorySink } from './logging/logger.js';
import {
    logOrphanTempReap,
    ORPHAN_TEMP_MAX_AGE_MS,
    sweepOrphanTempFiles,
} from './orphan-temp-reap.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Backdate a file's mtime by `ageMs`, so the sweep reads it as that old. */
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

/** The repository's answer, as these cases give it. */
function isTemp(name: string): boolean {
    return name.endsWith('.tmp');
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

describe('sweepOrphanTempFiles()', () => {
    let baseDir: string;

    beforeEach(async () => {
        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-orphan-temp-reap-test-'));
    });

    afterEach(async () => {
        await fs.rm(baseDir, { recursive: true, force: true });
    });

    it('sets the orphan window to one hour', () => {
        expect(ORPHAN_TEMP_MAX_AGE_MS).toBe(HOUR_MS);
    });

    it('takes an aged name the repository calls a temp file, and no other', async () => {
        const dir = path.join(baseDir, 'tactics');
        const temp = await plant(dir, 'abandoned.tmp', AGED);
        const kept = await plant(dir, 'abandoned.keep', AGED);

        await expect(sweepOrphanTempFiles(baseDir, isTemp)).resolves.toBe(1);
        expect(await exists(temp)).toBe(false);
        expect(await exists(kept)).toBe(true);
    });

    // The comparison is inclusive, so the fixture sits ON the boundary: the
    // clock is held at a whole second, which makes an mtime of exactly
    // "now minus the window" representable to the millisecond.
    it('takes an artefact exactly as old as the window', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const now = Date.UTC(2026, 0, 1);
            vi.setSystemTime(now);
            const dir = path.join(baseDir, 'tactics');
            await fs.mkdir(dir, { recursive: true });
            const boundary = path.join(dir, 'boundary.tmp');
            await fs.writeFile(boundary, 'partial-write-bytes');
            const seconds = (now - ORPHAN_TEMP_MAX_AGE_MS) / 1000;
            await fs.utimes(boundary, seconds, seconds);

            await expect(sweepOrphanTempFiles(baseDir, isTemp)).resolves.toBe(1);
            expect(await exists(boundary)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves an artefact younger than the window in place', async () => {
        const fresh = await plant(path.join(baseDir, 'tactics'), 'in-flight.tmp', FRESH);

        await expect(sweepOrphanTempFiles(baseDir, isTemp)).resolves.toBe(0);
        expect(await exists(fresh)).toBe(true);
    });

    it('sweeps every game directory under the base, not just the first', async () => {
        const tactics = await plant(path.join(baseDir, 'tactics'), 'one.tmp', AGED);
        const action = await plant(path.join(baseDir, 'action'), 'two.tmp', AGED);

        await expect(sweepOrphanTempFiles(baseDir, isTemp)).resolves.toBe(2);
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
            const kept = await plant(locked, 'one.tmp', AGED);
            const reachable = await plant(path.join(baseDir, 'action'), 'two.tmp', AGED);

            await fs.chmod(locked, 0o555);
            try {
                await expect(sweepOrphanTempFiles(baseDir, isTemp)).resolves.toBe(1);
                expect(await exists(kept)).toBe(true);
                expect(await exists(reachable)).toBe(false);
            } finally {
                // Restore before the afterEach rm, which cannot remove a file
                // from a directory it may not write to.
                await fs.chmod(locked, 0o755);
            }
        },
    );

    it('resolves 0 when the base directory does not exist yet', async () => {
        await expect(
            sweepOrphanTempFiles(path.join(baseDir, 'never-created'), isTemp),
        ).resolves.toBe(0);
    });

    // Only a missing base is "nothing to sweep". Any other failure to read it
    // rejects, which is how a failed sweep reaches `logOrphanTempReap`'s
    // warning rather than passing for an empty one.
    it('rejects when the base cannot be read as a directory', async () => {
        const notADirectory = path.join(baseDir, 'replays');
        await fs.writeFile(notADirectory, 'a file where the root should be');

        await expect(sweepOrphanTempFiles(notADirectory, isTemp)).rejects.toMatchObject({
            code: 'ENOTDIR',
        });
    });

    it('ignores a plain file sitting directly in the base directory', async () => {
        // `.DS_Store` is the everyday case on macOS: readdir returns it beside
        // the game directories, and reading it as one throws ENOTDIR. The sweep
        // has to carry on past it to the directory that does hold an artefact.
        await fs.writeFile(path.join(baseDir, '.DS_Store'), 'finder');
        const orphan = await plant(path.join(baseDir, 'tactics'), 'one.tmp', AGED);

        await expect(sweepOrphanTempFiles(baseDir, isTemp)).resolves.toBe(1);
        expect(await exists(orphan)).toBe(false);
    });
});

describe('logOrphanTempReap()', () => {
    let sink: MemorySink;

    function logger(): ReturnType<typeof createLogger> {
        return createLogger({ source: { process: 'main', module: 'test' }, sink });
    }

    beforeEach(() => {
        sink = createMemorySink();
    });

    // One artefact is the everyday case — one crash, one orphan — and the
    // least a reap can take and still report.
    it.each([1, 3])('reports a reap that took %i', async (taken) => {
        await logOrphanTempReap(Promise.resolve(taken), logger(), {
            module: 'replays',
            files: 'replay',
        });

        expect(sink.entries).toHaveLength(1);
        expect(sink.entries[0]).toMatchObject({
            level: 'info',
            message: 'reaped orphaned replay temp files',
            context: expect.objectContaining({ module: 'replays', reaped: taken }) as unknown,
        });
    });

    it('reports nothing when a reap took nothing', async () => {
        await logOrphanTempReap(Promise.resolve(0), logger(), {
            module: 'replays',
            files: 'replay',
        });

        expect(sink.entries).toHaveLength(0);
    });

    // Nothing awaits the reap in `main()`, so a rejection that escaped here
    // would be an unhandled one. It resolves instead, with a warning naming
    // what failed — an `Error`'s message, or whatever else was thrown.
    it.each([
        { thrown: new Error('EACCES: permission denied'), reported: 'EACCES: permission denied' },
        { thrown: 'not an Error', reported: 'not an Error' },
    ])(
        'reports a failed reap as a warning and resolves: $reported',
        async ({ thrown, reported }) => {
            await expect(
                // @chimera-review: rejecting with a non-Error IS one of the cases under test.
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                logOrphanTempReap(Promise.reject(thrown), logger(), {
                    module: 'perspective-replays',
                    files: 'perspective replay',
                }),
            ).resolves.toBeUndefined();

            expect(sink.entries).toHaveLength(1);
            expect(sink.entries[0]).toMatchObject({
                level: 'warn',
                message: 'failed to reap orphaned perspective replay temp files',
                context: expect.objectContaining({
                    module: 'perspective-replays',
                    error: reported,
                }) as unknown,
            });
        },
    );
});
