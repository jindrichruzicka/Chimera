/**
 * electron/main/replay/FileReplayRepository.ts
 *
 * Filesystem-backed `ReplayRepository` implementation (§4.28), mirroring
 * `FileSaveRepository` (§4.11).
 *
 * Replays are stored as:
 *   <baseDir>/<gameId>/<uuid>.chimera-replay
 *
 * `save()` writes to a `.tmp` file first, fsyncs, then renames atomically to
 * the final path. A crash between the `.tmp` write and the rename therefore
 * leaves only a `.tmp` artefact — never a half-written `.chimera-replay` (which
 * `list()` would surface). The repository assigns a fresh UUID per replay, so
 * it never overwrites an existing file.
 *
 * `baseDir` is `app.getPath('userData')/replays` in production; pass an explicit
 * temp directory in tests to avoid touching the real user directory.
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #23 — save() writes to .tmp and renames atomically.
 *   #41 — Passes the identical contract test suite as InMemoryReplayRepository.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import type {
    ReplayFile,
    ReplayListingEntry,
    ReplayRepository,
    ReplaySerializer,
} from '@chimera-engine/simulation/replay/index.js';
import { ReplayNotFoundError } from '@chimera-engine/simulation/replay/index.js';
import { isInsidePath } from '../path-containment.js';

/** Extension used for stored replay files. */
const FILE_EXT = '.chimera-replay';

/**
 * Maximum number of replay files read in parallel by `list()`. Caps
 * file-descriptor pressure when a game has many stored replays (mirrors
 * `FileSaveRepository.LIST_CONCURRENCY`).
 */
export const LIST_CONCURRENCY = 16;

/** Allowlist pattern for the `<gameId>` path component (anti path-traversal). */
const GAME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Thrown when a `gameId` fails the allowlist validation that prevents path
 * traversal (OWASP A01).
 */
export class InvalidGameIdError extends Error {
    constructor(value: string) {
        super(`Invalid gameId ${JSON.stringify(value)}: must match ^[a-z0-9][a-z0-9_-]{0,63}$`);
        this.name = 'InvalidGameIdError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown by `load()` / `delete()` when the supplied path resolves outside the
 * repository's `baseDir` — a path-traversal attempt (OWASP A01).
 */
export class ReplayPathError extends Error {
    public readonly filePath: string;

    constructor(filePath: string) {
        super(`Replay path ${JSON.stringify(filePath)} escapes the replay directory`);
        this.name = 'ReplayPathError';
        this.filePath = filePath;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Filesystem-backed `ReplayRepository`. One `.chimera-replay` file per replay.
 */
export class FileReplayRepository implements ReplayRepository {
    private readonly resolvedBase: string;

    constructor(
        private readonly serializer: ReplaySerializer,
        private readonly baseDir: string,
    ) {
        this.resolvedBase = path.resolve(baseDir);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static validateGameId(gameId: string): void {
        if (!GAME_ID_RE.test(gameId)) {
            throw new InvalidGameIdError(gameId);
        }
    }

    /**
     * Resolve `filePath` and assert it stays inside `baseDir`. Returns the
     * resolved absolute path. Throws `ReplayPathError` on traversal.
     *
     * Containment is delegated to the shared {@link isInsidePath} predicate so
     * this persistence-layer guard and the IPC-layer guard
     * (`registerReplayHandlers`) cannot drift (OWASP A01).
     */
    private assertInsideBase(filePath: string): string {
        if (!isInsidePath(this.resolvedBase, filePath)) {
            throw new ReplayPathError(filePath);
        }
        return path.resolve(filePath);
    }

    // ── ReplayRepository implementation ───────────────────────────────────────

    async save(file: ReplayFile): Promise<string> {
        FileReplayRepository.validateGameId(file.gameId);

        const dir = path.join(this.resolvedBase, file.gameId);
        await fs.mkdir(dir, { recursive: true });

        const dest = path.join(dir, `${randomUUID()}${FILE_EXT}`);
        const tmp = `${dest}.tmp`;

        const fh = await fs.open(tmp, 'w');
        try {
            await fh.writeFile(await this.serializer.serialize(file));
            await fh.sync();
        } finally {
            await fh.close();
        }
        try {
            await fs.rename(tmp, dest);
        } catch (err) {
            await fs.unlink(tmp).catch(() => undefined); // best-effort cleanup
            throw err;
        }

        return dest;
    }

    async load(filePath: string): Promise<ReplayFile> {
        const resolved = this.assertInsideBase(filePath);

        let raw: Buffer;
        try {
            raw = await fs.readFile(resolved);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new ReplayNotFoundError(filePath);
            }
            throw err;
        }

        return this.serializer.deserialize(raw);
    }

    async list(gameId: string): Promise<string[]> {
        return (await this.readSortedListings(gameId)).map((entry) => entry.path);
    }

    async listItems(gameId: string): Promise<ReplayListingEntry[]> {
        return this.readSortedListings(gameId);
    }

    /**
     * Read every `.chimera-replay` file under `<baseDir>/<gameId>`, projecting
     * each to a {@link ReplayListingEntry}, sorted newest-first by `recordedAt`
     * with a stable path tiebreak. Shared by `list` and `listItems` so a
     * browser listing pays a single deserialization per file.
     *
     * Reads are chunked by {@link LIST_CONCURRENCY} to bound open file
     * descriptors; the full `ReplayFile` (including its action log) is
     * projected to scalars within each chunk and then discarded, so memory
     * stays bounded to one chunk's worth of files rather than every replay's
     * actions at once.
     */
    private async readSortedListings(gameId: string): Promise<ReplayListingEntry[]> {
        FileReplayRepository.validateGameId(gameId);

        const dir = path.join(this.resolvedBase, gameId);
        const entries = await fs.readdir(dir).catch((err: unknown): string[] => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw err;
        });

        const replayPaths = entries
            .filter((name) => name.endsWith(FILE_EXT))
            .map((name) => path.join(dir, name));

        const records: ReplayListingEntry[] = [];
        for (let i = 0; i < replayPaths.length; i += LIST_CONCURRENCY) {
            const chunk = replayPaths.slice(i, i + LIST_CONCURRENCY);
            const chunkRecords = await Promise.all(
                chunk.map(async (p): Promise<ReplayListingEntry> => {
                    const file = await this.serializer.deserialize(await fs.readFile(p));
                    return {
                        path: p,
                        engineVersion: file.engineVersion,
                        gameId: file.gameId,
                        gameVersion: file.gameVersion,
                        recordedAt: file.metadata.recordedAt,
                        durationTicks: file.metadata.durationTicks,
                        playerIds: file.metadata.players.map((player) => player.playerId),
                        // Project the user-entered name only when present (zero extra
                        // I/O — this file was already deserialized for the sort key).
                        ...(file.metadata.name !== undefined ? { name: file.metadata.name } : {}),
                    };
                }),
            );
            records.push(...chunkRecords);
        }

        records.sort((a, b) => {
            if (a.recordedAt !== b.recordedAt) {
                return a.recordedAt < b.recordedAt ? 1 : -1;
            }
            return a.path < b.path ? 1 : -1;
        });

        return records;
    }

    async delete(filePath: string): Promise<void> {
        const resolved = this.assertInsideBase(filePath);
        try {
            await fs.unlink(resolved);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new ReplayNotFoundError(filePath);
            }
            throw err;
        }
    }
}
