/**
 * electron/main/logging/crash-reporter.reap.test.ts
 *
 * Integration tests for `reapOrphanCrashDumpTempFiles()` — the sweep that
 * removes the temp file a crash dump write leaves when it is interrupted
 * between the write and the rename (§4.27).
 *
 * These cases pin what the crash reporter calls a dump's temp file, and that a
 * dump temp file younger than the window survives the pass that takes an aged
 * one. The sweep's other cases are in `orphan-temp-reap.test.ts`.
 *
 * Tests written FIRST (red); implementation in `crash-reporter.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from './logger.js';
import { makeRendererGoneHandler, reapOrphanCrashDumpTempFiles } from './crash-reporter.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(function (this: Logger) {
            return this;
        }),
    };
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

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Absolute ages either side of the one-hour window — see `orphan-temp-reap.test.ts`. */
const AGED = 6 * HOUR_MS;
const FRESH = 30 * MINUTE_MS;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('reapOrphanCrashDumpTempFiles()', () => {
    let root: string;
    let crashesDir: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-crash-reap-test-'));
        crashesDir = path.join(root, 'crashes');
    });

    afterEach(async () => {
        vi.useRealTimers();
        await fs.rm(root, { recursive: true, force: true });
    });

    it('takes the temp file an interrupted dump write leaves behind', async () => {
        // A directory already sitting at the dump's final path makes the rename
        // fail after the temp file is written and synced — the state on disk a
        // process killed between the two leaves. The clock is held so that the
        // final path is known before the write. The name is read back off disk
        // rather than planted, so this pins what the writer emits.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.UTC(2026, 0, 1));
        const finalPath = path.join(crashesDir, 'crash-2026-01-01T00-00-00-000Z.json');
        await fs.mkdir(finalPath, { recursive: true });
        const logger = makeLogger();

        makeRendererGoneHandler({ logger, crashesDir, reloadRenderer: vi.fn() })(
            {},
            { reason: 'crashed', exitCode: 9 },
        );
        vi.useRealTimers();

        expect(logger.error).toHaveBeenCalledWith(
            'failed to write renderer crash dump',
            expect.any(Error),
            expect.anything(),
        );
        expect((await fs.readdir(crashesDir)).sort()).toStrictEqual([
            'crash-2026-01-01T00-00-00-000Z.json',
            'crash-2026-01-01T00-00-00-000Z.json.tmp',
        ]);
        const temp = `${finalPath}.tmp`;
        await ageFile(temp, AGED);

        await expect(reapOrphanCrashDumpTempFiles(crashesDir)).resolves.toBe(1);
        expect(await exists(temp)).toBe(false);
    });

    it('leaves a dump temp file younger than the window, taking an aged one in the same pass', async () => {
        // The app requests no single-instance lock, so a second instance
        // sharing this `userData` may be writing a dump right now. Its temp
        // file is younger than the window; the abandoned one beside it is not.
        const inFlight = await plant(crashesDir, 'crash-2026-01-01T00-30-00-000Z.json.tmp', FRESH);
        const abandoned = await plant(crashesDir, 'crash-2026-01-01T00-00-00-000Z.json.tmp', AGED);

        await expect(reapOrphanCrashDumpTempFiles(crashesDir)).resolves.toBe(1);
        expect(await exists(inFlight)).toBe(true);
        expect(await exists(abandoned)).toBe(false);
    });

    it('leaves every aged name that is not a dump temp file', async () => {
        const names = [
            // A finished dump — what the directory is for.
            'crash-2026-01-01T00-00-00-000Z.json',
            // Contains the temp shape without ending in it.
            'crash-2026-01-01T00-00-00-000Z.json.tmp.bak',
            // The dump temp suffix on a name the crash reporter does not write.
            'notes.json.tmp',
            // A temp file, but not a dump's.
            'crash-2026-01-01T00-00-00-000Z.log.tmp',
            // One character off the dump temp shape: the `-` after `crash`.
            'crash_2026-01-01T00-00-00-000Z.json.tmp',
            // One character off the dump temp shape: the `.` before `json`.
            'crash-2026-01-01T00-00-00-000Z_json.tmp',
            // Contains the whole temp shape without starting with it.
            'copy-of-crash-2026-01-01T00-00-00-000Z.json.tmp',
        ];
        for (const name of names) await plant(crashesDir, name, AGED);

        await expect(reapOrphanCrashDumpTempFiles(crashesDir)).resolves.toBe(0);
        expect((await fs.readdir(crashesDir)).sort()).toStrictEqual([...names].sort());
    });

    it('resolves 0 before any dump has created the directory', async () => {
        // The dump write creates `crashes/` on first use, so an install that
        // has never crashed has nothing there to read. That is not a failed
        // reap, whose warning would otherwise be logged on every start.
        await expect(reapOrphanCrashDumpTempFiles(crashesDir)).resolves.toBe(0);
    });
});
