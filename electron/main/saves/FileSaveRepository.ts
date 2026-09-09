/**
 * electron/main/saves/FileSaveRepository.ts
 *
 * Filesystem-backed SaveRepository implementation (§4.11, invariant #23).
 *
 * Save files are stored as:
 *   <baseDir>/<gameId>/<slotId>.chimera
 *
 * `save()` always writes to a `.tmp` file first, then renames atomically to
 * the final path. An in-progress crash therefore leaves a `.tmp` artefact that
 * is invisible to `list()`.
 *
 * The default `baseDir` is `app.getPath('userData')/saves` from Electron.
 * In tests, supply a custom `baseDir` pointing to a temp directory.
 *
 * Architecture reference: §4.11
 *
 * Invariants upheld:
 *   #23 — save() writes to .tmp and renames atomically.
 *   #41 — Passes the identical contract test suite as InMemorySaveRepository.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SaveFile } from '@chimera-engine/simulation/persistence/SaveFile.js';
import type {
    SaveRepository,
    SaveSlotMeta,
} from '@chimera-engine/simulation/persistence/SaveRepository.js';
import type { SaveSerializer } from '@chimera-engine/simulation/persistence/SaveSerializer.js';
import type { SaveMigrator } from '@chimera-engine/simulation/persistence/SaveMigrator.js';
import {
    SaveNotFoundError,
    SaveIntegrityError,
} from '@chimera-engine/simulation/persistence/SaveMigrator.js';
import { computeBodyChecksum } from '@chimera-engine/simulation/persistence/SaveChecksum.js';

/** Extension used for save files. */
const FILE_EXT = '.chimera';

/** Suffix an in-flight write carries until its rename. */
const TEMP_EXT = '.tmp';

/**
 * Matches a temp artefact this repository writes, in either shape an install
 * can be carrying: `<slot>.chimera.<n>.tmp` is what `save()` writes now, and
 * `<slot>.chimera.tmp` is what it wrote before the temp path became per-write.
 * The older shape was self-healing — the next write to that slot truncated it —
 * and is inert under the current scheme, so the reap owns it too.
 *
 * Built from `FILE_EXT` and `TEMP_EXT` rather than spelled out, so a change to
 * either reaches the writer and the reaper together. `.` is the only regex
 * metacharacter either constant contains, and the leading `\\` escapes it.
 */
const TEMP_FILE_RE = new RegExp(`\\${FILE_EXT}(\\.\\d+)?\\${TEMP_EXT}$`);

/**
 * How old a temp artefact must be before `reapOrphanTempFiles()` treats it as
 * abandoned.
 *
 * The reaper cannot ask whether an artefact belongs to a write in flight: the
 * app requests no single-instance lock, so a SECOND instance sharing this
 * `userData` may be writing one right now, and taking that file would restore
 * the failure the per-write temp name removed — a rename that finds nothing
 * and rejects its caller's save. So it decides on age.
 *
 * The window is set by what a wrong answer costs in each direction, not by
 * timing a write: reaping late costs disk the sweep gives back on the next
 * start, while reaping early costs a save. `FileSaveRepository.reap.test.ts`
 * measures the property the window buys — a write in flight survives a sweep
 * that takes an aged artefact in the same pass.
 *
 * It is a heuristic, not a proof. A writer suspended past the window — a
 * laptop asleep mid-save — has its artefact taken, and its rename then fails
 * the way any interrupted save's does.
 */
export const ORPHAN_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Maximum number of save-file entries read in parallel by `list()`.
 *
 * Capping parallelism at this value prevents file-descriptor exhaustion
 * (EMFILE) when a user has hundreds of save slots.
 */
export const LIST_CONCURRENCY = 16;

/**
 * Thrown when a slot-ID component (gameId or slotName) fails the allowlist
 * validation that prevents path traversal (OWASP A01).
 *
 * Allowed pattern: `^[a-z0-9][a-z0-9_-]{0,63}$`
 * — starts with a lowercase letter or digit
 * — followed by up to 63 lowercase letters, digits, underscores, or hyphens
 */
export class InvalidSlotIdError extends Error {
    constructor(field: string, value: string) {
        super(`Invalid ${field} ${JSON.stringify(value)}: must match ^[a-z0-9][a-z0-9_-]{0,63}$`);
        this.name = 'InvalidSlotIdError';
    }
}

