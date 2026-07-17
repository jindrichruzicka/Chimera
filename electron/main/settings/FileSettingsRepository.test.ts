/**
 * electron/main/FileSettingsRepository.test.ts
 *
 * Integration tests for FileSettingsRepository.
 * Runs the shared SettingsRepository contract test suite to guarantee
 * interface parity with InMemorySettingsRepository.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemorySettingsRepository } from '@chimera-engine/simulation/settings/index.js';
import type { SettingsRepository } from '@chimera-engine/simulation/settings/index.js';
import { FileSettingsRepository, InvalidGameIdError } from './FileSettingsRepository.js';

// ── Contract tests ────────────────────────────────────────────────────────────

/**
 * Shared contract test suite — every SettingsRepository implementation must pass.
 * We inline it here (instead of a shared helper) because it lives in electron/main
 * and the in-memory version lives in simulation/.  The contract is small enough
 * to duplicate; see InMemorySettingsRepository.test.ts for the parallel version.
 */
function runContractTests(label: string, makeRepo: () => SettingsRepository): void {
    describe(label, () => {
        let repo: SettingsRepository;

        beforeEach(() => {
            repo = makeRepo();
        });

        it('returns an empty object for a game with no saved settings', async () => {
            expect(await repo.load('tactics')).toEqual({});
        });

        it('returns empty object for each new unknown gameId independently', async () => {
            expect(await repo.load('tactics')).toEqual({});
            expect(await repo.load('chess')).toEqual({});
        });

        it('persists overrides after save()', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            expect(await repo.load('tactics')).toEqual({ audio: { masterVolume: 0.5 } });
        });

        it('overwrites entire override object on subsequent save()', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            await repo.save('tactics', { display: { targetFps: 30 } });
            expect(await repo.load('tactics')).toEqual({ display: { targetFps: 30 } });
        });

        it('isolates different gameId namespaces', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            await repo.save('chess', { audio: { masterVolume: 0.9 } });
            expect(await repo.load('tactics')).toEqual({ audio: { masterVolume: 0.5 } });
            expect(await repo.load('chess')).toEqual({ audio: { masterVolume: 0.9 } });
        });

        it('reset() makes the next load() return an empty object', async () => {
            await repo.save('tactics', { audio: { muted: true } });
            await repo.reset('tactics');
            expect(await repo.load('tactics')).toEqual({});
        });

        it('reset() on an unknown gameId does not throw', async () => {
            await expect(repo.reset('never-saved')).resolves.toBeUndefined();
        });

        it('load() returns a new object reference on each call (no aliasing)', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            const a = await repo.load('tactics');
            const b = await repo.load('tactics');
            expect(a).not.toBe(b);
        });

        it('mutations to a loaded object do not affect the stored value', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            const loaded = (await repo.load('tactics')) as { audio: { masterVolume: number } };
            loaded.audio.masterVolume = 9.9;
            const second = (await repo.load('tactics')) as { audio: { masterVolume: number } };
            expect(second.audio.masterVolume).toBe(0.5);
        });
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const contractDirs: string[] = [];

function makeTmpRepo(): FileSettingsRepository {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chimera-filesettings-'));
    contractDirs.push(dir);
    return new FileSettingsRepository(dir);
}

afterAll(() => {
    for (const dir of contractDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ── Run shared contract tests ─────────────────────────────────────────────────

runContractTests('FileSettingsRepository (contract)', () => makeTmpRepo());

// ── FileSettingsRepository-specific tests ─────────────────────────────────────

describe('FileSettingsRepository (filesystem behaviour)', () => {
    let tmpDir: string;
    let repo: FileSettingsRepository;

    beforeEach(() => {
        tmpDir = mkdtempSync(path.join(os.tmpdir(), 'chimera-fs-settings-'));
        repo = new FileSettingsRepository(tmpDir);
    });

    afterAll(() => {
        // tmpDir cleaned up via contractDirs pattern is not needed here — just remove per-test
    });

    it('writes a JSON file at <baseDir>/<gameId>.json with version envelope (WARN-6)', async () => {
        await repo.save('tactics', { audio: { masterVolume: 0.3 } });
        const filePath = path.join(tmpDir, 'tactics.json');
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { version: number; overrides: unknown };
        expect(parsed.version).toBe(1);
        expect(parsed.overrides).toEqual({ audio: { masterVolume: 0.3 } });
    });

    it('leaves no .tmp file after a successful save()', async () => {
        await repo.save('tactics', { audio: { masterVolume: 0.3 } });
        const entries = await fs.readdir(tmpDir);
        const tmpFiles = entries.filter((e) => e.endsWith('.tmp'));
        expect(tmpFiles).toHaveLength(0);
    });

    it('reset() deletes the JSON file from disk', async () => {
        await repo.save('tactics', { audio: { muted: true } });
        await repo.reset('tactics');
        await expect(fs.access(path.join(tmpDir, 'tactics.json'))).rejects.toThrow();
    });

    it('throws InvalidGameIdError for gameId with path traversal characters', () => {
        expect(() => new FileSettingsRepository('/tmp').load('../etc/passwd')).toThrow(
            InvalidGameIdError,
        );
    });

    it('throws InvalidGameIdError for gameId with a slash', () => {
        expect(() => new FileSettingsRepository('/tmp').load('game/id')).toThrow(
            InvalidGameIdError,
        );
    });

    it('throws InvalidGameIdError for empty gameId', () => {
        expect(() => new FileSettingsRepository('/tmp').load('')).toThrow(InvalidGameIdError);
    });

    it('load() falls back to {} when file has no version field (old format)', async () => {
        // Simulate a legacy file with plain JSON (no envelope)
        const filePath = path.join(tmpDir, 'legacy-game.json');
        await fs.writeFile(filePath, JSON.stringify({ audio: { masterVolume: 0.5 } }), 'utf8');
        const result = await repo.load('legacy-game');
        expect(result).toEqual({});
    });

    it('load() falls back to {} when file has wrong version number', async () => {
        const filePath = path.join(tmpDir, 'old-version.json');
        await fs.writeFile(
            filePath,
            JSON.stringify({ version: 99, overrides: { audio: { masterVolume: 0.5 } } }),
            'utf8',
        );
        const result = await repo.load('old-version');
        expect(result).toEqual({});
    });
});

// ── Smoke-test InMemorySettingsRepository with same contract ──────────────────

runContractTests(
    'InMemorySettingsRepository (contract parity check)',
    () => new InMemorySettingsRepository(),
);
