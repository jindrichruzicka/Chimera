/**
 * Filesystem-backed SettingsRepository implementation.
 *
 * Settings are stored as JSON files:
 *   <baseDir>/<gameId>.json
 *
 * `save()` writes to a `.tmp` file first, then renames atomically so that
 * a crash never leaves a corrupt settings file.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { UserSettings } from '@chimera-engine/simulation/settings/index.js';
import type { SettingsRepository } from '@chimera-engine/simulation/settings/index.js';

/**
 * Thrown when a gameId fails the allowlist check that prevents path traversal.
 *
 * Allowed pattern: `^[a-zA-Z0-9_-]+$`
 * — one or more letters, digits, underscores, or hyphens
 * — no slashes, dots, or other special characters
 */
export class InvalidGameIdError extends Error {
    constructor(gameId: string) {
        super(
            `Invalid gameId ${JSON.stringify(gameId)}: must match ^[a-zA-Z0-9_-]+$ and be non-empty`,
        );
        this.name = 'InvalidGameIdError';
    }
}

/** Allowlist pattern for gameId path components. */
const GAME_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a gameId before using it as a file-system path component.
 * Throws `InvalidGameIdError` synchronously if the value is invalid.
 */
function validateGameId(gameId: string): void {
    if (!GAME_ID_RE.test(gameId)) {
        throw new InvalidGameIdError(gameId);
    }
}

/**
 * Versioned envelope stored on disk.
 * Wrapping overrides in an envelope allows future migrations when the schema changes.
 */
interface SettingsFileEnvelope {
    readonly version: 1;
    readonly overrides: UserSettings;
}

/**
 * Filesystem-backed `SettingsRepository`. One `.json` file per game.
 *
 * `baseDir` should be `app.getPath('userData') + '/settings'` in production.
 * Pass an explicit path in tests to avoid touching the real user directory.
 */
export class FileSettingsRepository implements SettingsRepository {
    constructor(private readonly baseDir: string) {}

    private settingsPath(gameId: string): string {
        validateGameId(gameId);
        return path.join(this.baseDir, `${gameId}.json`);
    }

    load(gameId: string): Promise<UserSettings> {
        const filePath = this.settingsPath(gameId);
        return fs
            .readFile(filePath, 'utf8')
            .then((raw) => {
                const parsed = JSON.parse(raw) as unknown;
                if (
                    parsed !== null &&
                    typeof parsed === 'object' &&
                    !Array.isArray(parsed) &&
                    (parsed as Record<string, unknown>)['version'] === 1 &&
                    typeof (parsed as Record<string, unknown>)['overrides'] === 'object'
                ) {
                    return (parsed as SettingsFileEnvelope).overrides;
                }
                // Legacy format or wrong version — fall back to empty
                return {};
            })
            .catch((err: unknown) => {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                    return {};
                }
                throw err;
            });
    }

    async save(gameId: string, overrides: UserSettings): Promise<void> {
        const filePath = this.settingsPath(gameId);
        const tmpPath = `${filePath}.tmp`;

        await fs.mkdir(this.baseDir, { recursive: true });

        const envelope: SettingsFileEnvelope = { version: 1, overrides };

        const fh = await fs.open(tmpPath, 'w');
        try {
            await fh.writeFile(JSON.stringify(envelope), 'utf8');
            await fh.sync();
        } finally {
            await fh.close();
        }

        await fs.rename(tmpPath, filePath);
    }

    async reset(gameId: string): Promise<void> {
        const filePath = this.settingsPath(gameId);
        await fs.unlink(filePath).catch((err: unknown) => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw err;
        });
    }
}
