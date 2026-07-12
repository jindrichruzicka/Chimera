/**
 * electron/main/replay/FilePerspectiveReplayRepository.ts
 *
 * Filesystem-backed `PerspectiveReplayRepository` implementation (§4.28),
 * mirroring `FileReplayRepository`.
 *
 * Perspective replays are stored under their **own owned root**, disjoint from
 * the deterministic `userData/replays/`:
 *   <baseDir>/<gameId>/<uuid>.chimera-perspective-replay
 * In production `baseDir` is `app.getPath('userData')/perspective-replays`; pass
 * an explicit temp directory in tests.
 *
 * `save()` writes to a `.tmp` file first, fsyncs, then renames atomically to the
 * final path (invariant #23). The repository assigns a fresh UUID per replay, so
 * it never overwrites an existing file. Containment and gameId validation are
 * shared with `FileReplayRepository` (its `ReplayPathError`, `InvalidGameIdError`,
 * and `LIST_CONCURRENCY` are reused) so the two persistence-layer guards cannot
 * drift.
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #23 — save() writes to .tmp and renames atomically.
 *   #41 — Passes the identical contract test suite as InMemoryPerspectiveReplayRepository.
 *   #67 — Constructed with an injected Logger child.
 *   #98 — The injected serializer re-validates the locked viewerId / tick order on load.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import type {
    PerspectiveReplayFile,
    PerspectiveReplayRepository,
    PerspectiveReplaySerializer,
} from '@chimera-engine/simulation/replay/index.js';
import { ReplayNotFoundError } from '@chimera-engine/simulation/replay/index.js';
import type { Logger } from '../logging/logger.js';
import { isInsidePath } from '../path-containment.js';
import { InvalidGameIdError, LIST_CONCURRENCY, ReplayPathError } from './FileReplayRepository.js';

/** Extension used for stored perspective replay files (distinct from `.chimera-replay`). */
const FILE_EXT = '.chimera-perspective-replay';

/** Allowlist pattern for the `<gameId>` path component (anti path-traversal). */
const GAME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Filesystem-backed `PerspectiveReplayRepository`. One
 * `.chimera-perspective-replay` file per replay, under its own owned root.
 */
export class FilePerspectiveReplayRepository implements PerspectiveReplayRepository {
    private readonly resolvedBase: string;
    private readonly log: Logger;

    constructor(
        private readonly serializer: PerspectiveReplaySerializer,
        baseDir: string,
        logger: Logger,
    ) {
        this.resolvedBase = path.resolve(baseDir);
        this.log = logger.child({ module: 'file-perspective-replay-repository' });
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static validateGameId(gameId: string): void {
        if (!GAME_ID_RE.test(gameId)) {
            throw new InvalidGameIdError(gameId);
        }
    }

    /**
     * Resolve `filePath` and assert it stays inside `baseDir`. Returns the
     * resolved absolute path. Throws `ReplayPathError` on traversal — shared with
     * the deterministic repository via {@link isInsidePath} (OWASP A01).
     */
    private assertInsideBase(filePath: string): string {
        if (!isInsidePath(this.resolvedBase, filePath)) {
            throw new ReplayPathError(filePath);
        }
        return path.resolve(filePath);
    }

    // ── PerspectiveReplayRepository implementation ────────────────────────────

    async save(file: PerspectiveReplayFile): Promise<string> {
        FilePerspectiveReplayRepository.validateGameId(file.gameId);

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

        this.log.debug('save', { gameId: file.gameId, viewerId: file.viewerId, path: dest });
        return dest;
    }

    async load(filePath: string): Promise<PerspectiveReplayFile> {
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

        this.log.debug('load', { path: resolved });
        return this.serializer.deserialize(raw);
    }

    async list(gameId: string): Promise<string[]> {
        return (await this.readSortedListings(gameId)).map((entry) => entry.path);
    }

    /**
     * Read every `.chimera-perspective-replay` file under `<baseDir>/<gameId>`,
     * projecting each to its `{ path, recordedAt }`, sorted newest-first by
     * `recordedAt` with a stable path tiebreak. Reads are chunked by
     * {@link LIST_CONCURRENCY} to bound open file descriptors.
     */
    private async readSortedListings(
        gameId: string,
    ): Promise<{ path: string; recordedAt: string }[]> {
        FilePerspectiveReplayRepository.validateGameId(gameId);

        const dir = path.join(this.resolvedBase, gameId);
        const entries = await fs.readdir(dir).catch((err: unknown): string[] => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw err;
        });

        const replayPaths = entries
            .filter((name) => name.endsWith(FILE_EXT))
            .map((name) => path.join(dir, name));

        const records: { path: string; recordedAt: string }[] = [];
        for (let i = 0; i < replayPaths.length; i += LIST_CONCURRENCY) {
            const chunk = replayPaths.slice(i, i + LIST_CONCURRENCY);
            const chunkRecords = await Promise.all(
                chunk.map(async (p): Promise<{ path: string; recordedAt: string }> => {
                    const file = await this.serializer.deserialize(await fs.readFile(p));
                    return { path: p, recordedAt: file.recordedAt };
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
        this.log.debug('delete', { path: resolved });
    }
}
