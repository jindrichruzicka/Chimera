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
 * is invisible to `list()` and will be overwritten on the next `save()` call.
 *
 * The default `baseDir` is `app.getPath('userData')/saves` from Electron.
 * In tests, supply a custom `baseDir` pointing to a temp directory.
 *
 * Architecture reference: §4.11
 * Task: F06 / T4 (issue #123)
 *
 * Invariants upheld:
 *   #23 — save() writes to .tmp and renames atomically.
 *   #41 — Passes the identical contract test suite as InMemorySaveRepository.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SaveFile } from '@chimera/simulation/persistence/SaveFile.js';
import type {
    SaveRepository,
    SaveSlotMeta,
} from '@chimera/simulation/persistence/SaveRepository.js';
import type { SaveSerializer } from '@chimera/simulation/persistence/SaveSerializer.js';
import type { SaveMigrator } from '@chimera/simulation/persistence/SaveMigrator.js';
import { SaveNotFoundError } from '@chimera/simulation/persistence/SaveMigrator.js';

/** Extension used for save files. */
const FILE_EXT = '.chimera';

/**
 * Parse the qualified slot ID `'<gameId>/<slotName>'` into its two components.
 * Returns `[gameId, slotName]`. Assumes exactly one separator character '/'.
 */
function parseSlotId(slotId: string): [gameId: string, slotName: string] {
    const idx = slotId.indexOf('/');
    return [slotId.slice(0, idx), slotId.slice(idx + 1)];
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
        const entries = await fs.readdir(dir).catch((): string[] => []);

        const metas = await Promise.all(
            entries
                .filter((name) => name.endsWith(FILE_EXT))
                .map(async (name): Promise<SaveSlotMeta> => {
                    const filePath = path.join(dir, name);
                    const [raw, stat] = await Promise.all([
                        fs.readFile(filePath),
                        fs.stat(filePath),
                    ]);
                    const file = this.serializer.deserialize(raw);
                    return FileSaveRepository.fileToMeta(file, stat.size);
                }),
        );

        return metas.sort((a, b) => b.savedAt - a.savedAt);
    }

    async load(slotId: string): Promise<SaveFile> {
        const [gameId, slotName] = parseSlotId(slotId);
        const filePath = this.slotPath(gameId, slotName);

        let raw: Buffer;
        try {
            raw = await fs.readFile(filePath);
        } catch {
            throw new SaveNotFoundError(slotId);
        }

        const file = this.serializer.deserialize(raw);
        return this.migrator.migrate(file);
    }

    async save(file: SaveFile): Promise<void> {
        const dir = path.join(this.baseDir, file.header.gameId);
        await fs.mkdir(dir, { recursive: true });

        const dest = this.slotPath(file.header.gameId, file.header.slotId);
        const tmp = `${dest}.tmp`;

        await fs.writeFile(tmp, this.serializer.serialize(file));
        await fs.rename(tmp, dest);
    }

    async delete(slotId: string): Promise<void> {
        const [gameId, slotName] = parseSlotId(slotId);
        try {
            await fs.unlink(this.slotPath(gameId, slotName));
        } catch {
            throw new SaveNotFoundError(slotId);
        }
    }

    async has(slotId: string): Promise<boolean> {
        const [gameId, slotName] = parseSlotId(slotId);
        return fs
            .access(this.slotPath(gameId, slotName))
            .then(() => true)
            .catch(() => false);
    }
}