/** Allowlist pattern for every path component used in save-file paths. */
const SLOT_COMPONENT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Distinguishes one in-flight write from another within this process.
 *
 * A counter rather than a timestamp: two writes started in the same
 * millisecond are exactly the case that needs telling apart. It is module
 * state, so it starts at 1 in every process: the name separates writes within
 * one process, not writes made by two instances sharing a `userData`.
 */
let tempWriteCounter = 0;

function nextTempId(): string {
    tempWriteCounter += 1;
    return String(tempWriteCounter);
}

/**
 * Validate a single path component (gameId or slotName).
 * Throws `InvalidSlotIdError` if the value does not match the allowlist.
 */
function validateSlotComponent(value: string, field: string): void {
    if (!SLOT_COMPONENT_RE.test(value)) {
        throw new InvalidSlotIdError(field, value);
    }
}

/**
 * Parse the qualified slot ID `'<gameId>/<slotName>'` into its two components.
 * Validates both components against the allowlist before returning them.
 * Throws `InvalidSlotIdError` if any component is invalid.
 */
function parseSlotId(slotId: string): [gameId: string, slotName: string] {
    const idx = slotId.indexOf('/');
    const gameId = slotId.slice(0, idx);
    const slotName = slotId.slice(idx + 1);
    validateSlotComponent(gameId, 'gameId');
    validateSlotComponent(slotName, 'slotName');
    return [gameId, slotName];
}

/**
 * Filesystem-backed `SaveRepository`. One `.chimera` file per slot.
 *
 * `baseDir` defaults to `app.getPath('userData') + '/saves'` in production.
 * Pass an explicit path in tests to avoid touching the real user directory.
 */
export class FileSaveRepository implements SaveRepository {
    constructor(
        private readonly serializer: SaveSerializer,
        private readonly migrator: SaveMigrator,
        private readonly baseDir: string,
    ) {}

    // ── Private helpers ───────────────────────────────────────────────────────

    private slotPath(gameId: string, slotName: string): string {
        return path.join(this.baseDir, gameId, `${slotName}${FILE_EXT}`);
    }

    private static fileToMeta(file: SaveFile, sizeBytes: number): SaveSlotMeta {
        const qualified = `${file.header.gameId}/${file.header.slotId}`;
        const meta: SaveSlotMeta = {
            slotId: qualified,
            gameId: file.header.gameId,
            tick: file.checkpoint.tick,
            savedAt: file.header.savedAt,
            turnNumber: file.header.turnNumber,
            playerNames: file.header.playerNames,
            schemaVersion: file.header.schemaVersion,
            sizeBytes,
        };

        if (file.header.thumbnailDataUrl !== undefined) {
            return { ...meta, thumbnailDataUrl: file.header.thumbnailDataUrl };
        }

        return meta;
    }

    // ── SaveRepository implementation ─────────────────────────────────────────

    async list(gameId: string): Promise<SaveSlotMeta[]> {
        const dir = path.join(this.baseDir, gameId);
        const entries = await fs.readdir(dir).catch((err: unknown): string[] => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw err;
        });

        const chimeraPaths = entries
            .filter((name) => name.endsWith(FILE_EXT))
            .map((name) => path.join(dir, name));

        const readMeta = async (filePath: string): Promise<SaveSlotMeta> => {
            const [raw, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
            const file = await this.serializer.deserialize(raw);
            return FileSaveRepository.fileToMeta(file, stat.size);
        };

        const metas: SaveSlotMeta[] = [];
        for (let i = 0; i < chimeraPaths.length; i += LIST_CONCURRENCY) {
            const chunk = chimeraPaths.slice(i, i + LIST_CONCURRENCY);
            metas.push(...(await Promise.all(chunk.map(readMeta))));
        }

        return metas.sort((a, b) => b.savedAt - a.savedAt);
    }

    async load(slotId: string): Promise<SaveFile> {
        const [gameId, slotName] = parseSlotId(slotId);
        const filePath = this.slotPath(gameId, slotName);

        let raw: Buffer;
        try {
            raw = await fs.readFile(filePath);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new SaveNotFoundError(slotId);
            }
            throw err;
        }

        const file = await this.serializer.deserialize(raw);
        const migrated = this.migrator.migrate(file);

        // Verify the integrity checksum if the file was written with one, against
        // the body AS STORED rather than the migrated one: the stored digest
        // covers the bytes that were written, and a migration may legitimately
        // rewrite hashed fields (v6→v7 renames `checkpoint.setup.matchSettings`).
        // Absent checksum means a legacy save — load it without error (backwards-compat).
        if (file.header.checksum !== undefined) {
            const expected = await computeBodyChecksum(file);
            if (expected !== file.header.checksum) {
                throw new SaveIntegrityError(slotId);
            }
        }

        return migrated;
    }

    async save(file: SaveFile): Promise<void> {
        validateSlotComponent(file.header.gameId, 'gameId');
        validateSlotComponent(file.header.slotId, 'slotName');

        const dir = path.join(this.baseDir, file.header.gameId);
        await fs.mkdir(dir, { recursive: true });

        // Compute and attach the integrity checksum before serialising.
        const checksum = await computeBodyChecksum(file);
        const fileWithChecksum: SaveFile = {
            ...file,
            header: { ...file.header, checksum },
        };

        const dest = this.slotPath(file.header.gameId, file.header.slotId);
        // Per-WRITE, not per-slot. One slot has more than one writer and they
        // are not serialised against each other — the fire-and-forget autosave
        // after `engine:end_turn`, and an explicit `saves.save()` that names no
        // slot and so defaults onto the autosave slot. Sharing one temp path
        // let the first rename move the file out from under the second, whose
        // rename then failed with ENOENT and whose caller saw its save
        // rejected. With a path of its own, each write is whole before it
        // renames and the rename itself decides the winner.
        const tmp = `${dest}.${nextTempId()}${TEMP_EXT}`;

        const fh = await fs.open(tmp, 'w');
        try {
            await fh.writeFile(await this.serializer.serialize(fileWithChecksum));
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
    }

    async delete(slotId: string): Promise<void> {
        const [gameId, slotName] = parseSlotId(slotId);
        try {
            await fs.unlink(this.slotPath(gameId, slotName));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new SaveNotFoundError(slotId);
            }
            throw err;
        }
    }

    // ── Maintenance (not part of the SaveRepository contract) ─────────────────

    /**
     * Delete temp artefacts left by writes that never reached their rename.
     *
     * A process killed between the write and the rename leaves a full-size file
     * that nothing else touches: the temp path belongs to that one write, so no
     * later `save()` reopens it; `list()` filters on `${FILE_EXT}` so it stays
     * invisible; and `delete(slotId)` unlinks only the slot's own file. Without
     * this sweep each crash mid-save costs one save file's worth of disk
     * forever.
     *
     * Only artefacts older than {@link ORPHAN_TEMP_MAX_AGE_MS} are taken — see
     * that constant for why the decision is age and not ownership. Below the
     * base directory every filesystem call is best-effort: a name that is not a
     * directory (`.DS_Store` sits beside the game directories on macOS), a
     * directory that vanishes under the sweep, a file another reaper already
     * took, an unlink the OS refuses — each is skipped and left out of the
     * count, because the sweep's only job is to give back disk.
     *
     * Call it once per app start, from the composition root that builds the
     * repository. It is deliberately NOT on `SaveRepository`: an in-memory
     * repository has nothing to reap (invariant #41 covers observable contract
     * behaviour, and this is neither).
     *
     * @returns how many artefacts were unlinked.
     */
    async reapOrphanTempFiles(): Promise<number> {
        const gameDirs = await fs.readdir(this.baseDir).catch((err: unknown): string[] => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw err;
        });

        // One cutoff for the whole sweep: a directory read late in the pass must
        // not use a later "now" than one read early, or the window would widen
        // as the sweep runs.
        const cutoff = Date.now() - ORPHAN_TEMP_MAX_AGE_MS;
        let reaped = 0;

        for (const gameDir of gameDirs) {
            const dir = path.join(this.baseDir, gameDir);
            // Reading a plain file as a directory throws ENOTDIR; the same catch
            // covers a directory removed between the two reads.
            const names = await fs.readdir(dir).catch((): string[] => []);

            for (const name of names) {
                if (!TEMP_FILE_RE.test(name)) continue;

                const filePath = path.join(dir, name);
                const stat = await fs.stat(filePath).catch(() => undefined);
                if (stat === undefined || stat.mtimeMs > cutoff) continue;

                const unlinked = await fs
                    .unlink(filePath)
                    .then(() => true)
                    .catch(() => false);
                if (unlinked) reaped += 1;
            }
        }

        return reaped;
    }

    async has(slotId: string): Promise<boolean> {
        const [gameId, slotName] = parseSlotId(slotId);
        try {
            await fs.access(this.slotPath(gameId, slotName));
            return true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw err;
        }
    }
}
